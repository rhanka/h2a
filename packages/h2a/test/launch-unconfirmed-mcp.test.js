import { describe, it } from "node:test";
import assert from "node:assert/strict";
const { executeH2aRunWithSpawn, executeH2aRunWithAsyncSpawn } = await import(process.env.QUAL_MCP_MODULE ?? "../dist/runtime/mcp/agent-launch.js");
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

describe("MCP adapter alignment: launch-unconfirmed", () => {
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
