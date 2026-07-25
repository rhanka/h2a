// WP-6: readHostSessionName — host-native session name reading
//
// Tests:
//  1. Claude: returns customTitle from transcript (preferred over agentName, aiTitle)
//  2. Claude: falls back to agentName when no customTitle
//  3. Claude: never returns aiTitle
//  4. Claude: LAST customTitle wins (amended 2026-07-25 — see the test) (across multiple lines)
//  5. Codex: returns thread_name for matching session id (last-match wins)
//  6. Codex: returns undefined when session id not found
//  7. Unknown host: returns undefined
//  8. No sessionId: returns undefined
//  9. Integration: sessions --name finds a session whose presence.name is set

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readHostSessionName, runCli } from "../dist/index.js";
import { writePresence } from "../dist/runtime/local-files/presence.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

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

/**
 * Create a temporary home-like directory with a claude transcript fixture.
 * The transcript is placed at:
 *   <fakeHome>/.claude/projects/proj-hash/<sessionId>.jsonl
 *
 * Because `findClaudeTranscript` uses `readers.homedir()` to locate the file,
 * injecting `fakeHome` as homedir is sufficient to redirect the scan.
 *
 * Returns { fakeHome, sessionId, cleanup }.
 */
function makeClaudeFixture(lines) {
  const fakeHome = mkdtempSync(join(tmpdir(), "wp6-claude-home-"));
  const sessionId = `test-claude-${Date.now()}`;
  const projDir = join(fakeHome, ".claude", "projects", "proj-abc123");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, `${sessionId}.jsonl`), lines.join("\n") + "\n", "utf8");
  return {
    fakeHome,
    sessionId,
    cleanup: () => rmSync(fakeHome, { recursive: true, force: true })
  };
}

/**
 * Build a HostNameReaders that:
 * - reads real files from disk (for claude transcript fixture files)
 * - returns supplied JSONL lines for the codex session index
 * - uses fakeHome as homedir (so findClaudeTranscript scans the right place)
 */
function makeReaders({ fakeHome = tmpdir(), codexIndexLines = [] } = {}) {
  return {
    readTailLines(path, maxBytes) {
      try {
        const raw = readFileSync(path);
        const start = Math.max(0, raw.length - maxBytes);
        const lines = raw.subarray(start).toString("utf8").split("\n");
        if (start > 0) lines.shift();
        return lines;
      } catch {
        return [];
      }
    },
    readCodexSessionIndex() {
      return codexIndexLines;
    },
    homedir() {
      return fakeHome;
    }
  };
}

// ─── 1. Claude: prefers customTitle ────────────────────────────────────────

test("readHostSessionName: claude returns customTitle (preferred over agentName and aiTitle)", () => {
  const { fakeHome, sessionId, cleanup } = makeClaudeFixture([
    JSON.stringify({ type: "summary", aiTitle: "AI Generated Title", agentName: "AgentName", customTitle: "My Custom Title" })
  ]);
  try {
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId,
      readers: makeReaders({ fakeHome })
    });
    assert.equal(result, "My Custom Title", `expected "My Custom Title", got ${result}`);
  } finally {
    cleanup();
  }
});

// ─── 2. Claude: falls back to agentName ────────────────────────────────────

test("readHostSessionName: claude falls back to agentName when no customTitle", () => {
  const { fakeHome, sessionId, cleanup } = makeClaudeFixture([
    JSON.stringify({ type: "summary", agentName: "MyAgentName", aiTitle: "AI Auto Title" })
  ]);
  try {
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId,
      readers: makeReaders({ fakeHome })
    });
    assert.equal(result, "MyAgentName", `expected "MyAgentName", got ${result}`);
  } finally {
    cleanup();
  }
});

// ─── 3. Claude: never returns aiTitle ─────────────────────────────────────

test("readHostSessionName: claude never returns aiTitle (returns undefined)", () => {
  const { fakeHome, sessionId, cleanup } = makeClaudeFixture([
    JSON.stringify({ type: "summary", aiTitle: "AI Auto Title" })
  ]);
  try {
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId,
      readers: makeReaders({ fakeHome })
    });
    assert.equal(result, undefined, `expected undefined (aiTitle must be ignored), got ${result}`);
  } finally {
    cleanup();
  }
});

