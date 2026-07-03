import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ④ — track verbs are de-spawned: h2a runs them IN-PROCESS via `@sentropic/track`'s
// `runCli`, no child process, on the SAME `.track` under the same O_EXCL lock.
//   • tranche-1: the read-only verbs `query`/`report`.
//   • tranche-2: the SYNC write verbs (`item`/`decision`/`accept`/`blocker`/
//     `consolidate`/`priority`/`branch`/`ingest`/`restructure`).
// These tests pin the safety properties:
//   (1) PARITY — native (in-process) and facade (spawn) produce the SAME output
//       / the SAME store state (RISK #1: no split-brain, same cwd/root).
//   (2) A native WRITE lands EXACTLY ONCE — no double-write (RISK #2). track's
//       `appendCommand` is atomic under the O_EXCL lock, and a native write NEVER
//       falls back to the spawn facade on throw, so an event cannot be appended
//       twice; an invalid write fails loud (rc≠0) with the log unchanged.
//   (3) The native set stays a proven-SYNC subset; the only async track verb
//       (`focus`) is explicitly kept OUT of the native set (spawn facade).

const REPO = process.cwd();
const BIN = join(REPO, "packages/h2a/dist/bin.js");
const require_ = createRequire(import.meta.url);

// Resolve the `track` bin exactly as h2a's facade does (walk up to the package
// root and read `bin.track`), so the facade comparison shells out to the very
// same binary h2a would.
function resolveTrackBin() {
  let dir = dirname(require_.resolve("@sentropic/track"));
  for (let depth = 0; depth < 8 && dir !== dirname(dir); depth++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      const pkg = JSON.parse(readFileSync(pj, "utf8"));
      if (pkg.name === "@sentropic/track" && pkg.bin?.track) {
        return join(dir, pkg.bin.track);
      }
    }
    dir = dirname(dir);
  }
  throw new Error("@sentropic/track: bin `track` introuvable");
}

const TRACK_BIN = resolveTrackBin();

// `cwd` is the CRITICAL knob: h2a's native path resolves `.track` from
// `process.cwd()`, and the spawn facade inherits that same cwd. Running both
// children with `cwd: store` makes them converge on the identical store.
function run(cwd, bin, args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
}

// A real track store: init + one item written via the FACADE spawn (`track`),
// i.e. the "other writer". The native reads/writes below must see that write —
// proof both paths bind the same `.track` under the same lock.
function makeStore() {
  const store = mkdtempSync(join(tmpdir(), "h2a-track-native-"));
  // A git repo lets track derive a durable workspace id; not strictly needed
  // since we pass --workspace explicitly, but keeps the store realistic.
  spawnSync("git", ["init", "-q"], { cwd: store });
  const init = run(store, TRACK_BIN, ["init"]);
  assert.equal(init.status, 0, `track init failed: ${init.stderr}`);
  const item = run(store, TRACK_BIN, [
    "item", "new", "--kind", "chore", "--title", "native parity probe", "--workspace", "ws:test"
  ]);
  assert.equal(item.status, 0, `track item new failed: ${item.stderr}`);
  return store;
}

// Count events in the append-only log. The double-write guard is measured on
// THIS number: a native write must move it by EXACTLY +1, never +2.
function countEvents(store) {
  const path = join(store, ".track", "events.jsonl");
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").length;
}

