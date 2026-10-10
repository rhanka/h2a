import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeH2aRunWithSpawn } from "../dist/index.js";

describe("MCP adapter alignment: launch-unconfirmed", () => {
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
