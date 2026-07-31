// Spec: docs/specs/2026-07-25-h2a-lane-addressing.md — D1 (host-native display
// name into presence, at heartbeat).
//
// Covers the two root causes measured on the live bus:
//   RC-1  the Claude title reader scanned the FIRST 40 lines of an APPEND-ONLY
//         transcript, so it returned the title as of session start and could
//         never observe a /rename.
//   RC-2  updatePresence's patch type had no `name`, so nothing on the heartbeat
//         path could ever refresh the display name after session open.
//
// Consequence measured 2026-07-25: discover_sessions(name: "auth") returned [],
// while two panes were titled "auth" and their presence names were "39etc" and
// "sentropic". A consultation for the auth lane misrouted.
//
// Tests:
//   Reader / tail semantics (RC-1)
//    1. last customTitle wins over an earlier one
//    2. customTitle wins over agentName regardless of order
//    3. agentName fallback when no customTitle anywhere
//    4. aiTitle never returned
//    5. a title beyond the old 40-line head window IS found
//    6. a title beyond the tail window is NOT found -> undefined
//    7. tail read of a file smaller than the window keeps every line
//    8. a truncated leading record in the tail window is discarded, not mis-parsed
//    9. codex last-match-wins unchanged
//   Refresh path (RC-2)
//   10. updatePresence({ name }) writes the name and preserves every other field
//   11. updatePresence ignores an empty name (never blanks a good one)
//   12. touch() writes the new name when the resolver's value changed
//   13. touch() does not rewrite the name when the value is unchanged
//   14. touch() keeps the previous name when the resolver returns undefined
//   15. touch() keeps the previous name when the resolver throws, heartbeat still advances
//   16. no resolver installed (explicit --name) -> the name is never touched
//   Integration
//   17. cwd-basename fallback at open, then a rename converges and becomes
//       findable by name (the end-to-end shape of the measured defect)

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CLAUDE_TITLE_TAIL_BYTES,
  MAX_DISPLAY_NAME_CHARS,
  createHostSessionNameRefresher,
  readHostSessionName,
  runCli
} from "../dist/index.js";
import {
  readPresence,
  updatePresence,
  writePresence
} from "../dist/runtime/local-files/presence.js";
import { SessionRegistry } from "../dist/runtime/mcp/sessions.js";
// The PRODUCTION tail reader (the tests above inject their own), and the wiring
// that decides whether to follow the host title at all.
import { defaultHostNameReaders } from "../dist/runtime/identity/readers.js";
import { resolveAutoOpen } from "../dist/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

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

/** A fake home containing a Claude transcript at the real layout. */
function makeClaudeHome() {
  const fakeHome = mkdtempSync(join(tmpdir(), "lane-addr-home-"));
  const sessionId = `sess-${Math.random().toString(16).slice(2)}`;
  const projDir = join(fakeHome, ".claude", "projects", "proj-abc123");
  mkdirSync(projDir, { recursive: true });
  const transcript = join(projDir, `${sessionId}.jsonl`);
  const write = (lines) => writeFileSync(transcript, lines.join("\n") + "\n", "utf8");
  return {
    fakeHome,
    sessionId,
    transcript,
    write,
    cleanup: () => rmSync(fakeHome, { recursive: true, force: true })
  };
}

/** Real-FS tail reader + injectable homedir/codex index. */
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

function baseSession(overrides = {}) {
  const now = new Date().toISOString();
  return {
    sessionId: "sess-lane-1",
    instance: "claude:sentropic:cff455ad5eaf",
    host: "claude",
    workspace: {
      id: "ws:abc",
      path: "/home/u/src/sentropic",
      host: "claude",
      label: "sentropic"
    },
    name: "sentropic",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: ["inbox.envelope_arrived"],
    ...overrides
  };
}

