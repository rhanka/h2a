import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  advanceJob,
  canTransitionJob,
  enroll,
  listJobs,
  listLive,
  loadRegistry,
  localLsRows,
  localTmuxSessionForName,
  persistNativeTerminalPgid,
  readNativeTerminalPgid,
  resolveLocalTmuxSessionForName,
  markEnded,
  occupiesSlot,
  prune,
  touchEntry,
  tryClaimSlot,
  withRegistryLock,
  type RegistryEntry,
} from "./registry.js";
import { DEFAULT_LAYOUT } from "./config.js";

// Scratch dir inside the package (never /tmp), like the other test suites.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "registry",
);

let scratch: string;
let regPath: string;

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "r-"));
  regPath = join(scratch, "registry.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const baseInput = {
  id: "sess-1",
  tool: "claude" as const,
  kind: "local-tmux" as const,
  cwd: "/home/u/src/projA",
  source: "run" as const,
  tmuxSession: "remote-projA",
  sessionClass: "background" as const,
};


/** Unwrap the 3-state read for round-trip assertions (read must be "ok"). */
function loadEntries(path: string): RegistryEntry[] {
  const read = loadRegistry(path);
  expect(read.state).toBe("ok");
  return read.state === "ok" ? read.entries : [];
}

describe("registry", () => {
  it("enroll creates the file atomically and loadRegistry round-trips", () => {
    const entry = enroll(baseInput, regPath);
    expect(entry.enrolledAt).toBeTruthy();
    expect(entry.lastSeenAt).toBeTruthy();
    expect(existsSync(regPath)).toBe(true);
    // no leftover tmp file from the atomic write
    expect(readdirSync(scratch)).toEqual(["registry.json"]);
    const loaded = loadEntries(regPath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      id: "sess-1",
      tool: "claude",
      kind: "local-tmux",
      cwd: "/home/u/src/projA",
      tmuxSession: "remote-projA",
      source: "run",
    });
  });

  it("enroll upserts by id: keeps enrolledAt, merges fields, no duplicates", () => {
    const first = enroll(baseInput, regPath);
    const second = enroll(
      { ...baseInput, convId: "conv-42", label: "projA" },
      regPath,
    );
    expect(second.enrolledAt).toBe(first.enrolledAt);
    expect(second.convId).toBe("conv-42");
    expect(second.label).toBe("projA");
    const loaded = loadEntries(regPath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.convId).toBe("conv-42");
    // fields not repeated on re-enroll are preserved
    const third = enroll(baseInput, regPath);
    expect(third.convId).toBe("conv-42");
  });

  it("persists delegated-work provenance and the observed worker pid", () => {
    const entry = enroll({
      ...baseInput,
      pid: 4242,
      sessionClass: "background",
      delegationOrigin: "cli:h2a-delegate",
      delegatorInstance: "codex:owner:abc",
      delegatorTmuxSession: "h2a-owner",
    }, regPath);
    expect(entry).toMatchObject({
      pid: 4242,
      sessionClass: "background",
      delegationOrigin: "cli:h2a-delegate",
      delegatorInstance: "codex:owner:abc",
      delegatorTmuxSession: "h2a-owner",
    });
    expect(loadEntries(regPath)[0]).toMatchObject(entry);
  });

  it("re-enrolling an ended session revives it (endedAt dropped)", () => {
    enroll(baseInput, regPath);
    expect(markEnded("sess-1", regPath)).toBe(true);
    expect(loadEntries(regPath)[0]!.endedAt).toBeTruthy();
    enroll(baseInput, regPath);
    expect(loadEntries(regPath)[0]!.endedAt).toBeUndefined();
  });

  it("touchEntry refreshes lastSeenAt and reports unknown ids", () => {
    enroll(baseInput, regPath);
    const before = loadEntries(regPath)[0]!.lastSeenAt;
    expect(touchEntry("sess-1", regPath)).toBe(true);
    expect(Date.parse(loadEntries(regPath)[0]!.lastSeenAt)).toBeGreaterThanOrEqual(
      Date.parse(before),
    );
    expect(touchEntry("nope", regPath)).toBe(false);
  });

  it("markEnded sets endedAt and reports unknown ids", () => {
    enroll(baseInput, regPath);
    expect(markEnded("sess-1", regPath)).toBe(true);
    expect(loadEntries(regPath)[0]!.endedAt).toBeTruthy();
    expect(markEnded("nope", regPath)).toBe(false);
  });

  it("loadRegistry: a missing file is PROVABLY empty, a corrupt file is UNKNOWN", () => {
    // ENOENT: rows cannot exist without a file — positive emptiness.
    expect(loadRegistry(regPath)).toEqual({ state: "ok", entries: [], unreadable: [] });
    // Corrupt: the read proves nothing — it must say so, never flatten to []
    // (an empty read here let destructive acts treat an unprovable local
    // state as proven absence and fall through to a remote homonym).
    writeFileSync(regPath, "{not json", "utf8");
    const corrupt = loadRegistry(regPath);
    expect(corrupt.state).toBe("unknown");
    expect(corrupt).not.toHaveProperty("entries");
  });

  describe("B2 — REBUILDING is allowed, DESTROYING is not", () => {
    /** Every `registry.corrupt-*.json` sibling currently in `scratch`. */
    function corruptSiblings(): string[] {
      return readdirSync(scratch).filter((name) =>
        /^registry\.corrupt-.*\.json$/.test(name),
      );
    }

    it("the bytes of a corrupt registry STILL EXIST (moved aside verbatim) after an enroll rebuilds it", () => {
      const corruptBody = '{"version":1,"entries":[{"id":"orphaned-by-corruption"';
      writeFileSync(regPath, corruptBody, "utf8");
      expect(loadRegistry(regPath).state).toBe("unknown");

      enroll(baseInput, regPath);

      // The rebuild succeeded (enrolment is never bricked by a corrupt
      // file). loadRegistry() now reads "unknown" (the whole-file trace —
      // see the next test), so the raw JSON is read directly here.
      const rebuilt = JSON.parse(readFileSync(regPath, "utf8")) as {
        entries: Array<{ id: string }>;
      };
      expect(rebuilt.entries.map((e) => e.id)).toEqual(["sess-1"]);
      // And the ORIGINAL corrupt bytes were preserved verbatim next to it —
      // not merely "enroll succeeded", the actual bytes must be inspectable.
      const siblings = corruptSiblings();
      expect(siblings).toHaveLength(1);
      const preserved = readFileSync(join(scratch, siblings[0]!), "utf8");
      expect(preserved).toBe(corruptBody);
    });

    it("loadRegistry reads the freshly-rebuilt file as UNKNOWN (the whole-file trace), not ok-with-fewer-rows", () => {
      writeFileSync(regPath, "{not valid json at all", "utf8");
      enroll(baseInput, regPath);

      const read = loadRegistry(regPath);
      expect(read.state).toBe("unknown");
      expect(read).not.toHaveProperty("entries");
      if (read.state === "unknown") {
        expect(read.reason).toContain("rebuilt from an unreadable file");
      }
    });

    it("the trace clears on the NEXT successful write (self-healing, never a permanent brick)", () => {
      writeFileSync(regPath, "{not valid json at all", "utf8");
      enroll(baseInput, regPath); // rebuild #1 — stamps the trace
      expect(loadRegistry(regPath).state).toBe("unknown");

      enroll({ ...baseInput, id: "sess-2" }, regPath); // an ORDINARY write over the now-valid file
      const read = loadRegistry(regPath);
      expect(read.state).toBe("ok");
      if (read.state === "ok") {
        expect(read.entries.map((e) => e.id).sort()).toEqual(["sess-1", "sess-2"]);
      }
      // Still exactly ONE corrupt sibling — the second (ordinary) write must
      // not have triggered a second move-aside.
      expect(corruptSiblings()).toHaveLength(1);
    });

    it("a read-only no-op (prune finding nothing to change) on a corrupt registry does NOT spam a corrupt-*.json sibling", () => {
      writeFileSync(regPath, "{not valid json at all", "utf8");
      prune(24, { path: regPath });
      prune(24, { path: regPath });
      expect(corruptSiblings()).toEqual([]);
      // The original corrupt file is untouched (prune truly no-op'd).
      expect(readFileSync(regPath, "utf8")).toBe("{not valid json at all");
    });
  });

  describe("listLive", () => {
    it("local-tmux liveness follows tmux has-session", () => {
      enroll(baseInput, regPath);
      enroll(
        { ...baseInput, id: "sess-2", tmuxSession: "remote-gone" },
        regPath,
      );
      const live = listLive({
        path: regPath,
        tmuxHasSession: (name) => name === "remote-projA",
      });
      expect(live.map((e) => e.id)).toEqual(["sess-1"]);
    });

    it("checks both managed prefixes for a historical entry without tmuxSession", () => {
      enroll({ ...baseInput, id: "historic", tmuxSession: undefined }, regPath);

      const live = listLive({
        path: regPath,
        tmuxHasSession: (name) => name === "h2a-historic",
      });

      expect(live.map((entry) => entry.id)).toEqual(["historic"]);
    });

    it("local liveness follows pid (kill(pid, 0)) and endedAt", () => {
      enroll(
        { id: "with-pid", tool: "codex", kind: "local", cwd: "/x", source: "run", sessionClass: "background", pid: 1234 },
        regPath,
      );
      enroll(
        { id: "dead-pid", tool: "codex", kind: "local", cwd: "/x", source: "run", sessionClass: "background", pid: 9999 },
        regPath,
      );
      enroll(
        { id: "no-pid", tool: "claude", kind: "local", cwd: "/x", source: "hook", sessionClass: "background" },
        regPath,
      );
      enroll(
        { id: "ended", tool: "claude", kind: "local", cwd: "/x", source: "hook", sessionClass: "background" },
        regPath,
      );
      markEnded("ended", regPath);
      const live = listLive({
        path: regPath,
        pidAlive: (pid) => pid === 1234,
        bootTimeMs: 0, // boot at epoch → entries (seen now) are post-boot
      });
      // no-pid local entries are trusted until SessionEnd/prune
      expect(live.map((e) => e.id).sort()).toEqual(["no-pid", "with-pid"]);
    });

    it("a local entry last seen BEFORE boot is dead even if its PID is now reused", () => {
      // The crash-reboot case: the process died, but its old PID was reassigned
      // to an unrelated live process. Without the boot guard, kill(pid,0) would
      // falsely report it live and the single-writer guard would block restore.
      enroll(
        { id: "pre-boot", tool: "claude", kind: "local", cwd: "/x", source: "hook", sessionClass: "background", pid: 1234 },
        regPath,
      );
      const live = listLive({
        path: regPath,
        pidAlive: () => true, // PID 1234 is "alive" (reused by another process)
        bootTimeMs: Date.now() + 60_000, // pretend the machine booted AFTER enrol
      });
      expect(live.map((e) => e.id)).toEqual([]); // correctly treated as dead
    });

    it("remote entries are always returned (caller reconciles)", () => {
      enroll(
        { id: "scw-1", tool: "claude", kind: "remote", cwd: "/w", source: "remote", sessionClass: "background", remoteId: "scw-1" },
        regPath,
      );
      expect(listLive({ path: regPath }).map((e) => e.id)).toEqual(["scw-1"]);
    });
  });

  describe("prune", () => {
    it("drops dead entries older than maxAgeHours, keeps live and recent ones", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        // dead (tmux gone) and old -> pruned
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
        // dead but recent -> kept (restore-after-reboot still wants it)
        {
          id: "dead-recent",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/b",
          tmuxSession: "remote-b",
          enrolledAt: old,
          lastSeenAt: new Date().toISOString(),
          source: "run",
          sessionClass: "background",
        },
        // live and old -> kept
        {
          id: "live-old",
          tool: "codex",
          kind: "local-tmux",
          cwd: "/c",
          tmuxSession: "remote-c",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(48, {
        path: regPath,
        tmuxHasSession: (name) => name === "remote-c",
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id).sort()).toEqual([
        "dead-recent",
        "live-old",
      ]);
    });

    it("keeps entries explicitly restorePinned even when older than maxAgeHours", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-pinned",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "human",
          convId: "d7e77a42-7b54-4ca7-8f55-3d4dd3d3f2d4",
          restorePinned: true,
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id)).toEqual(["restore-pinned"]);
    });

    it("keeps human entries whose convId equals label (mis-recorded durable sessions)", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-label-eq",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore-label-eq",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "human",
          convId: "reglement",
          label: "reglement",
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id)).toEqual([
        "restore-label-eq",
      ]);
    });

    it("keeps human entries with no convId (mis-recorded durable sessions)", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-no-convid",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore-no-convid",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "human",
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id)).toEqual(["restore-no-convid"]);
    });

    it("pins a local-tmux/run entry whose sessionClass is absent (unknown protects)", () => {
      // As of 2026-08-08, the architect measured 29 sessionClass-absent registry lines; all are kind=remote.
      // Remote rows are deliberately out of the restore-pin perimeter by design, so this behavior has no observed effect today.
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-no-class",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore-no-class",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id)).toEqual(["restore-no-class"]);
    });

    it("does not pin a positively non-human row (delegated job), even when classless", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-no-class-job",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore-no-class-job",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          role: "job",
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(2);
      expect(loadEntries(regPath)).toEqual([]);
    });

    it("keeps durable human rows that qualify for implicit restore pinning", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const entries: RegistryEntry[] = [
        {
          id: "restore-implicit",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/r",
          tmuxSession: "remote-restore-implicit",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "human",
          convId: "f6a55f9e-b8b8-4e13-bf5f-c2d8b6a1b9e0",
        },
        {
          id: "dead-old",
          tool: "claude",
          kind: "local-tmux",
          cwd: "/a",
          tmuxSession: "remote-a",
          enrolledAt: old,
          lastSeenAt: old,
          source: "run",
          sessionClass: "background",
        },
      ];
      writeFileSync(regPath, JSON.stringify({ version: 1, entries }), "utf8");
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1);
      expect(loadEntries(regPath).map((e) => e.id)).toEqual(["restore-implicit"]);
    });

    it("is a no-op (no rewrite) when nothing is prunable", () => {
      enroll(baseInput, regPath);
      const before = readFileSync(regPath, "utf8");
      expect(prune(48, { path: regPath, tmuxHasSession: () => true })).toBe(0);
      expect(readFileSync(regPath, "utf8")).toBe(before);
    });

    it("restore-pin x FILE-level unknown (reconciliation decision, conservative-preserve): a CORRUPT registry is never rewritten by prune", () => {
      // The whole-file read is unknown (unparseable) — whatever restore-pinned
      // rows it might contain are neither read NOR erased: withRegistryLock's
      // own write-path raw read flattens an unknown file to [], so prune sees
      // 0 entries, 0 kept, and takes its `save:false` no-op branch.
      writeFileSync(regPath, "{not json", "utf8");
      const before = readFileSync(regPath, "utf8");
      expect(() => prune(48, { path: regPath, tmuxHasSession: () => false })).not.toThrow();
      expect(prune(48, { path: regPath, tmuxHasSession: () => false })).toBe(0);
      expect(readFileSync(regPath, "utf8")).toBe(before);
    });

    it("restore-pin x per-row unreadable (reconciliation decision, conservative-preserve): a restore-pin-shaped but UNREADABLE row survives prune verbatim", () => {
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      const pinnedShapedButUnreadable = {
        id: "restore-pin-unreadable",
        // `kind` deliberately absent: fails isRegistryEntry, so
        // shouldPreserveByRestorePin never even sees this row — it is
        // excluded from `entries` before prune's filter runs, yet
        // withRegistryLock/saveRegistry re-append it VERBATIM regardless.
        tool: "claude",
        cwd: "/r",
        tmuxSession: "remote-restore-pin-unreadable",
        enrolledAt: old,
        lastSeenAt: old,
        source: "run",
        sessionClass: "human",
        convId: "a1b2c3d4-1111-2222-3333-444455556666",
      };
      const dead: RegistryEntry = {
        id: "dead-old",
        tool: "claude",
        kind: "local-tmux",
        cwd: "/a",
        tmuxSession: "remote-a",
        enrolledAt: old,
        lastSeenAt: old,
        source: "run",
        sessionClass: "background",
      };
      writeFileSync(
        regPath,
        JSON.stringify({ version: 1, entries: [pinnedShapedButUnreadable, dead] }),
        "utf8",
      );
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1); // only "dead-old" (a valid, prunable entry)
      const raw = JSON.parse(readFileSync(regPath, "utf8")) as {
        entries: Array<Record<string, unknown>>;
      };
      const survivor = raw.entries.find((e) => e.id === "restore-pin-unreadable");
      expect(survivor).toBeDefined();
      expect(survivor!.kind).toBeUndefined();
    });

    it("UNREADABLE_PINNED_ROW_SURVIVES_PRUNE_AND_WRITE", () => {
      // Measured 2026-08 (#199 rebase, D3): preserve-conservative needs NO
      // code change — it is correct BY CONSTRUCTION. An individually-
      // unreadable row never reaches `entries` inside `withRegistryLock`
      // (excluded by `raw.filter(isRegistryEntry)` before prune's callback
      // runs, so `shouldPreserveByRestorePin` never even sees it), yet
      // `saveRegistry` re-appends every such raw row VERBATIM via
      // `...preserved` on every write. This test pins that property so a
      // future refactor that drops `...preserved` (or "simplifies"
      // `withRegistryLock`'s raw-row bookkeeping) reddens here instead of
      // silently losing the owner's registry line.
      const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
      // Same identity shape the resolver treats as a same-identity twin
      // (id/label/tmuxSession present — see rawRowMatchesTarget), but it
      // fails `isRegistryEntry` on a field OTHER than those identity
      // fields (`kind` is absent here), exactly like a resolver-poison twin.
      const pinnedShapedButUnreadable = {
        id: "unreadable-pinned-twin",
        label: "unreadable-pinned-twin-label",
        tool: "claude",
        cwd: "/r2",
        tmuxSession: "remote-unreadable-pinned-twin",
        enrolledAt: old,
        lastSeenAt: old,
        source: "run",
        sessionClass: "human",
        convId: "b2c3d4e5-2222-3333-4444-555566667777",
      };
      const dead: RegistryEntry = {
        id: "dead-old-2",
        tool: "claude",
        kind: "local-tmux",
        cwd: "/a2",
        tmuxSession: "remote-a2",
        enrolledAt: old,
        lastSeenAt: old,
        source: "run",
        sessionClass: "background",
      };
      writeFileSync(
        regPath,
        JSON.stringify({ version: 1, entries: [pinnedShapedButUnreadable, dead] }),
        "utf8",
      );
      const removed = prune(DEFAULT_LAYOUT.maxAgeHours, {
        path: regPath,
        tmuxHasSession: () => false,
      });
      expect(removed).toBe(1); // only "dead-old-2" (a valid, prunable entry)
      const raw = JSON.parse(readFileSync(regPath, "utf8")) as {
        entries: Array<Record<string, unknown>>;
      };
      const survivor = raw.entries.find((e) => e.id === "unreadable-pinned-twin");
      // VERBATIM: the raw row must round-trip byte-for-byte as an object,
      // not merely "some fields kept" — this is what `...preserved` gives.
      expect(survivor).toEqual(pinnedShapedButUnreadable);
    });
  });

  describe("delegated jobs (role:'job')", () => {
    const jobInput = {
      id: "job-1",
      tool: "codex" as const,
      kind: "local-tmux" as const,
      cwd: "/home/u/src/projA/.remote/jobs/job-1/wt",
      source: "run" as const,
      tmuxSession: "remote-job-1",
      sessionClass: "background" as const,
      role: "job" as const,
      jobState: "running" as const,
      task: "fix the flaky test",
      parent: "boss",
    };

    it("round-trips the job fields through enroll/loadRegistry", () => {
      enroll(jobInput, regPath);
      const [loaded] = loadEntries(regPath);
      expect(loaded).toMatchObject({
        id: "job-1",
        role: "job",
        jobState: "running",
        task: "fix the flaky test",
        parent: "boss",
      });
    });

    it("listJobs returns only role:'job' entries", () => {
      enroll(baseInput, regPath); // a session, not a job
      enroll(jobInput, regPath);
      const jobs = listJobs({ path: regPath });
      expect(jobs.map((j) => j.id)).toEqual(["job-1"]);
    });

    it("a plain session keeps no job fields (back-compat)", () => {
      enroll(baseInput, regPath);
      const [loaded] = loadEntries(regPath);
      expect(loaded?.role).toBeUndefined();
      expect(loaded?.jobState).toBeUndefined();
    });

    describe("advanceJob state machine", () => {
      it("running -> done stamps endedAt and persists", () => {
        enroll(jobInput, regPath);
        const updated = advanceJob("job-1", "done", regPath);
        expect(updated?.jobState).toBe("done");
        expect(updated?.endedAt).toBeTruthy();
        expect(loadEntries(regPath)[0]?.jobState).toBe("done");
      });

      it("running -> failed is allowed; done -> running is not", () => {
        enroll(jobInput, regPath);
        expect(advanceJob("job-1", "failed", regPath)?.jobState).toBe("failed");
        // failed is terminal: cannot go back to running
        expect(advanceJob("job-1", "running", regPath)).toBeUndefined();
      });

      it("refuses to advance a non-job or unknown id", () => {
        enroll(baseInput, regPath); // a session
        expect(advanceJob("sess-1", "done", regPath)).toBeUndefined();
        expect(advanceJob("nope", "done", regPath)).toBeUndefined();
      });

      it("canTransitionJob encodes the legal edges", () => {
        expect(canTransitionJob("pending", "running")).toBe(true);
        expect(canTransitionJob("running", "done")).toBe(true);
        expect(canTransitionJob("running", "failed")).toBe(true);
        expect(canTransitionJob("done", "failed")).toBe(false);
        expect(canTransitionJob("pending", "done")).toBe(false);
      });
    });

    // Reliability slice 1 — rate-limit "throttled" state (HEADLESS LOCAL).
    describe("throttled state machine + throttle bookkeeping", () => {
      it("running -> throttled -> running round-trips and is NOT terminal", () => {
        enroll({ ...jobInput, id: "rl-1" }, regPath);
        const t = advanceJob("rl-1", "throttled", regPath);
        expect(t?.jobState).toBe("throttled");
        expect(t?.endedAt).toBeUndefined(); // throttled is non-terminal
        const r = advanceJob("rl-1", "running", regPath);
        expect(r?.jobState).toBe("running");
      });

      it("throttled -> failed (cap spent) stamps endedAt", () => {
        enroll({ ...jobInput, id: "rl-2", jobState: "throttled" }, regPath);
        const f = advanceJob("rl-2", "failed", regPath);
        expect(f?.jobState).toBe("failed");
        expect(f?.endedAt).toBeTruthy();
      });

      it("throttled -> done settles a fresh success", () => {
        enroll({ ...jobInput, id: "rl-3", jobState: "throttled" }, regPath);
        expect(advanceJob("rl-3", "done", regPath)?.jobState).toBe("done");
      });

      it("rejects illegal edges into/out of throttled", () => {
        // pending cannot jump straight to throttled (never launched).
        enroll({ ...jobInput, id: "rl-4", jobState: "pending" }, regPath);
        expect(advanceJob("rl-4", "throttled", regPath)).toBeUndefined();
        // done is terminal — cannot re-enter throttled.
        enroll({ ...jobInput, id: "rl-5", jobState: "done" }, regPath);
        expect(advanceJob("rl-5", "throttled", regPath)).toBeUndefined();
      });

      it("canTransitionJob encodes the throttled edges", () => {
        expect(canTransitionJob("running", "throttled")).toBe(true);
        expect(canTransitionJob("throttled", "running")).toBe(true);
        expect(canTransitionJob("throttled", "failed")).toBe(true);
        expect(canTransitionJob("throttled", "done")).toBe(true);
        expect(canTransitionJob("pending", "throttled")).toBe(false);
        expect(canTransitionJob("done", "throttled")).toBe(false);
      });

      it("round-trips the throttle bookkeeping object through enroll", () => {
        enroll(
          {
            ...jobInput,
            id: "rl-6",
            jobState: "throttled",
            throttle: {
              attempts: 3,
              firstAt: "2026-06-11T12:00:00.000Z",
              nextRetryAt: "2026-06-11T12:05:00.000Z",
              lastSignature: "claude:rate-limited",
            },
          },
          regPath,
        );
        const loaded = loadEntries(regPath).find((e) => e.id === "rl-6");
        expect(loaded?.throttle).toEqual({
          attempts: 3,
          firstAt: "2026-06-11T12:00:00.000Z",
          nextRetryAt: "2026-06-11T12:05:00.000Z",
          lastSignature: "claude:rate-limited",
        });
      });

      it("occupiesSlot: running + throttled occupy a slot; others don't", () => {
        expect(occupiesSlot("running")).toBe(true);
        expect(occupiesSlot("throttled")).toBe(true);
        expect(occupiesSlot("pending")).toBe(false);
        expect(occupiesSlot("done")).toBe(false);
        expect(occupiesSlot("failed")).toBe(false);
      });

      it("tryClaimSlot counts a throttled job against the cap (it keeps its slot)", () => {
        enroll({ ...jobInput, id: "occ-1", jobState: "throttled" }, regPath);
        // cap 1, one throttled job already occupies the slot → no claim.
        const claimed = tryClaimSlot(
          { id: "new", tool: "claude", kind: "local-tmux", cwd: "/r", source: "run", sessionClass: "background", role: "job" },
          1,
          regPath,
        );
        expect(claimed).toBeUndefined();
      });
    });

    describe("P4 queued-launch spec fields", () => {
      it("round-trips the queued-launch fields through enroll (pending job)", () => {
        enroll(
          {
            id: "q-1",
            tool: "claude",
            kind: "local-tmux",
            cwd: "/repo",
            source: "run",
            sessionClass: "background",
            role: "job",
            jobState: "pending",
            task: "queued task",
            headless: true,
            originCwd: "/repo",
            explicitCwd: "/repo/sub",
            depthBudget: 2,
            remoteTarget: "http://cp:8080",
            trackWp: "wp-9",
          },
          regPath,
        );
        const [loaded] = loadEntries(regPath);
        expect(loaded).toMatchObject({
          id: "q-1",
          jobState: "pending",
          headless: true,
          originCwd: "/repo",
          explicitCwd: "/repo/sub",
          depthBudget: 2,
          remoteTarget: "http://cp:8080",
          trackWp: "wp-9",
        });
      });

      it("a pending job advances to running (the conductor launch), keeping its spec", () => {
        enroll(
          {
            id: "q-2",
            tool: "claude",
            kind: "local-tmux",
            cwd: "/repo",
            source: "run",
            sessionClass: "background",
            role: "job",
            jobState: "pending",
            depthBudget: 3,
            trackWp: "wp-1",
          },
          regPath,
        );
        const advanced = advanceJob("q-2", "running", regPath);
        expect(advanced?.jobState).toBe("running");
        expect(advanced?.depthBudget).toBe(3);
        expect(advanced?.trackWp).toBe("wp-1");
      });

      it("a plain session keeps NO queued-launch fields (back-compat)", () => {
        enroll(baseInput, regPath);
        const [loaded] = loadEntries(regPath);
        expect(loaded?.headless).toBeUndefined();
        expect(loaded?.depthBudget).toBeUndefined();
        expect(loaded?.remoteTarget).toBeUndefined();
        expect(loaded?.trackWp).toBeUndefined();
      });
    });
  });
});

