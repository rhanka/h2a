import assert from "node:assert/strict";
import test from "node:test";

import { resolveProviderSession } from "../dist/index.js";

// Fake readers: the per-host dispatch is what we test (FS readers are the
// impure default, exercised separately/live). Each reader returns a fixed value.
function readers(overrides = {}) {
  return {
    env: (n) => (overrides.env ? overrides.env[n] : undefined),
    codexThreadForCwd: () => overrides.codex,
    geminiSessionForCwd: () => overrides.gemini,
    agyConversationForCwd: () => overrides.agy
  };
}

test("claude → CLAUDE_CODE_SESSION_ID from env", () => {
  const r = resolveProviderSession({
    host: "claude",
    cwd: "/w",
    readers: readers({ env: { CLAUDE_CODE_SESSION_ID: "uuid-c" } })
  });
  assert.deepEqual(r, { providerSessionId: "uuid-c", source: "env" });
});

test("claude → none when the env var is absent", () => {
  const r = resolveProviderSession({ host: "claude", cwd: "/w", readers: readers() });
  assert.deepEqual(r, { source: "none" });
});

test("remote → SESSION_ID + SESSION_WORKSPACE_ID from the bridge", () => {
  const r = resolveProviderSession({
    host: "remote",
    cwd: "/w",
    readers: readers({ env: { SESSION_ID: "sess-r", SESSION_WORKSPACE_ID: "ws-7" } })
  });
  assert.deepEqual(r, { providerSessionId: "sess-r", source: "bridge", workspaceHint: "ws-7" });
});

test("remote → none without SESSION_ID (even if a workspace id is present)", () => {
  const r = resolveProviderSession({
    host: "remote",
    cwd: "/w",
    readers: readers({ env: { SESSION_WORKSPACE_ID: "ws-7" } })
  });
  assert.deepEqual(r, { source: "none" });
});

test("codex / gemini / agy → transcript via their reader", () => {
  assert.deepEqual(resolveProviderSession({ host: "codex", cwd: "/w", readers: readers({ codex: "t-x" }) }), {
    providerSessionId: "t-x",
    source: "transcript"
  });
  assert.deepEqual(resolveProviderSession({ host: "gemini", cwd: "/w", readers: readers({ gemini: "g-y" }) }), {
    providerSessionId: "g-y",
    source: "transcript"
  });
  assert.deepEqual(resolveProviderSession({ host: "agy", cwd: "/w", readers: readers({ agy: "a-z" }) }), {
    providerSessionId: "a-z",
    source: "transcript"
  });
});

test("transcript hosts → none when the reader finds nothing (caller will mint)", () => {
  for (const host of ["codex", "gemini", "agy"]) {
    assert.deepEqual(resolveProviderSession({ host, cwd: "/w", readers: readers() }), { source: "none" });
  }
});

test("unknown host → none", () => {
  assert.deepEqual(resolveProviderSession({ host: "weird", cwd: "/w", readers: readers() }), { source: "none" });
});