function withRoot(fn) {
  const dir = mkdtempSync(join(tmpdir(), "lane-addr-root-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    return fn(root, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 1. last customTitle wins ─────────────────────────────────────────────

test("reader: the LAST customTitle wins (a rename appends to the transcript)", () => {
  const fx = makeClaudeHome();
  try {
    // The live shape: many records with the old title, then the rename.
    fx.write([
      ...Array.from({ length: 20 }, () => JSON.stringify({ type: "custom-title", customTitle:"39etc" })),
      JSON.stringify({ type: "custom-title", customTitle:"auth" })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result, "auth", `expected the newest title "auth", got ${result}`);
  } finally {
    fx.cleanup();
  }
});

// ─── 2. customTitle beats agentName regardless of order ───────────────────

test("reader: customTitle beats agentName even when agentName is newer", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([
      JSON.stringify({ type: "custom-title", customTitle:"TheTitle" }),
      JSON.stringify({ agentName: "SomeAgent" })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result, "TheTitle");
  } finally {
    fx.cleanup();
  }
});

// ─── 3. agentName fallback ────────────────────────────────────────────────

test("reader: falls back to the first agentName when no customTitle exists", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([
      JSON.stringify({ type: "user" }),
      JSON.stringify({ agentName: "FirstAgent" }),
      JSON.stringify({ agentName: "SecondAgent" })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    // agentName is not user-mutable, so recency is meaningless: first seen wins.
    assert.equal(result, "FirstAgent");
  } finally {
    fx.cleanup();
  }
});

// ─── 4. aiTitle never returned ────────────────────────────────────────────

test("reader: aiTitle is never returned, even as a last resort", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([JSON.stringify({ aiTitle: "Auto Generated Summary" })]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result, undefined);
  } finally {
    fx.cleanup();
  }
});

// ─── 5. a title beyond the old 40-line head window IS found ───────────────

test("reader: finds a rename that sits far beyond the old 40-line head window", () => {
  const fx = makeClaudeHome();
  try {
    // 500 records of the stale title, then the rename. The pre-fix reader read
    // the first 40 lines and broke on the first match, so it could only ever
    // return "39etc". This is exactly the live measurement (1022 then 65).
    fx.write([
      ...Array.from({ length: 500 }, (_, i) =>
        JSON.stringify({ type: "custom-title", seq: i, customTitle: "39etc" })
      ),
      JSON.stringify({ type: "custom-title", customTitle:"auth" })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(
      result,
      "auth",
      `RC-1 regression: a rename past line 40 must still be seen; got ${result}`
    );
  } finally {
    fx.cleanup();
  }
});

// ─── 6. a title beyond the TAIL window is not found ───────────────────────

test("reader: a title older than the tail window yields undefined (not a wrong name)", () => {
  const fx = makeClaudeHome();
  try {
    // One title, then enough padding to push it out of the tail window.
    const padding = Array.from(
      { length: Math.ceil(CLAUDE_TITLE_TAIL_BYTES / 64) + 200 },
      () => JSON.stringify({ pad: "x".repeat(48) })
    );
    fx.write([JSON.stringify({ type: "custom-title", customTitle:"VeryOldTitle" }), ...padding]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    // Bounded read is a deliberate trade (a live transcript is tens of MB). The
    // safety net is D1's keep-previous rule: undefined never downgrades a name.
    assert.equal(result, undefined);
  } finally {
    fx.cleanup();
  }
});

// ─── 7. small file: every line kept ───────────────────────────────────────

test("reader: a file smaller than the tail window keeps its very first record", () => {
  const fx = makeClaudeHome();
  try {
    // The title is on the FIRST line and the file is tiny: the tail reader must
    // not drop it as a partial record.
    fx.write([JSON.stringify({ type: "custom-title", customTitle:"OnlyOnLineOne" }), JSON.stringify({ x: 1 })]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result, "OnlyOnLineOne");
  } finally {
    fx.cleanup();
  }
});

// ─── 8. truncated leading record is discarded, not mis-parsed ─────────────

test("reader: a truncated leading record in the tail window is ignored", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([
      JSON.stringify({ type: "custom-title", customTitle:"ShouldBeCutOff", pad: "y".repeat(200) }),
      JSON.stringify({ type: "custom-title", customTitle:"TheCurrentOne" })
    ]);
    // A window that lands mid-way through the first record.
    const readers = makeReaders({ fakeHome: fx.fakeHome });
    const tiny = {
      ...readers,
      readTailLines: (path) => readers.readTailLines(path, 60)
    };
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: tiny
    });
    // The truncated first line must not throw and must not be half-parsed; the
    // intact newest record still resolves.
    assert.equal(result, "TheCurrentOne");
  } finally {
    fx.cleanup();
  }
});

