import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeTerminalClient } from "./native-terminal/client.js";

for (const phase of ["before-mark", "after-mark", "during-enter", "before-publication"]) {
  it(`should ${phase === "before-mark" ? "clean" : "preserve"} the exact live incarnation on launcher SIGKILL at ${phase}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "crash-")), socket = join(root, "h.sock");
    for (const name of ["home", "runtime", "state", "config", "run"]) mkdirSync(join(root, name));
    const env = { ...process.env, HOME: join(root, "home"), XDG_RUNTIME_DIR: join(root, "runtime"), XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"), H2A_RUN_LAUNCH_TOKEN: "crash-token" };
    const host = spawn(process.execPath, [fileURLToPath(new URL("../dist/native-terminal/process.js", import.meta.url)), "--socket", socket, "--registry-path", join(root, "registry.json")], { env, stdio: ["ignore", "ignore", "pipe"] });
    let client: NativeTerminalClient | undefined, launcher: ReturnType<typeof spawn> | undefined;
    try {
      for (let i = 0; i < 100; i++) { try { client = await NativeTerminalClient.connect(socket); break; } catch { await new Promise(r => setTimeout(r, 20)); } }
      if (!client) throw new Error("private crash host failed to start");
      const tui = join(root, "composer.cjs");
      writeFileSync(tui, `process.stdin.setRawMode(true);process.stdout.write('❯ \\n· ~/project');process.stdin.on('data',chunk=>{const text=chunk.toString().replace(/\\x1b\\[200~|\\x1b\\[201~/g,'').replace(/\\r/g,'');process.stdout.write('\\x1b[2J\\x1b[H❯ '+text+'\\n· ~/project');});`);
      const created = await client.create({ id: "w", command: process.execPath, args: [tui], cwd: root, env, cols: 100, rows: 24 });
      const owner = { name: "w", generation: created.generation, incarnation: created.incarnation, socketPath: socket };
      const url = (name: string) => fileURLToPath(new URL(`../dist/${name}.js`, import.meta.url));
      const code = `import {startLaunchGuard} from ${JSON.stringify(url("launch-guard"))};
        import {deliverClaudeNativePrompt} from ${JSON.stringify(url("claude-native-driver"))};
        import {nativeClaudeDeliveryDeps} from ${JSON.stringify(url("native-host"))};
        const owner=${JSON.stringify(owner)}, phase=${JSON.stringify(phase)};
        const die=()=>process.kill(process.pid,'SIGKILL');
        const guard=startLaunchGuard(${JSON.stringify(join(root, "run"))},{host:'native',sessions:[owner]});
        const mark=guard.markSubmitAttempted;guard.markSubmitAttempted=()=>{if(phase==='before-mark')die();mark();if(phase==='after-mark')die();};
        const deps=nativeClaudeDeliveryDeps(owner,Date.now()+5000), submit=deps.submit;
        deps.submit=async name=>{if(phase==='during-enter')die();return submit(name);};
        const result=await deliverClaudeNativePrompt('w','exact crash brief',deps,{launchGuard:guard,observationTimeoutMs:5000,correlatedResponse:()=>{if(phase==='before-publication')die();return false;}});
        console.error(JSON.stringify(result));process.exitCode=2;`;
      launcher = spawn(process.execPath, ["--input-type=module", "-e", code], { env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = ""; launcher.stderr!.on("data", data => { stderr += data; });
      const [exit, signal] = await once(launcher, "exit");
      expect(exit, stderr).toBeNull(); expect(signal, stderr).toBe("SIGKILL");
      const path = join(root, "run", "launch.json");
      let receipt: Record<string, unknown> | undefined;
      for (let i = 0; i < 300; i++) {
        try { receipt = JSON.parse(readFileSync(path, "utf8")); } catch { /* First receipt may not exist yet. */ }
        if (receipt?.state === (phase === "before-mark" ? "stopped" : "launch-unconfirmed")) break;
        await new Promise(r => setTimeout(r, 10));
      }
      expect(receipt?.state).toBe(phase === "before-mark" ? "stopped" : "launch-unconfirmed");
      expect((await client.state("w")).status).toBe(phase === "before-mark" ? "exited" : "running");
      if (phase !== "before-mark") expect(receipt?.submitAttempted).toBe(true);
      if (phase !== "before-mark") await client.stopIfIncarnation("w", created.generation, created.incarnation, "SIGKILL");
    } finally {
      if (launcher && launcher.exitCode === null && launcher.signalCode === null) launcher.kill("SIGKILL");
      client?.close();
      if (host.exitCode === null) { const exited = once(host, "exit"); host.kill("SIGTERM"); await exited; }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
}
