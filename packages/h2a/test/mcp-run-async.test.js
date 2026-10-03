import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpStdio } from "../dist/index.js";
import { createH2aRunLauncher, executeH2aRunWithAsyncSpawn, executeH2aRunWithSpawn } from "../dist/runtime/mcp/agent-launch.js";

const request = { name: "worker", profile: "codex", workspace: process.cwd(), prompt: "one brief", background: true, gateway: "off", headless: false, h2aSidecar: true };

const capabilityFailure = {
  kind: "h2a.run.failure", version: 1, state: "not-started", code: "native-host-capability-mismatch", launchId: request.name,
  phase: "host-selection", creationAttempted: false, retrySafe: true, missingCapabilities: ["launchFence"],
  host: { socketPath: "/tmp/qualification/legacy.sock", generation: "legacy", hostPid: 123 },
  recovery: { action: "select-compatible-generation", automaticRetry: false },
};

test("should propagate a proven pre-create failure through the asynchronous launcher and remember the same name", async () => {
  let launches = 0;
  const launch = createH2aRunLauncher(req => {
    launches++;
    return executeH2aRunWithAsyncSpawn(req, () => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
      setImmediate(() => {
        child.stdout.end(JSON.stringify(capabilityFailure));
        child.stderr.end("Launch refused before creation");
        child.emit("close", 1);
      });
      return child;
    });
  });
  assert.deepEqual(await launch(request), capabilityFailure);
  assert.deepEqual(await launch({ ...request, prompt: "a different brief must never launch" }), capabilityFailure);
  assert.equal(launches, 1);
});

test("should accept the typed pre-create refusal through the synchronous CLI bridge", () => {
  assert.deepEqual(executeH2aRunWithSpawn(request, () => ({
    status: 1, stdout: JSON.stringify(capabilityFailure), stderr: "Launch refused before creation",
  })), capabilityFailure);
});

test("should not reclassify a timed-out runtime from an unfinished failure payload", () => {
  const result = executeH2aRunWithSpawn(request, () => ({
    status: null, stdout: JSON.stringify(capabilityFailure),
    stderr: '[h2a] h2a.run.phase/v1 {"launchId":"worker","phase":"creation-attempted"}\n',
    error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
  }));
  assert.equal(result.state, "unknown");
  assert.equal(result.retrySafe, false);
});

test("should retain unknown for unproved, malformed, cross-name or post-create capability failures", async () => {
  const variants = [
    { ...capabilityFailure, version: 2 },
    { ...capabilityFailure, state: "unknown" },
    { ...capabilityFailure, launchId: "other" },
    { ...capabilityFailure, code: "other" },
    { ...capabilityFailure, phase: "creation" },
    { ...capabilityFailure, creationAttempted: true },
    { ...capabilityFailure, retrySafe: false },
    { ...capabilityFailure, missingCapabilities: [] },
    { ...capabilityFailure, host: undefined },
    { ...capabilityFailure, host: { ...capabilityFailure.host, hostPid: 0 } },
    { ...capabilityFailure, host: { ...capabilityFailure.host, generation: "" } },
    { ...capabilityFailure, host: { ...capabilityFailure.host, socketPath: "relative" } },
    { ...capabilityFailure, recovery: { ...capabilityFailure.recovery, automaticRetry: true } },
    { ...capabilityFailure, prompt: { delivered: true } },
  ];
  for (const failure of variants) {
    const launch = createH2aRunLauncher(req => executeH2aRunWithSpawn(req, () => ({
      status: 1, stdout: JSON.stringify(failure), stderr: "unproved refusal",
    })));
    const result = await launch(request);
    assert.equal(result.state, "unknown", JSON.stringify(failure));
    assert.equal(result.retrySafe, false);
  }
  for (const stdout of ["", "not JSON", JSON.stringify(capabilityFailure)]) {
    const launch = createH2aRunLauncher(req => executeH2aRunWithSpawn(req, () => ({
      status: 1, stdout, stderr: '[h2a] h2a.run.phase/v1 {"launchId":"worker","phase":"creation-attempted"}\n' +
        "native host cannot reserve launch ownership; restart the host before launching",
    })));
    const result = await launch(request);
    assert.equal(result.state, "unknown");
    assert.equal(result.retrySafe, false);
  }
});

