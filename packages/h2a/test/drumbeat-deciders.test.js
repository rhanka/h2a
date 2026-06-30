import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loggingDecider,
  subagentDecider,
  recordDrumbeatDecision,
  listDrumbeatDecisions
} from "../dist/index.js";

const finding = {
  instance: "claude:p1",
  reason: "out-of-tokens",
  workStatus: "out-of-tokens",
  relanceCount: 2
};

test("loggingDecider always relances", async () => {
  assert.equal((await loggingDecider().decide(finding)).action, "relance");
});

test("subagentDecider maps the command's JSON stdout to a decision", async () => {
  const runtime = { run: () => ({ status: 0, stdout: '{"action":"escalate","reason":"stuck"}' }) };
  const d = await subagentDecider({ command: "fake-cli", runtime }).decide(finding);
  assert.equal(d.action, "escalate");
  assert.equal(d.reason, "stuck");
});

test("subagentDecider → relance on non-zero exit", async () => {
  const runtime = { run: () => ({ status: 1, stdout: "" }) };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider → relance on garbage stdout", async () => {
  const runtime = { run: () => ({ status: 0, stdout: "no json here" }) };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider → relance when the runtime throws (timeout/spawn error)", async () => {
  const runtime = {
    run: () => {
      throw new Error("ETIMEDOUT");
    }
  };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider forwards the finding context as the command argument (not stdin)", async () => {
  let seen;
  const runtime = {
    run: (cmd, prompt) => {
      seen = { cmd, prompt };
      return { status: 0, stdout: '{"action":"finish"}' };
    }
  };
  await subagentDecider({ command: "judge-cli", runtime }).decide(finding);
  assert.equal(seen.cmd, "judge-cli");
  assert.match(seen.prompt, /claude:p1/);
  assert.match(seen.prompt, /out-of-tokens/);
  // untrusted agent fields are delimited as data, not instructions
  assert.match(seen.prompt, /untrusted/i);
});

test("decision audit log round-trips decided vs applied", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-d5-"));
  const root = join(dir, ".h2a");
  try {
    recordDrumbeatDecision(root, {
      instance: "claude:p1",
      decided: "finish",
      applied: "escalate",
      reason: "looked done",
      decider: "subagent",
      enforced: false,
      at: "2026-05-30T00:00:00.000Z"
    });
    const rows = listDrumbeatDecisions(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decided, "finish");
    assert.equal(rows[0].applied, "escalate");
    assert.equal(rows[0].enforced, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