// ─── 4. Claude: LAST customTitle wins across multiple lines ─────────────────
//
// AMENDED 2026-07-25 (spec docs/specs/2026-07-25-h2a-lane-addressing.md §RC-1).
// This test previously asserted that the FIRST customTitle wins. That assertion
// encoded the bug: a Claude transcript is APPEND-ONLY and stamps customTitle on
// nearly every record, so a /rename appends the NEW title at the END and the
// first match is the title as of session start — permanently. Measured live: one
// transcript held 1022 records saying "39etc" then 65 saying "auth"; the reader
// returned "39etc" while the human saw "auth" in the pane, so
// discover_sessions(name: "auth") returned nothing and a consultation misrouted.
// Codex (thread_name) already did last-match-wins; Claude was the outlier.

test("readHostSessionName: claude takes the LAST customTitle (a rename appends)", () => {
  const { fakeHome, sessionId, cleanup } = makeClaudeFixture([
    JSON.stringify({ agentName: "AgentFirst" }),
    JSON.stringify({ customTitle: "ActualTitle" }),
    JSON.stringify({ customTitle: "SecondTitle" })
  ]);
  try {
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId,
      readers: makeReaders({ fakeHome })
    });
    // customTitle still wins over agentName; among titles, the newest wins.
    assert.equal(result, "SecondTitle", `expected "SecondTitle", got ${result}`);
  } finally {
    cleanup();
  }
});

// ─── 5. Codex: returns thread_name (last-match wins) ─────────────────────

test("readHostSessionName: codex returns thread_name, last-match wins", () => {
  const readers = makeReaders({
    codexIndexLines: [
      JSON.stringify({ id: "sess-aaa", thread_name: "OtherSession", updated_at: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ id: "sess-bbb", thread_name: "MyCodexThread", updated_at: "2026-01-02T00:00:00Z" }),
      // duplicate id: last match wins
      JSON.stringify({ id: "sess-bbb", thread_name: "MyCodexThreadUpdated", updated_at: "2026-01-03T00:00:00Z" })
    ]
  });
  const result = readHostSessionName({
    host: "codex",
    cwd: tmpdir(),
    sessionId: "sess-bbb",
    readers
  });
  assert.equal(result, "MyCodexThreadUpdated", `expected "MyCodexThreadUpdated", got ${result}`);
});

// ─── 6. Codex: undefined when session id not found ─────────────────────────

test("readHostSessionName: codex returns undefined when sessionId not in index", () => {
  const readers = makeReaders({
    codexIndexLines: [
      JSON.stringify({ id: "sess-other", thread_name: "SomeName", updated_at: "2026-01-01T00:00:00Z" })
    ]
  });
  const result = readHostSessionName({
    host: "codex",
    cwd: tmpdir(),
    sessionId: "sess-missing",
    readers
  });
  assert.equal(result, undefined);
});

// ─── 7. Unknown host: undefined ───────────────────────────────────────────

test("readHostSessionName: unknown host returns undefined", () => {
  const readers = makeReaders();
  const result = readHostSessionName({ host: "gemini", cwd: tmpdir(), sessionId: "x", readers });
  assert.equal(result, undefined);
});

// ─── 8. No sessionId: undefined ───────────────────────────────────────────

test("readHostSessionName: returns undefined when sessionId is undefined", () => {
  const readers = makeReaders();
  const result = readHostSessionName({ host: "claude", cwd: tmpdir(), sessionId: undefined, readers });
  assert.equal(result, undefined);
});

// ─── 9. Integration: sessions --name finds a session with name set ─────────

test("sessions --name finds a session whose presence.name is set from host naming", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp6-hostsname-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    // Simulate what WP-6 wiring produces: resolveLiveIdentity reads the codex
    // thread_name "radar_pipeline" and stores it as presence.name.
    writePresence(root, {
      sessionId: "sess-wp6-radar",
      instance: "codex:radar_pipeline:abc123def456",
      host: "codex",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: [
        "presence.peer_joined",
        "presence.peer_left",
        "inbox.envelope_arrived",
        "negotiation.event_appended"
      ],
      name: "radar_pipeline"
    });

    // sessions --name "radar" (substring match) should find it
    const streams = captureStreams(dir);
    const rc = runCli(["sessions", "--root", root, "--name", "radar"], streams);
    assert.equal(rc, 0, `sessions should exit 0; stderr: ${streams.stderrText}`);
    const found = JSON.parse(streams.stdoutText);
    assert.ok(Array.isArray(found), "sessions output should be an array");
    assert.equal(found.length, 1, `expected 1 session matching 'radar'; got ${found.length}`);
    assert.equal(found[0].name, "radar_pipeline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
