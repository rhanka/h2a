#!/usr/bin/env node
// npm run build && node scripts/uat-h2a-run-launch.mjs [--mcp-delay-ms=45000]
// Uses real provider CLIs. Each campaign owns its PTY host, bus and witnesses.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createH2aRunLauncher, executeH2aRun, executeH2aRunWithAsyncSpawn } from "../packages/h2a/dist/runtime/mcp/agent-launch.js";
import { NativeTerminalClient } from "../packages/h2a-runtime/dist/native-terminal/client.js";
import { stripAnsi } from "../packages/h2a-runtime/dist/native-terminal/op.js";
import { paneIsReady } from "../packages/h2a-runtime/dist/prompt-delivery.js";

if (process.argv.includes("--launch")) {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const cancelMs = Number(process.argv.find(arg => arg.startsWith("--cancel-after-ms="))?.split("=")[1]);
  try {
    if (cancelMs) {
      const result = await executeH2aRunWithAsyncSpawn(request, (command, args, options) => {
        const runtime = spawn(command, args, options);
        // Cancel at the ownership boundary, while create/verification is still
        // in flight, rather than at a machine-speed-dependent wall deadline.
        const receiptPath = join(request.workspace, ".h2a/runs", request.name, "launch.json");
        const poll = setInterval(() => {
          try {
            const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
            if (receipt.state === "launching" && receipt.ownership?.sessions.length === 2) {
              clearInterval(poll);
              runtime.kill("SIGTERM");
            }
          } catch { /* Ownership has not yet been published. */ }
        }, 5);
        runtime.once("close", () => clearInterval(poll));
        return runtime;
      }, cancelMs);
      console.log(JSON.stringify(result));
    } else {
      const launch = createH2aRunLauncher();
      const started = Date.now();
      const first = await launch(request);
      const responseMs = Date.now() - started;
      let result = first;
      while (result.state === "launching") {
        await new Promise(resolve => setTimeout(resolve, 500));
        result = await launch(request);
      }
      console.log(JSON.stringify({ ...result, firstResponse: first.state, responseMs }));
    }
  }
  catch (error) { console.log(JSON.stringify({ error: error.message })); }
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const campaign = join(root, "tmp", `launch-uat-${Date.now()}`);
  const socketDir = mkdtempSync(join(tmpdir(), "h2a-launch-uat-"));
  const socket = join(socketDir, "host.sock");
  const wrappers = join(campaign, "bin");
  mkdirSync(wrappers, { recursive: true });
  const delayMs = Number(process.argv.find(arg => arg.startsWith("--mcp-delay-ms="))?.split("=")[1] ?? 45000);
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error("invalid MCP delay");
  const startDelayMs = Number(process.argv.find(arg => arg.startsWith("--codex-start-delay-ms="))?.split("=")[1] ?? 55000);
  if (!Number.isSafeInteger(startDelayMs) || startDelayMs < 0) throw new Error("invalid Codex startup delay");
  const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  const realCli = name => {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${name} is not installed`);
    return result.stdout.trim();
  };
  // The test worktree is approved for this campaign only; authentication stays
  // with the provider CLI. No configuration or credential file is read here.
  writeFileSync(join(wrappers, "muse"), `#!/bin/sh\nexec ${shellQuote(realCli("muse"))} --trust-workspace "$@"\n`, { mode: 0o700 });
  const delayedMcp = join(campaign, "delayed-mcp.mjs");
  writeFileSync(delayedMcp, `import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){
 const m=JSON.parse(line);if(m.id===undefined)continue;
 if(m.method==='initialize')setTimeout(()=>console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'launch-measure',version:'1'}}})),${delayMs});
 else console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='tools/list'?{tools:[]}:{}}));
}
`);
  writeFileSync(join(wrappers, "codex"), `#!/bin/sh\nsleep ${startDelayMs / 1000}\nexec ${shellQuote(realCli("codex"))} -c ${shellQuote('mcp_servers.launch_measure.command="'+process.execPath+'"')} -c ${shellQuote('mcp_servers.launch_measure.args='+JSON.stringify([delayedMcp]))} -c mcp_servers.launch_measure.startup_timeout_sec=120 "$@"\n`, { mode: 0o700 });
  // The runtime uses bash -lc. Reapply only our test PATH after login startup.
  const bashEnv = join(campaign, "bash-env.sh");
  writeFileSync(bashEnv, `export PATH=${shellQuote(wrappers)}:"$PATH"\n`, { mode: 0o600 });
  const env = { ...process.env, PATH: wrappers + ":" + process.env.PATH,
    BASH_ENV: bashEnv,
    REMOTE_CLI_CONFIG_HOME: join(campaign, "config"),
    H2A_NATIVE_SOCKET: socket, H2A_ROOT: join(campaign, "bus"),
    H2A_SESSION_HOST: "native" };
  const host = spawn(process.execPath, [join(root, "packages/h2a-runtime/dist/native-terminal/process.js"),
    "--socket", socket, "--registry-path", join(campaign, "config/.config/sentropic/h2a/registry.json")],
    { env, stdio: ["ignore", "ignore", "pipe"] });
  let hostLog = "";
  host.stderr.on("data", data => { hostLog += data; });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = [];
  let client;
  try {
    for (let i = 0; i < 100; i++) {
      try { client = await NativeTerminalClient.connect(socket); break; }
      catch { await sleep(100); }
    }
    if (!client) throw new Error("dedicated native host did not start");
    for (const scenario of [{ profile: "muse" }, { profile: "codex" }, { profile: "codex", cancelMs: 60000 }]) {
      const { profile, cancelMs } = scenario;
      const leg = cancelMs ? "codex-cancel" : profile;
      const name = `uat-${leg}-${Date.now()}`;
      const witness = join(campaign, `${leg}.txt`);
      const prompt = `Write exactly H2A_LAUNCH_WITNESS to the file ${witness} using your file editing tool. Do nothing else. Do not read secrets, launch agents, or change any other file.`;
      const request = { profile, name, workspace: root, prompt, background: true,
        gateway: "off", headless: false, h2aSidecar: true,
        ...(profile === "codex" ? { model: "gpt-6.1-sol", effort: "high" } : {}) };
      const started = Date.now();
      const launcher = spawn(process.execPath, [fileURLToPath(import.meta.url), "--launch",
        ...(cancelMs ? [`--cancel-after-ms=${cancelMs}`] : [])],
        { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", screen = "", seq = 0, readyMs;
      launcher.stdout.on("data", data => { stdout += data; });
      launcher.stderr.on("data", data => { stderr += data; });
      launcher.stdin.end(JSON.stringify(request));
      const deadline = started + 330000;
      while (Date.now() < deadline) {
        try {
          const output = await client.readOutput(`h2a-${name}`, seq);
          for (const chunk of output.chunks) { screen += chunk.data; seq = chunk.seq; }
          if (readyMs === undefined && paneIsReady(stripAnsi(screen.slice(-16384)), profile)) readyMs = Date.now() - started;
        } catch { /* The session may not have been created yet. */ }
        if (existsSync(witness) && launcher.exitCode !== null) break;
        if (launcher.exitCode !== null && /quota|usage limit|rate.?limit|429|credits|insufficient|limit reached/i.test(stripAnsi(screen))) break;
        if (launcher.exitCode !== null && stdout.includes('"error"')) break;
        await sleep(500);
      }
      if (launcher.exitCode === null) launcher.kill("SIGTERM");
      let receipt;
      try { receipt = JSON.parse(stdout.trim()); } catch { receipt = { error: "no launch receipt", stdout, stderr }; }
      const runDir = join(root, ".h2a/runs", name);
      const written = existsSync(witness) && readFileSync(witness, "utf8").trim() === "H2A_LAUNCH_WITNESS";
      const providerBlocked = !written && /quota|usage limit|rate.?limit|429|credits|insufficient|limit reached/i.test(stripAnsi(screen));
      const nativeStates = [];
      for (const id of [`h2a-${name}`, `h2a-${name}.h2a`]) {
        try { nativeStates.push({ id, status: (await client.state(id)).status }); }
        catch { nativeStates.push({ id, status: "absent" }); }
      }
      const cancelled = cancelMs && receipt.state === "stopped" && !written &&
        nativeStates.every(state => state.status === "exited" || state.status === "absent");
      let cleanupReceipt;
      try { cleanupReceipt = JSON.parse(readFileSync(join(runDir, "launch.json"), "utf8")); } catch { /* Report missing receipt. */ }
      const result = { profile, name, elapsedMs: Date.now() - started, readyMs, cancelMs, nativeStates,
        mcpDelayMs: profile === "codex" ? delayMs : 0, startupDelayMs: profile === "codex" ? startDelayMs : 0, receipt,
        runDir: existsSync(runDir), witness: written, cleanupReceipt,
        outcome: cancelled && cleanupReceipt?.ownership?.sessions.length === 2 || !cancelMs && written && receipt.ok && existsSync(runDir) && receipt.responseMs <= 50000 ? "passed" :
          !cancelMs && providerBlocked && (receipt.ok || receipt.state === "provider-blocked") && receipt.responseMs <= 50000 ? "provider-blocked" : "launch-failed" };
      writeFileSync(join(campaign, `${leg}.screen.txt`), stripAnsi(screen));
      writeFileSync(join(campaign, `${leg}.receipt.json`), JSON.stringify(result, null, 2));
      results.push(result);
      console.log(JSON.stringify(result));
      for (const id of [`h2a-${name}.h2a`, `h2a-${name}`]) {
        try {
          const state = await client.state(id);
          if (state.status !== "exited") await client.stopIfIncarnation(id, state.generation, state.incarnation, "SIGKILL");
        } catch { /* Missing companion. */ }
      }
    }
  } finally {
    client?.close();
    host.kill("SIGTERM");
    await new Promise(resolve => host.exitCode !== null ? resolve() : host.once("exit", resolve));
    writeFileSync(join(campaign, "host.log"), hostLog);
    writeFileSync(join(campaign, "results.json"), JSON.stringify(results, null, 2));
  }
  console.log(`Evidence: ${campaign}`);
  process.exitCode = results.length === 3 && results.every(result => result.outcome === "passed") ? 0 :
    results.some(result => result.outcome === "launch-failed") ? 1 : 2;
}