// ─── 9. codex unchanged ───────────────────────────────────────────────────

test("reader: codex thread_name still resolves last-match-wins", () => {
  const readers = makeReaders({
    codexIndexLines: [
      JSON.stringify({ id: "t1", thread_name: "old-name" }),
      JSON.stringify({ id: "t1", thread_name: "new-name" })
    ]
  });
  const result = readHostSessionName({
    host: "codex",
    cwd: tmpdir(),
    sessionId: "t1",
    readers
  });
  assert.equal(result, "new-name");
});

// ─── 10. updatePresence writes name, preserves the rest ───────────────────

test("updatePresence({ name }) writes the new name and preserves every other field", () => {
  withRoot((root) => {
    const session = baseSession();
    writePresence(root, session);

    const updated = updatePresence(root, session.sessionId, { name: "auth" });
    assert.equal(updated.name, "auth");
    assert.equal(updated.instance, session.instance, "the routing handle must not move");
    assert.equal(updated.startedAt, session.startedAt);
    assert.equal(updated.state, "live");
    assert.deepEqual(updated.workspace, session.workspace);

    const onDisk = readPresence(root, session.sessionId);
    assert.equal(onDisk.name, "auth", "the change must be durable, not in-memory only");
  });
});

// ─── 11. empty name never blanks a good one ───────────────────────────────

test("updatePresence ignores an empty name rather than blanking a good one", () => {
  withRoot((root) => {
    const session = baseSession();
    writePresence(root, session);
    const updated = updatePresence(root, session.sessionId, { name: "" });
    assert.equal(updated.name, "sentropic");
  });
});

// ─── 12. touch() writes a changed name ────────────────────────────────────

test("touch(): writes the new display name when the host title changed", () => {
  withRoot((root) => {
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:sentropic:cff455ad5eaf",
      host: "claude",
      name: "sentropic"
    });
    assert.equal(opened.name, "sentropic");

    let title = "sentropic";
    registry.setDisplayNameResolver(opened.sessionId, () => title);

    title = "auth"; // the human renames the conversation
    const touched = registry.touch(opened.sessionId);

    assert.equal(touched.name, "auth", "a rename must converge within one heartbeat");
    assert.equal(
      readPresence(root, opened.sessionId).name,
      "auth",
      "presence on disk is what peers discover — it must carry the new name"
    );
    registry.close(opened.sessionId);
  });
});

// ─── 13. touch() does not rewrite an unchanged name ───────────────────────

test("touch(): leaves the name alone when the resolver reports no change", () => {
  withRoot((root) => {
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:sentropic:cff455ad5eaf",
      host: "claude",
      name: "auth"
    });
    let calls = 0;
    registry.setDisplayNameResolver(opened.sessionId, () => {
      calls += 1;
      return "auth";
    });
    const touched = registry.touch(opened.sessionId);
    assert.equal(touched.name, "auth");
    assert.equal(calls, 1, "the resolver is consulted once per heartbeat");
    registry.close(opened.sessionId);
  });
});

// ─── 14. undefined keeps the previous name ────────────────────────────────

test("touch(): keeps the previous name when the title is unreadable", () => {
  withRoot((root) => {
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:sentropic:cff455ad5eaf",
      host: "claude",
      name: "auth",
      // The workspace label is the cwd basename and DIFFERS from the display
      // name — this is the live shape (cwd /home/.../sentropic, lane "auth").
      // It is here so that a regression which falls back to the label instead of
      // keeping the name is detectable rather than silently equivalent.
      workspace: {
        id: "ws:abc",
        path: "/home/u/src/sentropic",
        host: "claude",
        label: "sentropic"
      }
    });
    // Transcript rotated / deleted / not yet findable.
    registry.setDisplayNameResolver(opened.sessionId, () => undefined);
    const touched = registry.touch(opened.sessionId);
    assert.equal(
      touched.name,
      "auth",
      "an unreadable title must NEVER downgrade a real name to the cwd basename"
    );
    assert.equal(
      readPresence(root, opened.sessionId).name,
      "auth",
      "and the downgrade must not reach disk either"
    );
    registry.close(opened.sessionId);
  });
});

// ─── 15. a throwing resolver cannot break the heartbeat ───────────────────