test("should expose the typed refusal unchanged through MCP tools/call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mcp-launch-refusal-"));
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  let output = "", launches = 0;
  stdout.on("data", chunk => { output += chunk; });
  try {
    const done = runMcpStdio({ root: directory, workspaceRoot: request.workspace, stdin, stdout, stderr,
      runExecutor: req => {
        launches++;
        return executeH2aRunWithSpawn(req, () => ({ status: 1, stdout: JSON.stringify(capabilityFailure), stderr: "Launch refused before creation" }));
      } });
    for (const id of [1, 2]) stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call",
      params: { name: "h2a_run", arguments: request } }) + "\n");
    stdin.end();
    await done;
    const responses = output.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(responses.length, 2);
    for (const response of responses) assert.deepEqual(JSON.parse(response.result.content[0].text), capabilityFailure);
    assert.equal(launches, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("should keep the event loop responsive while the runtime runs", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  let ticked = false;
  const pending = executeH2aRunWithAsyncSpawn(request, () => child);
  await new Promise(resolve => setTimeout(() => { ticked = true; resolve(); }, 10));
  assert.equal(ticked, true);
  child.stderr.end("runtime refused");
  child.emit("close", 1);
  await assert.rejects(pending, /runtime refused/);
});

test("should return launching within the response budget and deliver once after a caller disconnects", async () => {
  let creates = 0, deliveries = 0, finish;
  const launch = createH2aRunLauncher(() => {
    creates++;
    return new Promise(resolve => { finish = () => { deliveries++; resolve({ ok: true, state: "started" }); }; });
  }, 20);
  const firstCaller = launch(request);
  // The caller abandons its wait; the server retains the launch, even for a changed brief.
  const current = await launch({ ...request, prompt: "must never be delivered" });
  assert.deepEqual(current, { state: "launching", launchId: "worker", retrySafe: false });
  assert.deepEqual(await firstCaller, current);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await launch(request), { ok: true, state: "started" });
  assert.equal(creates, 1);
  assert.equal(deliveries, 1);
});

test("should cap the production MCP wait at 49 seconds while keeping the launch alive", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let finish, response;
  const launch = createH2aRunLauncher(() => new Promise(resolve => { finish = resolve; }));
  const pending = launch(request).then(value => { response = value; return value; });
  context.mock.timers.tick(48_999);
  await Promise.resolve();
  assert.equal(response, undefined);
  context.mock.timers.tick(1);
  assert.deepEqual(await pending, { state: "launching", launchId: "worker", retrySafe: false });
  finish({ state: "started" });
  await Promise.resolve();
  assert.deepEqual(launch(request), { state: "started" });
});

test("should finish one runtime and one brief after MCP client cancellation and transport close", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mcp-launch-disconnect-"));
  const witness = join(directory, "brief.json");
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  let output = "", creates = 0, completion;
  stdout.on("data", chunk => { output += chunk; });
  const result = { kind: "h2a.run.result", version: 1, apiVersion: "h2a.run/v1", runtimeVersion: "0.97.11", ok: true, state: "started",
    session: { id: request.name, tmuxSession: `h2a-${request.name}`, host: "native", profile: request.profile, workspace: request.workspace,
      mode: "interactive", background: true, gateway: "direct", h2aSidecar: true, pid: 4242 }, attach: { command: "h2a", args: ["attach", request.name] } };
  try {
    const done = runMcpStdio({ root: directory, workspaceRoot: request.workspace, stdin, stdout, stderr,
      runExecutor: req => {
        creates++;
        completion = executeH2aRunWithAsyncSpawn(req, () => spawn(process.execPath, ["--input-type=module", "-e",
          `import{writeFileSync}from'node:fs';let brief='';for await(const chunk of process.stdin)brief+=chunk;setTimeout(()=>{writeFileSync(${JSON.stringify(witness)},JSON.stringify([brief]));console.log(${JSON.stringify(JSON.stringify(result))});},150);`
        ], { stdio: ["pipe", "pipe", "pipe"] }));
        return completion;
      } });
    const call = id => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "h2a_run", arguments: request } }) + "\n";
    stdin.write(call(1));
    stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }) + "\n");
    stdin.write(call(2));
    stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize" }) + "\n");
    await new Promise(resolve => setTimeout(resolve, 30));
    const responses = output.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.equal(responses.find(response => response.id === 2).result.content[0].text,
      JSON.stringify({ state: "launching", launchId: "worker", retrySafe: false }));
    assert.ok(responses.some(response => response.id === 3), "MCP stays responsive while launch is pending");
    stdin.end();
    await done;
    stdout.destroy();
    assert.equal((await completion).state, "started");
    assert.equal(creates, 1);
    assert.deepEqual(JSON.parse(readFileSync(witness, "utf8")), [request.prompt]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