// Query the store via the FACADE spawn (the trusted oracle), parsed to rows.
function queryRows(store) {
  const res = run(store, TRACK_BIN, ["query", "--format", "json"]);
  assert.equal(res.status, 0, `oracle query failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("native set = {query,report} ∪ sync-writes; focus (async) stays on the facade", async () => {
  const { TRACK_NATIVE_VERBS, TRACK_NATIVE_READONLY_VERBS, TRACK_NATIVE_WRITE_VERBS, TRACK_FACADE_VERBS } =
    await import("../dist/cli.js");

  assert.deepEqual([...TRACK_NATIVE_READONLY_VERBS].sort(), ["query", "report"]);
  assert.deepEqual(
    [...TRACK_NATIVE_WRITE_VERBS].sort(),
    ["accept", "blocker", "branch", "consolidate", "decision", "ingest", "item", "priority", "restructure"]
  );

  // Union = read-only ⊎ write, disjoint, all facade verbs.
  for (const v of TRACK_NATIVE_READONLY_VERBS) assert.ok(TRACK_NATIVE_VERBS.has(v));
  for (const v of TRACK_NATIVE_WRITE_VERBS) {
    assert.ok(TRACK_NATIVE_VERBS.has(v));
    assert.ok(!TRACK_NATIVE_READONLY_VERBS.has(v), `write verb "${v}" must not be read-only`);
  }
  assert.equal(TRACK_NATIVE_VERBS.size, TRACK_NATIVE_READONLY_VERBS.size + TRACK_NATIVE_WRITE_VERBS.size);
  for (const v of TRACK_NATIVE_VERBS) {
    assert.ok(TRACK_FACADE_VERBS.has(v), `native verb "${v}" must remain a known facade verb`);
  }

  // INVARIANT: the ONLY async track verb must NOT be routed to the sync native
  // path — it keeps the spawn facade.
  assert.ok(!TRACK_NATIVE_VERBS.has("focus"), "async verb `focus` must stay on the spawn facade");
});

test("query --format json: native (in-process) == facade (spawn) on the same .track", () => {
  const store = makeStore();
  try {
    const native = run(store, BIN, ["query", "--format", "json"]);
    const facade = run(store, TRACK_BIN, ["query", "--format", "json"]);

    assert.equal(native.status, 0, `native query rc: ${native.stderr}`);
    // Routed to track, not rejected by h2a's own dispatcher.
    assert.doesNotMatch(native.stderr ?? "", /Unknown command|Run `h2a --help`/);
    // Valid JSON, and it sees the facade-written item → same store (split-brain covered).
    const rows = JSON.parse(native.stdout);
    assert.ok(Array.isArray(rows));
    assert.ok(
      rows.some((r) => r.title === "native parity probe"),
      "native read must see the item written via the spawn facade (same .track)"
    );
    // Byte-for-byte parity with the facade.
    assert.equal(native.stdout, facade.stdout, "native and facade query output must match");
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test("report --format json: native (in-process) == facade (spawn) on the same .track", () => {
  const store = makeStore();
  try {
    const native = run(store, BIN, ["report", "--format", "json"]);
    const facade = run(store, TRACK_BIN, ["report", "--format", "json"]);

    assert.equal(native.status, 0, `native report rc: ${native.stderr}`);
    assert.doesNotMatch(native.stderr ?? "", /Unknown command|Run `h2a --help`/);
    JSON.parse(native.stdout); // valid JSON
    assert.equal(native.stdout, facade.stdout, "native and facade report output must match");
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

// ─── tranche-2: SYNC write verbs de-spawned ────────────────────────────────

test("native WRITE (`item new`) lands EXACTLY ONCE — no double-write (RISK #2)", () => {
  const store = makeStore(); // one seed event
  try {
    const before = countEvents(store);
    // Routed to the native in-process path (item ∈ TRACK_NATIVE_WRITE_VERBS).
    const w = run(store, BIN, [
      "item", "new", "--kind", "chore", "--title", "native write once", "--workspace", "ws:test"
    ]);
    assert.equal(w.status, 0, `native item new rc: ${w.stderr}`);
    assert.doesNotMatch(w.stderr ?? "", /Unknown command|Run `h2a --help`/);

    // EXACTLY +1 event: the anti-double-write guarantee measured on the log.
    assert.equal(countEvents(store), before + 1, "a native write must append exactly one event");

    // The write is visible via the spawn oracle → same `.track`, same lock.
    const rows = queryRows(store);
    const landed = rows.filter((r) => r.title === "native write once");
    assert.equal(landed.length, 1, "the item must exist exactly once in the store");
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test("EFFECT PARITY: `item new` native vs facade yields the same store state", () => {
  const nativeStore = makeStore();
  const facadeStore = makeStore();
  try {
    const args = ["item", "new", "--kind", "bug", "--title", "parity item", "--workspace", "ws:test"];
    const viaNative = run(nativeStore, BIN, args);
    const viaFacade = run(facadeStore, TRACK_BIN, args);
    assert.equal(viaNative.status, 0, `native rc: ${viaNative.stderr}`);
    assert.equal(viaFacade.status, 0, `facade rc: ${viaFacade.stderr}`);

    // Same number of events landed on each side (+1 over the identical seed).
    assert.equal(countEvents(nativeStore), countEvents(facadeStore));

    // Same queryable row, modulo the volatile ULID id: the two write paths
    // produce identical domain state.
    const pick = (store) => {
      const r = queryRows(store).find((x) => x.title === "parity item");
      assert.ok(r, "parity item must be present");
      const { id, ...rest } = r;
      return rest;
    };
    assert.deepEqual(pick(nativeStore), pick(facadeStore), "native and facade writes must agree on state");
  } finally {
    rmSync(nativeStore, { recursive: true, force: true });
    rmSync(facadeStore, { recursive: true, force: true });
  }
});

test("INTERLEAVING: native write then facade write on the same .track → 2 events, log readable", () => {
  const store = makeStore(); // one seed event
  try {
    const before = countEvents(store);
    const nat = run(store, BIN, [
      "item", "new", "--kind", "chore", "--title", "interleave native", "--workspace", "ws:test"
    ]);
    assert.equal(nat.status, 0, `native write rc: ${nat.stderr}`);
    const fac = run(store, TRACK_BIN, [
      "item", "new", "--kind", "chore", "--title", "interleave facade", "--workspace", "ws:test"
    ]);
    assert.equal(fac.status, 0, `facade write rc: ${fac.stderr}`);

    // Both landed, once each — no lost update, no double-write across the two writers.
    assert.equal(countEvents(store), before + 2, "both writes must append exactly one event each");

    // The store stays valid and readable (chain intact under the shared O_EXCL lock).
    const rows = queryRows(store);
    const titles = rows.map((r) => r.title);
    assert.ok(titles.includes("interleave native"), "native write must be present");
    assert.ok(titles.includes("interleave facade"), "facade write must be present");
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test("FALLBACK: an invalid native WRITE fails loud (rc≠0) with the log UNCHANGED — no double-write", () => {
  const store = makeStore();
  try {
    const before = countEvents(store);
    // Invalid --kind: runCli returns rc=1 (a numeric result, not a throw) BEFORE
    // any append. A write verb must NOT retry via the spawn facade → no event.
    const bad = run(store, BIN, [
      "item", "new", "--kind", "NOT_A_KIND", "--title", "should not land", "--workspace", "ws:test"
    ]);
    assert.notEqual(bad.status, 0, "an invalid write must return a non-zero rc");
    assert.equal(countEvents(store), before, "a failed write must not append any event");

    // And nothing half-landed: the bogus item is absent from the store.
    assert.ok(
      !queryRows(store).some((r) => r.title === "should not land"),
      "the rejected write must leave no trace in the store"
    );
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});
