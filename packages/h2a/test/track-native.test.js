import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ④ tranche-1 — the read-only track verbs `query`/`report` are de-spawned: h2a
// runs them IN-PROCESS via `@sentropic/track`'s `runCli`, with a fall back to the
// spawn facade. These tests pin the two safety properties:
//   (1) PARITY — native (in-process) and facade (spawn) produce the SAME output
//       on the SAME `.track` store (RISK #1: no split-brain).
//   (2) The native set stays a proven-SYNC subset (`query`/`report`), so the
//       Promise fallback branch is never needed by a shipped verb; the only
//       async track verb (`focus`) is explicitly kept OUT of the native set.

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
// i.e. the "other writer". The native reads below must see that write — proof
// both paths bind the same `.track` under the same lock.
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

test("native set is exactly {query, report} — a proven-sync subset of the facade", async () => {
  const { TRACK_NATIVE_VERBS, TRACK_FACADE_VERBS } = await import("../dist/cli.js");
  assert.deepEqual([...TRACK_NATIVE_VERBS].sort(), ["query", "report"]);
  for (const v of TRACK_NATIVE_VERBS) {
    assert.ok(TRACK_FACADE_VERBS.has(v), `native verb "${v}" must remain a known facade verb`);
  }
  // The ONLY async track verb must NOT be routed to the sync native path.
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