test("touch(): a throwing resolver keeps the name and still advances the heartbeat", () => {
  withRoot((root) => {
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:sentropic:cff455ad5eaf",
      host: "claude",
      name: "auth"
    });
    registry.setDisplayNameResolver(opened.sessionId, () => {
      throw new Error("transcript read blew up");
    });
    const before = readPresence(root, opened.sessionId).heartbeatAt;
    const touched = registry.touch(opened.sessionId);
    assert.equal(touched.name, "auth");
    assert.ok(
      Date.parse(touched.heartbeatAt) >= Date.parse(before),
      "liveness must survive a naming bug — the heartbeat still lands"
    );
    registry.close(opened.sessionId);
  });
});

// ─── 16. explicit --name is never overwritten ──────────────────────────────

test("touch(): with no resolver installed the name is frozen (explicit --name)", () => {
  withRoot((root) => {
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:my-operator-name:cff455ad5eaf",
      host: "claude",
      name: "my-operator-name"
    });
    // No setDisplayNameResolver call: this is what an explicit --name produces.
    const touched = registry.touch(opened.sessionId);
    assert.equal(touched.name, "my-operator-name");
    registry.close(opened.sessionId);
  });
});

// ─── 17. end-to-end: the measured defect, and its convergence ─────────────

test("end-to-end: a cwd-basename name converges to the host title and becomes findable", () => {
  const fx = makeClaudeHome();
  const dir = mkdtempSync(join(tmpdir(), "lane-addr-e2e-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    // Boot with no title yet readable: the name is the cwd basename. This is the
    // measured state of pane %37 — presence said "sentropic", the human saw
    // "auth", and discover_sessions(name: "auth") returned [].
    fx.write([JSON.stringify({ type: "user" })]);
    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open({
      instance: "claude:sentropic:cff455ad5eaf",
      host: "claude",
      name: "sentropic"
    });

    const found0 = JSON.parse(
      (() => {
        const s = captureStreams(dir);
        runCli(["sessions", "--root", root, "--name", "auth"], s);
        return s.stdoutText;
      })()
    );
    assert.equal(found0.length, 0, "precondition: the auth lane is unreachable by name");

    // The refresher follows the same transcript for the life of the session.
    registry.setDisplayNameResolver(
      opened.sessionId,
      createHostSessionNameRefresher({
        host: "claude",
        cwd: dir,
        sessionId: fx.sessionId,
        readers: makeReaders({ fakeHome: fx.fakeHome })
      })
    );

    // The human renames the conversation: the host appends the new title.
    fx.write([
      JSON.stringify({ type: "user" }),
      JSON.stringify({ type: "custom-title", customTitle:"auth" })
    ]);

    registry.touch(opened.sessionId);

    const streams = captureStreams(dir);
    const rc = runCli(["sessions", "--root", root, "--name", "auth"], streams);
    assert.equal(rc, 0, `sessions should exit 0; stderr: ${streams.stderrText}`);
    const found = JSON.parse(streams.stdoutText);
    assert.equal(found.length, 1, `the auth lane must now be findable; got ${found.length}`);
    assert.equal(found[0].name, "auth");
    // The address never moved — a rename is display-only (frozen handle).
    assert.equal(found[0].instance, "claude:sentropic:cff455ad5eaf");

    registry.close(opened.sessionId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    fx.cleanup();
  }
});

// ─── 18-20. the PRODUCTION tail reader (tests 1-9 inject their own) ─────────

test("defaultHostNameReaders.readTailLines: drops the truncated leading record", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-addr-tail-"));
  const f = join(dir, "t.jsonl");
  try {
    // Three ~100-byte records; a 150-byte window necessarily lands mid-record.
    const rec = (i) => JSON.stringify({ i, pad: "z".repeat(80) });
    writeFileSync(f, [rec(1), rec(2), rec(3)].join("\n") + "\n", "utf8");

    const lines = defaultHostNameReaders.readTailLines(f, 150);
    for (const line of lines) {
      if (!line.trim()) continue;
      assert.doesNotThrow(
        () => JSON.parse(line),
        `every returned line must be a whole record, got: ${line.slice(0, 40)}`
      );
    }
    assert.ok(lines.length > 0, "a 150-byte window must still yield records");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultHostNameReaders.readTailLines: keeps the first record of a small file", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-addr-tail-small-"));
  const f = join(dir, "t.jsonl");
  try {
    writeFileSync(f, JSON.stringify({ type: "custom-title", customTitle:"only" }) + "\n", "utf8");
    const lines = defaultHostNameReaders.readTailLines(f, CLAUDE_TITLE_TAIL_BYTES);
    assert.ok(
      lines.some((l) => l.includes("only")),
      "a file smaller than the window must not lose its first line"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultHostNameReaders.readTailLines: returns [] for a missing file", () => {
  assert.deepEqual(
    defaultHostNameReaders.readTailLines(
      join(tmpdir(), "lane-addr-nope-does-not-exist.jsonl"),
      1024
    ),
    []
  );
});

// ─── 22-24. item 4: negative caching of a transcript MISS ──────────────────
//
// A session whose transcript never appears is the spec's RC-3 case (measured
// live: CLAUDE_CODE_SESSION_ID=0f6c3a97-… has no transcript anywhere). Before
// negative caching, that session re-walked ~/.claude/projects — 87 dirs, 14345
// files, 8.73 ms — on EVERY heartbeat, i.e. every 5 s, forever.

function countingReaders({ fakeHome = tmpdir(), transcript = undefined } = {}) {
  const base = makeReaders({ fakeHome });
  let scans = 0;
  return {
    readers: {
      ...base,
      findClaudeTranscript() {
        scans += 1;
        return transcript;
      }
    },
    get scans() {
      return scans;
    }
  };
}

test("refresher: a repeated MISS does not re-walk the filesystem", () => {
  const c = countingReaders({ transcript: undefined });
  let clock = 1_000_000;
  const refresh = createHostSessionNameRefresher({
    host: "claude",
    cwd: tmpdir(),
    sessionId: "sess-missing",
    readers: c.readers,
    now: () => clock
  });

  assert.equal(refresh(), undefined);
  assert.equal(c.scans, 1, "the first call must attempt the lookup");

  // 100 further heartbeats that all land INSIDE the first backoff window
  // (100 x 500 ms = 50 s < TRANSCRIPT_MISS_BACKOFF_MS = 60 s).
  for (let i = 0; i < 100; i += 1) {
    clock += 500;
    assert.equal(refresh(), undefined);
  }
  assert.equal(
    c.scans,
    1,
    `a cached miss must not re-walk inside the window: expected 1 scan, got ${c.scans}`
  );

  // And at the REAL cadence the growth must be logarithmic, not linear: 500
  // further heartbeats 5 s apart is ~42 minutes of uptime. Un-cached that is 500
  // filesystem walks at 8.73 ms each; with backoff it is a handful.
  for (let i = 0; i < 500; i += 1) {
    clock += 5_000;
    refresh();
  }
  assert.ok(
    c.scans <= 12,
    `expected backoff to keep scans in single digits over ~42 min, got ${c.scans}`
  );
});

test("refresher: the negative cache expires, so a late transcript is still found", () => {
  const c = countingReaders({ transcript: undefined });
  let clock = 0;
  const refresh = createHostSessionNameRefresher({
    host: "claude",
    cwd: tmpdir(),
    sessionId: "sess-late",
    readers: c.readers,
    now: () => clock
  });

  refresh();
  assert.equal(c.scans, 1);
  clock += 60_001; // just past the initial backoff
  refresh();
  assert.equal(c.scans, 2, "the cache must expire, or a late transcript is never picked up");
});

test("refresher: a HIT is memoized — the walk happens once, not per heartbeat", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([JSON.stringify({ type: "custom-title", customTitle: "auth" })]);
    const c = countingReaders({ fakeHome: fx.fakeHome, transcript: fx.transcript });
    const refresh = createHostSessionNameRefresher({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: c.readers
    });
    assert.equal(refresh(), "auth");
    assert.equal(refresh(), "auth");
    assert.equal(refresh(), "auth");
    assert.equal(c.scans, 1, "a resolved path must be memoized across heartbeats");
  } finally {
    fx.cleanup();
  }
});