describe("registry concurrency (S2/S3)", () => {
  const jobInput = (id: string) => ({
    id,
    tool: "claude" as const,
    kind: "local-tmux" as const,
    cwd: "/repo",
    source: "run" as const,
    sessionClass: "background" as const,
    role: "job" as const,
  });

  it("withRegistryLock serializes load-modify-save (no lost write across calls)", () => {
    enroll({ ...jobInput("a"), jobState: "pending" }, regPath);
    enroll({ ...jobInput("b"), jobState: "pending" }, regPath);
    // Two interleaved-looking mutations on DISJOINT entries: under the lock each
    // re-reads the freshest snapshot, so neither clobbers the other.
    withRegistryLock(regPath, (entries) => {
      const e = entries.find((x) => x.id === "a")!;
      e.label = "first";
      return { entries, result: undefined };
    });
    withRegistryLock(regPath, (entries) => {
      const e = entries.find((x) => x.id === "b")!;
      e.label = "second";
      return { entries, result: undefined };
    });
    const all = loadEntries(regPath);
    expect(all.find((e) => e.id === "a")?.label).toBe("first");
    expect(all.find((e) => e.id === "b")?.label).toBe("second");
  });

  it("withRegistryLock save:false does NOT create/rewrite the file", () => {
    const r = withRegistryLock(regPath, (entries) => ({
      entries,
      result: 42,
      save: false,
    }));
    expect(r).toBe(42);
    expect(existsSync(regPath)).toBe(false);
  });

  it("tryClaimSlot enrolls running while under the cap", () => {
    const claimed = tryClaimSlot(jobInput("j1"), 2, regPath);
    expect(claimed?.jobState).toBe("running");
    expect(loadEntries(regPath).find((e) => e.id === "j1")?.jobState).toBe(
      "running",
    );
  });

  it("tryClaimSlot REFUSES at the cap and writes nothing (atomic check+enroll)", () => {
    tryClaimSlot(jobInput("r1"), 1, regPath); // fills the only slot
    const before = readFileSync(regPath, "utf8");
    const claimed = tryClaimSlot(jobInput("r2"), 1, regPath);
    expect(claimed).toBeUndefined();
    // r2 was NOT written (no overshoot of the cap, and no stray entry).
    expect(readFileSync(regPath, "utf8")).toBe(before);
    expect(loadEntries(regPath).some((e) => e.id === "r2")).toBe(false);
  });

  it("tryClaimSlot does not double-count a job already pending as its own slot", () => {
    // Enroll j as pending, then claim it: it should be admitted (it is not yet
    // running, so it doesn't count against the cap as itself).
    enroll({ ...jobInput("j"), jobState: "pending" }, regPath);
    const claimed = tryClaimSlot(jobInput("j"), 1, regPath);
    expect(claimed?.jobState).toBe("running");
  });

  it("the cap counts only RUNNING jobs (pending/terminal free their slot)", () => {
    enroll({ ...jobInput("done1"), jobState: "done" }, regPath);
    enroll({ ...jobInput("pend1"), jobState: "pending" }, regPath);
    // cap 1, no RUNNING job yet → a fresh claim succeeds.
    expect(tryClaimSlot(jobInput("new1"), 1, regPath)?.jobState).toBe("running");
    // now one is running → cap 1 is full.
    expect(tryClaimSlot(jobInput("new2"), 1, regPath)).toBeUndefined();
  });

  it("cap <= 0 admits nothing", () => {
    expect(tryClaimSlot(jobInput("z"), 0, regPath)).toBeUndefined();
    expect(existsSync(regPath)).toBe(false);
  });
});

