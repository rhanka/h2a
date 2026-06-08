// EVO-host-prefix-guard — reject bare-label (host-less) addressing at every
// user-facing send entry point so mis-routed orphan inboxes are impossible.
//
// Tests:
// 1. isHostQualifiedAddress — unit: valid/invalid cases.
// 2. CLI `inbox put` with bare label → exit 1 + stderr "host-qualified".
// 3. CLI `inbox put` with host-qualified label → exit 0 (happy path).
// 4. MCP handleInbox "put" with bare label → { error: "host-qualified" }.
// 5. MCP handleInbox "put" with host-qualified label → no error.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isHostQualifiedAddress, runCli, createLocalStore } from "../dist/index.js";
import { handleInbox } from "../dist/runtime/mcp/handlers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

function makeEnvelope(id) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:test:001", role: "AGENTS", scope: "scope:guard-test" },
    body: { kind: "message", text: "hello" },
    createdAt: "2026-06-07T00:00:00.000Z"
  };
}

// ---------------------------------------------------------------------------
// 1. isHostQualifiedAddress — unit
// ---------------------------------------------------------------------------

test("isHostQualifiedAddress: true for valid host-qualified addresses", () => {
  assert.equal(isHostQualifiedAddress("claude:radar-immobilier"), true, "host:label");
  assert.equal(isHostQualifiedAddress("claude:proj:abc123"), true, "host:label:uuid");
  assert.equal(isHostQualifiedAddress("codex:x:uuid~Researcher"), true, "host:label:uuid~name");
  assert.equal(isHostQualifiedAddress("remote:sess-123"), true, "remote:label");
});

test("isHostQualifiedAddress: false for bare or malformed addresses", () => {
  assert.equal(isHostQualifiedAddress("radar-immobilier"), false, "bare label, no colon");
  assert.equal(isHostQualifiedAddress(""), false, "empty string");
  assert.equal(isHostQualifiedAddress(":label"), false, "empty host segment");
  assert.equal(isHostQualifiedAddress("host:"), false, "empty label segment");
  assert.equal(isHostQualifiedAddress("~name"), false, "bare subagent name with no instance");
});

// ---------------------------------------------------------------------------
// 2. CLI: inbox put with bare label → exit 1 + stderr mentions "host-qualified"
// ---------------------------------------------------------------------------

test("CLI inbox put with bare label exits 1 and stderr mentions host-qualified", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-guard-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "inbox", "put",
        "--root", root,
        "--instance", "radar-immobilier",
        "--json", JSON.stringify(makeEnvelope("env-guard-bare"))
      ],
      streams
    );
    assert.equal(rc, 1, `expected exit 1, got ${rc} (stdout: ${streams.stdoutText})`);
    assert.match(
      streams.stderrText,
      /host-qualified/,
      `expected "host-qualified" in stderr, got: ${streams.stderrText}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. CLI: inbox put with host-qualified label → exit 0 (happy path)
// ---------------------------------------------------------------------------

test("CLI inbox put with host-qualified instance exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-guard-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "inbox", "put",
        "--root", root,
        "--instance", "claude:radar-immobilier",
        "--json", JSON.stringify(makeEnvelope("env-guard-qualified"))
      ],
      streams
    );
    assert.equal(rc, 0, `expected exit 0, got ${rc} (stderr: ${streams.stderrText})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. MCP handleInbox "put" with bare label → { error: "host-qualified" }
// ---------------------------------------------------------------------------

test("MCP handleInbox put with bare label returns error containing host-qualified", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-guard-mcp-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const store = createLocalStore({ root });
    const result = handleInbox(store, {
      action: "put",
      instance: "radar-immobilier",
      envelope: makeEnvelope("env-mcp-bare")
    });
    assert.ok(typeof result.error === "string", `expected error string, got: ${JSON.stringify(result)}`);
    assert.match(
      result.error,
      /host-qualified/,
      `expected "host-qualified" in error, got: ${result.error}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. MCP handleInbox "put" with host-qualified label → no error
// ---------------------------------------------------------------------------

test("MCP handleInbox put with host-qualified instance succeeds (no error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-guard-mcp-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const store = createLocalStore({ root });
    const result = handleInbox(store, {
      action: "put",
      instance: "claude:radar-immobilier",
      envelope: makeEnvelope("env-mcp-qualified")
    });
    assert.ok(
      !result.error,
      `expected no error, got: ${JSON.stringify(result)}`
    );
    assert.equal(result.ok, true, `expected ok: true, got: ${JSON.stringify(result)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
