import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
const { executeH2aRunWithSpawn, executeH2aRunWithAsyncSpawn } = await import(process.env.QUAL_MCP_MODULE ?? "../dist/runtime/mcp/agent-launch.js");
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

describe("MCP adapter alignment: launch-unconfirmed", () => {
  for (const host of ["tmux", "TMUX"]) {
    it(`should retain the historical synchronous Claude protocol on ${host}`, () => {
      const previous = process.env.H2A_SESSION_HOST;
      process.env.H2A_SESSION_HOST = host;
      const request = { profile: "claude", name: "tmux-contract", workspace: process.cwd(), prompt: "one brief", background: true, gateway: "off", headless: false, h2aSidecar: false };
      let argv, options;
      try {
        assert.throws(() => executeH2aRunWithSpawn(request, (_command, args, opts) => {
          argv = args; options = opts; return { status: 1, stdout: "", stderr: "legacy failure" };
        }), /legacy failure/);
        assert.equal(options.timeout, 180_000);
        assert.equal(argv.includes("--launch-contract"), false);
        assert.equal(options.env.H2A_RUN_REQUESTED_AT, undefined);
      } finally { if (previous === undefined) delete process.env.H2A_SESSION_HOST; else process.env.H2A_SESSION_HOST = previous; }
    });
  }
  it("should retain the historical asynchronous Claude budget and ignore native receipts on tmux", async () => {
    const previous = process.env.H2A_SESSION_HOST, workspace = mkdtempSync(join(tmpdir(), "mcp-tmux-"));
    process.env.H2A_SESSION_HOST = "tmux";
    const request = { profile: "claude", name: "w", workspace, prompt: "one brief", background: true, gateway: "off", headless: false, h2aSidecar: false };
    const budgets = [], original = globalThis.setTimeout;
    const timer = mock.method(globalThis, "setTimeout", (fn, ms, ...args) => { budgets.push(ms); return original(fn, ms, ...args); });
    try {
      await assert.rejects(executeH2aRunWithAsyncSpawn(request, (_command, argv, options) => {
        assert.equal(argv.includes("--launch-contract"), false);
        assert.equal(options.env.H2A_RUN_REQUESTED_AT, undefined);
        const directory = join(workspace, ".h2a", "runs", "w"); mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, "launch.json"), JSON.stringify({ token: options.env.H2A_RUN_LAUNCH_TOKEN, submitAttempted: true }));
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
        setImmediate(() => { child.stderr.write("legacy tmux failure"); child.emit("close", 1); });
        return child;
      }), /legacy tmux failure/);
      assert.equal(budgets[0], 180_000);
    } finally { timer.mock.restore(); if (previous === undefined) delete process.env.H2A_SESSION_HOST; else process.env.H2A_SESSION_HOST = previous; rmSync(workspace, { recursive: true, force: true }); }
  });
  it("should negotiate preservation before launching an interactive Claude runtime", () => {
    const request = { profile: "claude", name: "contract", workspace: process.cwd(), prompt: "one brief", background: true, gateway: "off", headless: false, h2aSidecar: false };
    let argv;
    const result = executeH2aRunWithSpawn(request, (_command, args) => {
      argv = args;
      return { status: 1, stdout: JSON.stringify({ kind: "h2a.run.failure", version: 1, state: "not-started", code: "launch-contract-mismatch", launchId: "contract", creationAttempted: false, retrySafe: false }), stderr: "refused before creation" };
    });
    assert.equal(argv[argv.indexOf("--launch-contract") + 1], "claude-native/2");
    assert.equal(result.state, "not-started");
  });
  for (const failure of ["buffer", "invalid-json", "invalid-contract", "spawn-error", "corrupt-receipt"]) {
    it(`should recover durable submission after ${failure} without changing the launch token`, async () => {
      const workspace = mkdtempSync(join(tmpdir(), "mcp-receipt-"));
      const request = { profile: "claude", name: "w", workspace, prompt: "one brief", background: true, gateway: "off", headless: false, h2aSidecar: false };
      try {
        const result = await executeH2aRunWithAsyncSpawn(request, (_command, _args, options) => {
          const directory = join(workspace, ".h2a", "runs", "w"); mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, "launch.json"), JSON.stringify({ token: options.env.H2A_RUN_LAUNCH_TOKEN, submitAttempted: true, state: "launching" }));
          if (failure === "corrupt-receipt") writeFileSync(join(directory, "launch.json"), "{");
          const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
          setImmediate(() => {
            if (failure === "spawn-error") child.emit("error", new Error("transport lost"));
            else {
              child.stdout.write(failure === "buffer" ? "x".repeat(1_100_000) : failure === "invalid-json" ? "not JSON" : "{}");
              child.emit("close", 0);
            }
          });
          return child;
        });
        assert.equal(result.state, "launch-unconfirmed"); assert.equal(result.retrySafe, false); assert.equal(result.stopped, false);
        assert.deepEqual(result.attach.args, ["attach", "w"]);
      } finally { rmSync(workspace, { recursive: true, force: true }); }
    });
  }
  it("should return typed launch-unconfirmed failure without throwing generic runtime error", () => {
    const request = {
      profile: "claude",
      name: "probe-unconfirmed-1",
      workspace: "/tmp",
      prompt: "Return the word READY_WITNESS.",
      background: true,
      gateway: "off",
      headless: false,
    };

    const mockSpawn = () => ({
      status: 1,
      stdout: JSON.stringify({
        kind: "h2a.run.failure",
        version: 1,
        state: "launch-unconfirmed",
        launchId: "probe-unconfirmed-1",
        error: "the initial prompt was submitted but dispatch was unconfirmed",
        stopped: false,
        retrySafe: false,
        prompt: { delivered: true, submitAttempted: true, waitedMs: 15000 },
        attach: { command: "h2a", args: ["attach", "probe-unconfirmed-1"] },
      }),
      stderr: "[h2a] session preserved and attachable\n",
    });

    const result = executeH2aRunWithSpawn(request, mockSpawn);
    assert.equal(result.state, "launch-unconfirmed");
    assert.equal(result.retrySafe, false);
    assert.equal(result.stopped, false);
    assert.equal(result.launchId, "probe-unconfirmed-1");
  });
});
