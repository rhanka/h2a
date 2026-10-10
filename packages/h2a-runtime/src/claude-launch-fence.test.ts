import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeTerminalClient } from "./native-terminal/client.js";
import { nativeClaudeDeliveryDeps } from "./native-host.js";

it("should fence a real one-shot paste against incarnation replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "fence-")), socket = join(root, "host.sock");
  for (const name of ["home", "runtime", "state", "config"]) mkdirSync(join(root, name));
  const env = { ...process.env, HOME: join(root, "home"), XDG_RUNTIME_DIR: join(root, "runtime"), XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config") };
  const host = spawn(process.execPath, [fileURLToPath(new URL("../dist/native-terminal/process.js", import.meta.url)), "--socket", socket, "--registry-path", join(root, "registry.json")], { env, stdio: ["ignore", "ignore", "pipe"] });
  let client: NativeTerminalClient | undefined;
  try {
    for (let i = 0; i < 100; i++) { try { client = await NativeTerminalClient.connect(socket); break; } catch { await new Promise(r => setTimeout(r, 20)); } }
    if (!client) throw new Error("private fixture host failed to start");
    const create = () => client!.create({ id: "w", command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: root, env, cols: 80, rows: 24 });
    const original = await create();
    const deps = nativeClaudeDeliveryDeps({ name: "w", socketPath: socket, generation: original.generation, incarnation: original.incarnation }, Date.now() + 5000);
    await deps.capturePane("w");
    await client.stopIfIncarnation("w", original.generation, original.incarnation, "SIGKILL");
    for (let i = 0; i < 100 && (await client.state("w")).status !== "exited"; i++) await new Promise(r => setTimeout(r, 10));
    const replacement = await create();
    expect(replacement.incarnation).not.toBe(original.incarnation);
    await expect(deps.pasteBlock("w", "must never reach replacement")).rejects.toThrow();
    expect((await client.readOutput("w", 0)).chunks.map(c => c.data).join("")).not.toContain("must never reach replacement");
    await client.stopIfIncarnation("w", replacement.generation, replacement.incarnation, "SIGKILL");
  } finally {
    client?.close();
    if (host.exitCode === null) { const exited = once(host, "exit"); host.kill("SIGTERM"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
});