// ─── 25-26. item 5: ONE title policy, shared with restore.ts ───────────────

test("reader: a customTitle on a non-rename record is IGNORED (policy matches restore.ts)", () => {
  const fx = makeClaudeHome();
  try {
    // h2a-runtime/src/restore.ts requires type === "custom-title"; this reader now
    // applies the identical predicate. Measured over all 8078 local transcripts:
    // 0 policy divergences, and 0 of 89 carriers used any other record type. A
    // misread yields a WRONG name (bad routing); a missed read yields NO name,
    // which the caller absorbs by keeping the name it has.
    fx.write([
      JSON.stringify({ type: "custom-title", customTitle: "TheRealTitle" }),
      // (a) a non-rename carrier the cheap string pre-filter rejects...
      JSON.stringify({ type: "assistant", customTitle: "NotARenameEvent" }),
      // (b) ...and one it does NOT. `subtype` here serializes to the UNESCAPED
      // literal `"custom-title"`, so the cheap pre-filter lets this record
      // through and ONLY the type predicate can reject it.
      //
      // Without (b) this test passes even with the predicate deleted, because the
      // pre-filter masks it — found by a surviving mutation. Note that putting
      // the literal inside a string VALUE does not work: JSON escaping turns it
      // into \"custom-title\", which no longer contains the literal. It has to be
      // an unescaped field value, as here.
      JSON.stringify({
        type: "assistant",
        customTitle: "InjectedByContent",
        subtype: "custom-title"
      })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(
      result,
      "TheRealTitle",
      "only a type:custom-title record may set the display name"
    );
  } finally {
    fx.cleanup();
  }
});

test("reader: agentName is NOT subject to the custom-title type check", () => {
  const fx = makeClaudeHome();
  try {
    // agentName is not a rename event, so the type predicate must not apply to it
    // or the fallback would become unreachable.
    fx.write([JSON.stringify({ type: "summary", agentName: "TheAgent" })]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result, "TheAgent");
  } finally {
    fx.cleanup();
  }
});

// ─── 27-28. nits: whitespace-only and oversized titles ─────────────────────

test("reader: a whitespace-only title is rejected, not written verbatim", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([JSON.stringify({ type: "custom-title", customTitle: "   " })]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    // "   " is truthy: without a trim it would land in presence as the name.
    assert.equal(result, undefined);
  } finally {
    fx.cleanup();
  }
});

test("reader: titles are trimmed and length-capped before reaching presence", () => {
  const fx = makeClaudeHome();
  try {
    fx.write([
      JSON.stringify({ type: "custom-title", customTitle: `  ${"x".repeat(5000)}  ` })
    ]);
    const result = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(result.length, MAX_DISPLAY_NAME_CHARS, `got length ${result.length}`);
    assert.equal(result.startsWith("x"), true, "must be trimmed, not padded");
  } finally {
    fx.cleanup();
  }
});

// ─── 21. the wiring: an explicit --name is never followed ───────────────────

test("resolveAutoOpen: installs a title refresher only when --name was NOT given", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lane-addr-autoopen-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "lane-addr-autoopen-root-")), ".h2a");
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "lane-addr-session";
  try {
    const implicit = resolveAutoOpen(
      { "auto-open": "true", host: "claude", root },
      () => cwd
    );
    assert.equal(
      typeof implicit.refreshDisplayName,
      "function",
      "with the name left implicit, presence must follow the host-native title"
    );

    const explicit = resolveAutoOpen(
      { "auto-open": "true", host: "claude", root, name: "my-operator-name" },
      () => cwd
    );
    assert.equal(
      explicit.refreshDisplayName,
      undefined,
      "an explicit --name is the operator's and must never be overwritten by a host rename"
    );
    assert.equal(explicit.name, "my-operator-name");
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAutoOpen: a launch label is an effective --name and remains fixed across heartbeats", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lane-addr-launch-label-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "lane-addr-launch-label-root-")), ".h2a");
  const previousSessionId = process.env.CLAUDE_CODE_SESSION_ID;
  const previousLaunchLabel = process.env.H2A_LAUNCH_LABEL;
  process.env.CLAUDE_CODE_SESSION_ID = "lane-addr-session";
  process.env.H2A_LAUNCH_LABEL = "launched-lane";
  try {
    const autoOpen = resolveAutoOpen(
      { "auto-open": "true", host: "claude", root },
      () => cwd
    );
    assert.equal(autoOpen.name, "launched-lane", "the sidecar label must reach session-open");

    const registry = new SessionRegistry(root, { autoHeartbeat: false });
    const opened = registry.open(autoOpen);
    // This is the session-open seam: the old implicit path installs a resolver,
    // whose next heartbeat follows a host title. A launch label must suppress it.
    if (autoOpen.refreshDisplayName) {
      registry.setDisplayNameResolver(opened.sessionId, () => "host-title");
    }
    const touched = registry.touch(opened.sessionId);
    assert.equal(touched.name, "launched-lane");
    assert.equal(readPresence(root, opened.sessionId).name, "launched-lane");
    registry.close(opened.sessionId);
  } finally {
    if (previousSessionId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previousSessionId;
    if (previousLaunchLabel === undefined) delete process.env.H2A_LAUNCH_LABEL;
    else process.env.H2A_LAUNCH_LABEL = previousLaunchLabel;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAutoOpen: an explicit --name takes precedence over a launch label", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lane-addr-explicit-name-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "lane-addr-explicit-name-root-")), ".h2a");
  const previousSessionId = process.env.CLAUDE_CODE_SESSION_ID;
  const previousLaunchLabel = process.env.H2A_LAUNCH_LABEL;
  process.env.CLAUDE_CODE_SESSION_ID = "lane-addr-session";
  process.env.H2A_LAUNCH_LABEL = "launched-lane";
  try {
    const autoOpen = resolveAutoOpen(
      { "auto-open": "true", host: "claude", root, name: "operator-name" },
      () => cwd
    );
    assert.equal(autoOpen.name, "operator-name");
    assert.equal(autoOpen.refreshDisplayName, undefined);
  } finally {
    if (previousSessionId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previousSessionId;
    if (previousLaunchLabel === undefined) delete process.env.H2A_LAUNCH_LABEL;
    else process.env.H2A_LAUNCH_LABEL = previousLaunchLabel;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

const RLO_LITERAL = "\u202E";
const PDF_LITERAL = "\u202C";
const BEL_LITERAL = "\u0007";


// --- 34-40. NO-GO review leg (gpt-5.6-terra, 2026-07-25) ---------------------
// Each test below pins a behaviour that leg found unpinned. Where its stated
// mechanism was wrong, the test pins what the code ACTUALLY does, so the next
// reader inherits a measurement rather than a claim. See spec 10.6.

test("refresher: a transcript that appears LATE resolves to its title (absent -> present)", () => {
  // The pre-existing late-discovery test asserted only that the SCAN RECURS
  // (scans === 2). It never flipped the fixture, so "late transcript -> name"
  // was proven by construction, not end to end. This flips it.
  const fx = makeClaudeHome();
  try {
    let present = false;
    const base = makeReaders({ fakeHome: fx.fakeHome });
    let clock = 0;
    const refresh = createHostSessionNameRefresher({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      now: () => clock,
      readers: {
        ...base,
        findClaudeTranscript: () => (present ? fx.transcript : undefined)
      }
    });

    assert.equal(refresh(), undefined, "an absent transcript resolves to no name");

    fx.write([JSON.stringify({ type: "custom-title", customTitle: "auth" })]);
    present = true;

    // Still inside the negative-cache window: must NOT re-scan yet.
    assert.equal(refresh(), undefined, "the negative cache must suppress the re-scan");

    clock += 60_001; // just past TRANSCRIPT_MISS_BACKOFF_MS
    assert.equal(
      refresh(),
      "auth",
      "once the backoff expires the late transcript must resolve to its real title"
    );
  } finally {
    fx.cleanup();
  }
});

test("refresher: a rename A -> B -> A is followed each way", () => {
  // Neither transition was pinned. A cache keyed on "changed since last read"
  // rather than on the current value would pass A->B and silently fail B->A.
  const fx = makeClaudeHome();
  try {
    const refresh = createHostSessionNameRefresher({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });

    fx.write([JSON.stringify({ type: "custom-title", customTitle: "A" })]);
    assert.equal(refresh(), "A");

    fx.write([
      JSON.stringify({ type: "custom-title", customTitle: "A" }),
      JSON.stringify({ type: "custom-title", customTitle: "B" })
    ]);
    assert.equal(refresh(), "B", "a rename must be followed");

    fx.write([
      JSON.stringify({ type: "custom-title", customTitle: "A" }),
      JSON.stringify({ type: "custom-title", customTitle: "B" }),
      JSON.stringify({ type: "custom-title", customTitle: "A" })
    ]);
    assert.equal(refresh(), "A", "a rename BACK to a previous value must also be followed");
  } finally {
    fx.cleanup();
  }
});

test("resolveAutoOpen: no refresher is installed when --host is omitted", () => {
  // The only pre-existing wiring test forced host:"claude" in BOTH arms, so it
  // could not observe any other host. With --host omitted the host is "agent",
  // resolveProviderSession returns {source:"none"}, so there is no provider
  // session id and nothing is installed.
  const cwd = mkdtempSync(join(tmpdir(), "lane-addr-nohost-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "lane-addr-nohost-root-")), ".h2a");
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = "lane-addr-session";
  try {
    const resolved = resolveAutoOpen({ "auto-open": "true", root }, () => cwd);
    assert.equal(
      resolved.refreshDisplayName,
      undefined,
      "no provider session id resolves for host 'agent', so no refresher may be installed"
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveAutoOpen: host 'remote' resolves a session id but installs NO refresher", () => {
  // The real dead-callback case. resolveProviderSession DOES return a provider
  // session id for remote/gemini/agy, while the refresher can only read claude
  // and codex - so without an explicit host gate those three install a callback
  // that runs every heartbeat and can never return a name.
  const cwd = mkdtempSync(join(tmpdir(), "lane-addr-remote-cwd-"));
  const root = join(mkdtempSync(join(tmpdir(), "lane-addr-remote-root-")), ".h2a");
  const prev = process.env.SESSION_ID;
  process.env.SESSION_ID = "remote-session-1";
  try {
    const resolved = resolveAutoOpen(
      { "auto-open": "true", host: "remote", root },
      () => cwd
    );
    assert.equal(
      resolved.refreshDisplayName,
      undefined,
      "a host the reader cannot read must not get a permanently-undefined refresher"
    );
  } finally {
    if (prev === undefined) delete process.env.SESSION_ID;
    else process.env.SESSION_ID = prev;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("reader: a Codex thread_name is trimmed, whitespace-rejected and length-capped", () => {
  // normalizeTitle was reachable ONLY through Claude's jsonField(). The Codex
  // branch assigned obj.thread_name raw, so it was the remaining unbounded
  // host-controlled presence input despite the cap being claimed as closed.
  const read = (threadName) =>
    readHostSessionName({
      host: "codex",
      cwd: tmpdir(),
      sessionId: "cx-1",
      readers: makeReaders({
        codexIndexLines: [JSON.stringify({ id: "cx-1", thread_name: threadName })]
      })
    });

  assert.equal(read("  padded  "), "padded", "a Codex title must be trimmed");
  assert.equal(read("     "), undefined, "a whitespace-only Codex title must be rejected");
  assert.equal(
    read("L".repeat(5000))?.length,
    MAX_DISPLAY_NAME_CHARS,
    "a Codex title must be capped exactly like a Claude one"
  );
});

test("reader: control and bidi characters are stripped from a Claude display name", () => {
  // D3 presents this string to a HUMAN choosing a recipient. U+202E (RLO) can
  // make two candidates render identically; a C0 control can corrupt the line.
  const fx = makeClaudeHome();
  try {
    fx.write([
      JSON.stringify({
        type: "custom-title",
        customTitle: "auth" + RLO_LITERAL + "gnitnuocca" + PDF_LITERAL + BEL_LITERAL
      })
    ]);
    const got = readHostSessionName({
      host: "claude",
      cwd: tmpdir(),
      sessionId: fx.sessionId,
      readers: makeReaders({ fakeHome: fx.fakeHome })
    });
    assert.equal(
      got,
      "authgnitnuocca",
      "bidi overrides and control chars must never reach presence"
    );
  } finally {
    fx.cleanup();
  }
});

test("reader: a Codex thread_name is also stripped of control/bidi characters", () => {
  const got = readHostSessionName({
    host: "codex",
    cwd: tmpdir(),
    sessionId: "cx-1",
    readers: makeReaders({
      codexIndexLines: [
        JSON.stringify({ id: "cx-1", thread_name: "ops" + RLO_LITERAL + "kcatta" })
      ]
    })
  });
  assert.equal(got, "opskcatta");
});