describe("localTmuxSessionForName (attach local-vs-remote routing)", () => {
  const now = new Date().toISOString();
  const localTmux = (over: Partial<RegistryEntry>): RegistryEntry => ({
    id: "h2a",
    tool: "claude",
    kind: "local-tmux",
    cwd: "/home/u/src/a2a-cli",
    label: "h2a",
    tmuxSession: "remote-h2a",
    enrolledAt: now,
    lastSeenAt: now,
    source: "run",
    ...over,
  });

  it("resolves a `h2a run` session by its slug even if tmux can't list it", () => {
    // The core fix: the registry record alone (no live tmux) is enough to know
    // the name is LOCAL, so attach never falls through to a k8s Pod.
    expect(localTmuxSessionForName("h2a", [localTmux({})])).toBe("remote-h2a");
  });

  it("matches by custom label and by full tmux session name too", () => {
    const e = localTmux({ id: "sess-x", label: "myname" });
    expect(localTmuxSessionForName("myname", [e])).toBe("remote-h2a");
    expect(localTmuxSessionForName("remote-h2a", [e])).toBe("remote-h2a");
  });

  it("tries both prefixes when no explicit tmuxSession is recorded", () => {
    const { tmuxSession: _drop, ...noTmux } = localTmux({ id: "proj" });
    expect(
      resolveLocalTmuxSessionForName("proj", [noTmux as RegistryEntry]),
    ).toEqual({
      kind: "ambiguous",
      names: ["h2a-proj", "remote-proj"],
    });
    expect(localTmuxSessionForName("proj", [noTmux as RegistryEntry])).toBeUndefined();
    expect(
      resolveLocalTmuxSessionForName("remote-proj", [noTmux as RegistryEntry]),
    ).toEqual({ kind: "found", name: "remote-proj" });
  });

  it("treats a full managed name as exact rather than an id or label alias", () => {
    const historical = localTmux({
      id: "h2a-proj",
      label: "h2a-proj",
      tmuxSession: "remote-h2a-proj",
    });

    expect(
      resolveLocalTmuxSessionForName("h2a-proj", [historical]),
    ).toEqual({ kind: "missing" });
    expect(
      resolveLocalTmuxSessionForName("remote-h2a-proj", [historical]),
    ).toEqual({ kind: "found", name: "remote-h2a-proj" });
  });

  it("ignores ended, remote, and delegated-job records", () => {
    expect(localTmuxSessionForName("h2a", [localTmux({ endedAt: now })])).toBeUndefined();
    expect(
      localTmuxSessionForName("h2a", [
        localTmux({ kind: "remote", tmuxSession: undefined, remoteId: "r" }),
      ]),
    ).toBeUndefined();
    expect(
      localTmuxSessionForName("h2a", [localTmux({ role: "job" })]),
    ).toBeUndefined();
  });

  it("returns undefined for no match or an ambiguous (multi-id) match", () => {
    expect(localTmuxSessionForName("nope", [localTmux({})])).toBeUndefined();
    expect(
      localTmuxSessionForName("dup", [
        localTmux({ id: "a", label: "dup", tmuxSession: "remote-a" }),
        localTmux({ id: "b", label: "dup", tmuxSession: "remote-b" }),
      ]),
    ).toBeUndefined();
  });
});

