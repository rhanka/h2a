// EVO-inbox-threading — `h2a thread` verb + envelope threadId/replyTo fields.
//
// Tests:
// 1. `h2a thread` returns only envelopes matching the given threadId, sorted
//    ascending by createdAt, deduped across inbox+outbox.
// 2. createEnvelope with threadId/replyTo round-trips through isH2AEnvelope.
// 3. A non-string threadId fails the isH2AEnvelope guard.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEnvelope, isH2AEnvelope } from "@sentropic/h2a";
import { createLocalStore, runCli } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

/** Minimal valid envelope JSON with optional threading fields. */
function makeEnvelope(id, createdAt, opts = {}) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:test:001", role: "AGENTS", scope: "scope:thread-test" },
    body: { kind: "message", text: "hello" },
    createdAt,
    ...opts
  };
}

test("h2a thread returns thread envelopes sorted ascending by createdAt, deduped", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-threading-"));
  const root = join(dir, ".h2a");
  // WP-2: use a bare alias (2 segments) as self so inbox puts are not refused
  // as malformed (3-seg non-12-hex was rejected). The registered entry makes
  // it resolve as deliver-dormant (registered, 0 live sessions).
  const self = "claude:test";
  const threadId = "thr:1700000000000:abcd";
  const otherThreadId = "thr:1700000000000:zzzz";

  try {
    const store = createLocalStore({ root });
    // WP-2: register the self instance so inbox puts resolve to deliver-dormant
    // (not phantom). The instance uses the test-style address claude:test:001;
    // register it with its id so the resolver finds it.
    store.registerInstance({
      id: "claude:test",
      instance: "claude:test",
      roles: ["AGENTS"],
      scopes: ["scope:thread-test"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: new Date().toISOString()
    });

    // Envelope in THREAD, deposited in inbox, createdAt: T+2 (out of order)
    const envT2 = makeEnvelope("env-thr-02", "2026-06-07T10:00:02.000Z", {
      threadId,
      replyTo: "env-thr-01"
    });
    // Envelope in THREAD, deposited in outbox, createdAt: T+1 (earliest in thread)
    const envT1 = makeEnvelope("env-thr-01", "2026-06-07T10:00:01.000Z", { threadId });
    // Envelope in THREAD, deposited in BOTH inbox and outbox → should appear once
    const envT3 = makeEnvelope("env-thr-03", "2026-06-07T10:00:03.000Z", {
      threadId,
      replyTo: "env-thr-02"
    });
    // Envelope with a DIFFERENT threadId → must NOT appear
    const envOther = makeEnvelope("env-other-01", "2026-06-07T09:00:00.000Z", {
      threadId: otherThreadId
    });

    const sink = captureStreams(dir);

    // Put envT2 in inbox
    runCli(
      ["inbox", "put", "--root", root, "--instance", self, "--json", JSON.stringify(envT2)],
      sink
    );
    // Put envT1 in outbox
    runCli(
      ["outbox", "put", "--root", root, "--instance", self, "--json", JSON.stringify(envT1)],
      sink
    );
    // Put envT3 in BOTH inbox and outbox (dedup test)
    runCli(
      ["inbox", "put", "--root", root, "--instance", self, "--json", JSON.stringify(envT3)],
      sink
    );
    runCli(
      ["outbox", "put", "--root", root, "--instance", self, "--json", JSON.stringify(envT3)],
      sink
    );
    // Put envOther in inbox (should not appear in thread result)
    runCli(
      ["inbox", "put", "--root", root, "--instance", self, "--json", JSON.stringify(envOther)],
      sink
    );

    const streams = captureStreams(dir);
    const rc = runCli(
      ["thread", "--id", threadId, "--instance", self, "--root", root],
      streams
    );

    assert.equal(rc, 0, `expected exit 0, got ${rc} (stderr: ${streams.stderrText})`);
    assert.equal(streams.stderrText, "", `unexpected stderr: ${streams.stderrText}`);

    const result = JSON.parse(streams.stdoutText);
    assert.ok(Array.isArray(result), "expected a JSON array");

    // Only 3 envelopes from the target thread
    assert.equal(result.length, 3, `expected 3 thread envelopes, got ${result.length}`);

    // Sorted ascending by createdAt
    assert.equal(result[0].id, "env-thr-01");
    assert.equal(result[1].id, "env-thr-02");
    assert.equal(result[2].id, "env-thr-03");

    // All carry the threadId
    for (const env of result) {
      assert.equal(env.threadId, threadId);
    }

    // replyTo preserved
    assert.equal(result[1].replyTo, "env-thr-01");
    assert.equal(result[2].replyTo, "env-thr-02");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a thread with no matching envelopes returns an empty array (exit 0)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-threading-empty-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["thread", "--id", "thr:0:0000", "--instance", "nobody:x", "--root", root],
      streams
    );
    assert.equal(rc, 0);
    const result = JSON.parse(streams.stdoutText);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a thread requires --id and --instance (exit 1 when missing)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-threading-flags-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    // Missing --instance
    const s1 = captureStreams(dir);
    const rc1 = runCli(["thread", "--id", "thr:1:aa", "--root", root], s1);
    assert.equal(rc1, 1);
    assert.match(s1.stderrText, /--id.*--instance|--instance.*--id/);

    // Missing --id
    const s2 = captureStreams(dir);
    const rc2 = runCli(["thread", "--instance", "some:agent", "--root", root], s2);
    assert.equal(rc2, 1);
    assert.match(s2.stderrText, /--id.*--instance|--instance.*--id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createEnvelope with threadId/replyTo passes isH2AEnvelope guard", () => {
  const envelope = createEnvelope({
    id: "env-guard-01",
    type: "event",
    actor: { instance: "claude:test:001", role: "AGENTS", scope: "scope:guard" },
    body: { kind: "message", text: "hi" },
    threadId: "thr:1700000000000:beef",
    replyTo: "env-prev-01"
  });

  assert.equal(envelope.threadId, "thr:1700000000000:beef");
  assert.equal(envelope.replyTo, "env-prev-01");
  assert.ok(
    isH2AEnvelope(envelope),
    "envelope with threadId/replyTo must pass isH2AEnvelope guard"
  );
});

test("isH2AEnvelope rejects non-string threadId", () => {
  const bad = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "env-bad-01",
    type: "event",
    actor: { instance: "claude:test:001", role: "AGENTS", scope: "scope:guard" },
    body: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    threadId: 42 // not a string
  };
  assert.equal(isH2AEnvelope(bad), false, "non-string threadId must fail the guard");
});

test("isH2AEnvelope rejects non-string replyTo", () => {
  const bad = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "env-bad-02",
    type: "event",
    actor: { instance: "claude:test:001", role: "AGENTS", scope: "scope:guard" },
    body: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    replyTo: { id: "some-id" } // not a string
  };
  assert.equal(isH2AEnvelope(bad), false, "non-string replyTo must fail the guard");
});