describe("localLsRows", () => {
  const now = new Date().toISOString();
  const historical: RegistryEntry = {
    id: "proj",
    tool: "claude",
    kind: "local-tmux",
    cwd: "/repo/proj",
    enrolledAt: now,
    lastSeenAt: now,
    source: "run",
  };

  it("does not add a third registry-only row for a dual-prefix historical collision", () => {
    const rows = localLsRows(
      [
        {
          name: "h2a-proj",
          slug: "proj",
          profile: "claude",
          path: "/repo/proj",
          attached: false,
        },
        {
          name: "remote-proj",
          slug: "proj",
          profile: "claude",
          path: "/repo/proj",
          attached: false,
        },
      ],
      [historical],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.tmuxSession).sort()).toEqual([
      "h2a-proj",
      "remote-proj",
    ]);
    expect(rows.every((row) => row.badge === "guess")).toBe(true);
  });
});

describe("native-terminal pgid persistence", () => {
  it("round-trips a session's pgid through the same durable registry file", () => {
    persistNativeTerminalPgid("orphan-tree", 4242, regPath);
    expect(readNativeTerminalPgid("orphan-tree", regPath)).toEqual({
      status: "resolved",
      pgid: 4242,
    });
  });

  it("upserts on a second persist for the same session id (no duplicate rows)", () => {
    persistNativeTerminalPgid("recycled", 100, regPath);
    persistNativeTerminalPgid("recycled", 200, regPath);
    expect(readNativeTerminalPgid("recycled", regPath)).toEqual({
      status: "resolved",
      pgid: 200,
    });
    const entries = loadEntries(regPath);
    expect(entries.filter((e) => e.pgid !== undefined)).toHaveLength(1);
  });

  it("reports unresolved (not resolved-to-nothing) when the session was never recorded", () => {
    persistNativeTerminalPgid("known-session", 1, regPath);
    const lookup = readNativeTerminalPgid("never-created", regPath);
    expect(lookup).toEqual({
      status: "unresolved",
      reason: expect.stringMatching(/no pgid recorded/i),
    });
  });

  it("reports unresolved, distinctly, when the registry file cannot be read at all", () => {
    // No enroll/persist ever happened at this path — loadRegistryWithDiagnostics
    // reports known:false for an absent file, same as for a corrupt one; either
    // way this must NEVER be read as "known: zero sessions".
    const neverWritten = join(scratch, "never-written-registry.json");
    const lookup = readNativeTerminalPgid("any-session", neverWritten);
    expect(lookup.status).toBe("unresolved");
    expect(lookup).not.toEqual({ status: "resolved", pgid: expect.any(Number) });
  });

  it("keeps the pgid row out of remote ls (kind:local is filtered from localLsRows)", () => {
    persistNativeTerminalPgid("pty-session", 555, regPath);
    const live = listLive({ path: regPath });
    const rows = localLsRows([], live);
    expect(rows).toHaveLength(0);
  });

  it("does not count the pgid row against delegate's job concurrency (no role:job)", () => {
    persistNativeTerminalPgid("pty-session-2", 777, regPath);
    expect(listJobs({ path: regPath })).toHaveLength(0);
  });

  it("survives an unrelated entries-only write (enroll) without being clobbered", () => {
    persistNativeTerminalPgid("surviving-session", 999, regPath);
    enroll(baseInput, regPath);
    expect(readNativeTerminalPgid("surviving-session", regPath)).toEqual({
      status: "resolved",
      pgid: 999,
    });
  });

  it("preserves ordinary registry entries when a pgid is persisted afterward", () => {
    const enrolled = enroll(baseInput, regPath);
    persistNativeTerminalPgid("another-session", 1234, regPath);
    const entries = loadEntries(regPath);
    expect(entries.find((e) => e.id === enrolled.id)).toMatchObject({
      id: enrolled.id,
      tool: "claude",
      kind: "local-tmux",
    });
  });
});
