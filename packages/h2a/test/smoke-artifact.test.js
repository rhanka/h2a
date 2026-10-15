/**
 * SPEC 0.98.5 R8.3 — regression gate for the packaged-artifact smoke
 * (scripts/smoke-artifact.mjs), the release-time proof that runs in `verify`.
 *
 * Round-2 review findings this file pins shut — each was reproduced by the
 * reviewer against the committed smoke:
 *   - the runtime manifest did not export `./package.json`, so the smoke's
 *     own path proof (`require.resolve('@sentropic/h2a-runtime/package.json')`)
 *     could not resolve from the installed prefix;
 *   - the cold-boot fixture persisted the RAW `/proc/self/ns/pid` magic
 *     symlink (`pid:[4026531836]`) while the production reader
 *     (readPidNamespaceId) returns the bare numeric inode — a malformed store
 *     value, foreign-frame under R1, refusing the very cold boot it seeds;
 *   - the smoke compared the loaded version to the CANDIDATE version instead
 *     of the pinned literal (R8.3(4) pins the literal);
 *   - scenario 7 destroyed the stderr reader AFTER a prune that ran at delay
 *     zero — no write-after-close was exercised — and scenario 8 proved only
 *     a ping after the fault.
 *
 * Runs via `npm test` (packages/h2a/test discovery). No silent skip: a missing
 * manifest, an unreadable /proc, or an absent smoke script are FAILURES.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { observeSmoke } from "./helpers/smoke-observation-lab.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SMOKE_PATH = resolve(REPO_ROOT, "scripts", "smoke-artifact.mjs");
let SMOKE_SOURCE;
let MANIFEST;
try {
  SMOKE_SOURCE = readFileSync(SMOKE_PATH, "utf8");
  MANIFEST = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages", "h2a-runtime", "package.json"), "utf8"));
} catch (error) {
  assert.fail(`the smoke script and the runtime manifest must exist and be readable: ${error.message}`);
}

// The expected train follows the script's pinned literal: no hard-coded
// version below, so the next `release.mjs` bump cannot desynchronize the
// gate. Strength is kept by anchoring the pin to the workspace manifests
// (pin === train) instead of to a literal in this file.
const PINNED = /^const PINNED_RUNTIME_VERSION = '([^']+)'$/m.exec(SMOKE_SOURCE)?.[1];
assert.ok(PINNED, "the smoke must declare exactly one `const PINNED_RUNTIME_VERSION = 'X.Y.Z'` literal");
assert.match(PINNED, /^\d+\.\d+\.\d+$/, "the pinned literal must be a strict X.Y.Z train");
const PINNED_DECL_COUNT = (SMOKE_SOURCE.match(/^const PINNED_RUNTIME_VERSION = '[^']*'$/gm) ?? []).length;
assert.equal(PINNED_DECL_COUNT, 1, "the smoke must declare the pin exactly once");

test("C9 A10/A11: execute smoke orchestration and observe seed, install, faults, identity, prune and PTYs", async () => {
  await observeSmoke(SMOKE_SOURCE, SMOKE_PATH);
});

test("C9 A07: smoke consumes and preserves exactly the prebuilt candidate tarballs", async () => {
  await observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { prebuilt: true });
});

for (const omitMarker of ["smoke-pty", "smoke-pty-after-fault", "smoke-pty-after-stderr-fault"]) {
  test(`C9 A11: smoke must fail when ${omitMarker} produced no marker`, async () => {
    await assert.rejects(observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { omitMarker }), /PTY/);
  });
}
for (const changedIdentity of ["client", "stderr"]) {
  test(`C9 A11: smoke must fail when host identity changes after ${changedIdentity}`, async () => {
    await assert.rejects(observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { changedIdentity }), /identity changed/);
  });
}
test("C9 A10: smoke must fail when the installed runtime has a different version", async () => {
  assert.notEqual("0.98.4", PINNED, "the mismatch fixture must differ from the pinned train");
  await assert.rejects(observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { loadedVersion: "0.98.4" }), /runtime version/);
});

test("C9 A10: smoke must fail when the installed track has a different version", async () => {
  assert.notEqual("0.98.4", PINNED, "the mismatch fixture must differ from the pinned train");
  await assert.rejects(observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { loadedTrackVersion: "0.98.4" }), /track version/);
});

test("C9 A11: a failed fault connection proves no injection", async () => {
  await assert.rejects(observeSmoke(SMOKE_SOURCE, SMOKE_PATH, { failConnect: true }), /fault connection/);
});

test("R8.3: the runtime manifest must let the smoke prove the loaded path (./package.json subpath export)", () => {
  // The proof is resolution from an INSTALLED prefix, not from the workspace:
  // the reviewer reproduced the defect by installing the real manifest into a
  // temp prefix and resolving from there.
  const root = mkdtempSync(join(tmpdir(), "h2a-smoke-manifest-"));
  try {
    const packageDir = join(root, "node_modules", "@sentropic", "h2a-runtime");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(MANIFEST));
    const fromPrefix = createRequire(join(root, "probe.cjs"));
    assert.doesNotThrow(
      () => fromPrefix.resolve("@sentropic/h2a-runtime/package.json"),
      "the smoke path proof requires the ./package.json subpath export; without it the proof step is red and the smoke fails",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R8.3: the track manifest must let the smoke prove the loaded path (./package.json subpath export)", () => {
  // Same proof as the runtime: resolution from an INSTALLED prefix requires
  // the ./package.json subpath export, or the track path proof is red.
  const trackManifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "packages", "track", "package.json"), "utf8"),
  );
  const root = mkdtempSync(join(tmpdir(), "h2a-smoke-track-manifest-"));
  try {
    const packageDir = join(root, "node_modules", "@sentropic", "track");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify(trackManifest));
    const fromPrefix = createRequire(join(root, "probe.cjs"));
    assert.doesNotThrow(
      () => fromPrefix.resolve("@sentropic/track/package.json"),
      "the smoke track proof requires the ./package.json subpath export; without it the proof step is red and the smoke fails",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R8.3: the smoke stores the pid namespace as the production reader does — the numeric inode, never the raw symlink", async () => {
  assert.ok(
    SMOKE_SOURCE.includes('const inode = /\\[(\\d+)\\]/.exec(link)'),
    "the smoke must extract the numeric inode from the readlink before creating rows: the store-side pidNamespace is pinned /^\\d+$/ by R1",
  );
  const link = await readlink("/proc/self/ns/pid");
  const inode = /\[(\d+)\]/.exec(link)?.[1];
  assert.ok(inode, `/proc/self/ns/pid must be readable and carry a numeric inode (got: ${link})`);
  assert.match(
    inode,
    /^\d+$/,
    "the store-side representation is the bare inode — the exact value readPidNamespaceId() returns",
  );
  assert.notEqual(
    inode,
    link,
    "the raw magic symlink (pid:[NNN]) is NOT the stored representation: a row persisted with it is malformed store data, classified foreign-frame, and the cold boot is refused",
  );
});

test(`R8.3: the smoke proves the pinned literal version ${PINNED}, never 'whatever the candidate is'`, () => {
  const escaped = PINNED.replace(/\./g, "\\.");
  assert.match(
    SMOKE_SOURCE,
    new RegExp(`^const PINNED_RUNTIME_VERSION = '${escaped}'$`, "m"),
    `R8.3(4) pins the literal: version === ${PINNED}`,
  );
  assert.equal(
    PINNED,
    MANIFEST.version,
    "the pinned literal tracks the lockstep train: it must equal the runtime manifest version, otherwise the next bump desynchronizes the gate",
  );
  const trackManifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "packages", "track", "package.json"), "utf8"),
  );
  assert.equal(
    PINNED,
    trackManifest.version,
    "the lockstep train ships runtime and track at one version: the pin must equal the track manifest too",
  );
  assert.ok(
    SMOKE_SOURCE.includes("loadedVersion !== PINNED_RUNTIME_VERSION"),
    "the loaded version must be compared to the pinned literal",
  );
  assert.ok(
    SMOKE_SOURCE.includes("loadedTrackVersion !== PINNED_RUNTIME_VERSION"),
    "the loaded track version must be compared to the same pinned literal (lockstep train)",
  );
  assert.ok(
    !SMOKE_SOURCE.includes("loadedVersion !== runtimeVersion"),
    "comparing to the candidate version reopens the hole: a registry fallback to a previously published version of the same range would pass",
  );
  assert.ok(
    SMOKE_SOURCE.includes("proves the ${PINNED_RUNTIME_VERSION} train"),
    "the candidate-tree message must interpolate the pin: a hard-coded train freezes on the next bump",
  );
});

test("R8.3: the smoke packs and installs the candidate track tarball, never the registry", () => {
  assert.ok(
    SMOKE_SOURCE.includes("'@sentropic/track'") || SMOKE_SOURCE.includes('"@sentropic/track"'),
    "the smoke must pack @sentropic/track with the candidate (verify runs before publish, so the lockstep track is never on the registry)",
  );
  assert.ok(
    SMOKE_SOURCE.includes("require.resolve('@sentropic/track/package.json')"),
    "the smoke must prove the track path resolves from the installed prefix",
  );
  assert.ok(
    SMOKE_SOURCE.includes("@sentropic/track resolved OUTSIDE the candidate prefix"),
    "the track path proof must fail closed outside the prefix",
  );
  assert.ok(
    SMOKE_SOURCE.includes("loadedTrackVersion !== PINNED_RUNTIME_VERSION"),
    "the track proof must compare to the same pinned literal, never to the candidate version",
  );
});

test(`R8.3: the smoke installs all four candidate tarballs including track at ${PINNED}`, async () => {
  const observations = await observeSmoke(SMOKE_SOURCE, SMOKE_PATH);
  assert.deepEqual(
    observations.packed.sort(),
    ["@sentropic/h2a", "@sentropic/h2a-cli", "@sentropic/h2a-runtime", "@sentropic/track"],
    "the smoke must pack all four lockstep packages",
  );
  assert.equal(observations.installed.length, 4, "the prefix install must take exactly the four candidate tarballs");
  for (const name of ["h2a", "h2a-runtime", "h2a-cli", "track"]) {
    assert.ok(
      observations.installed.some((path) => path.endsWith(`sentropic-${name}-${PINNED}.tgz`)),
      `candidate ${name} must be installed from its local ${PINNED} tarball, never the registry`,
    );
  }
});

test("R8.3: scenario 7 closes the stderr reader BEFORE the deferred prune, and every fault is followed by a PTY proof", () => {
  const destroyAt = SMOKE_SOURCE.indexOf("stderrHost.stderr.destroy()");
  const delayedExitAt = SMOKE_SOURCE.indexOf("setTimeout(() => process.exit(0), 4000)");
  const pruneAt = SMOKE_SOURCE.indexOf("await waitForPrune(");
  assert.ok(destroyAt !== -1, "the smoke must destroy the stderr reader explicitly");
  assert.ok(delayedExitAt !== -1, "the scenario-7 session must be alive when the reader dies: a session that already exited proves no write-after-close");
  assert.ok(pruneAt !== -1, "the prune must be OBSERVED (registry row disappearing), not assumed by a fixed delay");
  assert.ok(
    delayedExitAt < destroyAt,
    "the session must exist before the destroy, so its deferred prune lands AFTER the close",
  );
  assert.ok(
    destroyAt < pruneAt,
    "the prune observation must follow the destroy: a prune observed before the close exercised nothing",
  );
  assert.ok(
    SMOKE_SOURCE.includes("provePtyOperation(cold, goodClient, 'smoke-pty-after-fault')"),
    "scenario 8 must prove a PTY operation after the faulty client, not only a ping",
  );
  assert.ok(
    SMOKE_SOURCE.includes("provePtyOperation(stderrLab, survivalClient, 'smoke-pty-after-stderr-fault')"),
    "scenario 7 must prove a PTY operation after the stderr fault, not only a ping",
  );
});

test("R8.3: the prune observation reads through the packaged registry reader — never a hand-rolled JSON.parse", () => {
  // Round-4 review finding F07: the observation must INHERIT the production
  // reader's 3-state contract (valid entries / per-row unreadable /
  // whole-file unknown). A hand-rolled `JSON.parse(readFileSync(...))` of the
  // registry re-implements a WEAKER reader inside the smoke and re-opens the
  // false green: an unreadable row that still identifies the session, and a
  // registry rebuilt from corrupt bytes, both used to "prove" the prune.
  assert.ok(
    SMOKE_SOURCE.includes("join(runtimeDist, 'registry.js')"),
    "the smoke must read the registry through the PACKAGED registry module (the bytes under test), not a workspace or hand-rolled reader",
  );
  assert.ok(
    SMOKE_SOURCE.includes("readers.loadRegistry(lab.registryPath)"),
    "the prune observation must call the production loadRegistry — the 3-state read whose verdicts the observation must inherit",
  );
  assert.ok(
    SMOKE_SOURCE.includes("readers.unreadableRowsForTarget("),
    "an unreadable row that still identifies the session must be matched by the reader's own identity rules — a local subset matcher re-opens G03",
  );
  assert.ok(
    SMOKE_SOURCE.includes("read.state === 'ok'"),
    "only the reader's 'ok' state observes rows: 'unknown' observes nothing, in either phase",
  );
  assert.ok(
    !SMOKE_SOURCE.includes("JSON.parse(readFileSync(lab.registryPath"),
    "a hand-rolled registry read flattens the reader's contract and lets indeterminate states prove prunes (round-4 finding F07)",
  );
});

test("R8.3: the prune proof observes the row PRESENT before its disappearance — an already-empty registry proves nothing", async () => {
  // Round-3 review finding N03: waitForPrune only polled for the row's
  // ABSENCE, so a registry that never contained the row "proved" a prune the
  // instant it was read. The proof must be two-phase: observe the row
  // present, then observe its disappearance. A row never seen present is no
  // evidence that the deferred prune ran.
  //
  // Round-4 review finding F02: valid JSON of an invalid shape observes
  // nothing. Round-4 review finding F07 (G03/G04): the observation goes
  // through the production reader's 3-state contract, so the reader's
  // UNREADABLE-row and UNKNOWN-file verdicts must block the disappearance
  // exactly as they do for every production consumer:
  //   - G03: a row whose id became invalid while its label still identifies
  //     the session is UNREADABLE to loadRegistry and MATCHES the target
  //     under unreadableRowsForTarget — it is the session's row, not its
  //     absence;
  //   - G04: a registry REBUILT from corrupt bytes (rebuiltFromCorruptAt) is
  //     state "unknown" to loadRegistry — rows from before the rebuild are
  //     not provably absent, so no prune is proved.
  // The injected reader pair mirrors the production contract the smoke wires
  // at runtime (pinned by the test above); each case is a sequence of
  // RegistryReadResult snapshots the reader returns on successive polls.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function extractFunction(source, name) {
    const begin = source.indexOf("  async function " + name + "(");
    assert.notEqual(begin, -1, `the smoke must define ${name}`);
    const end = source.indexOf("\n  }", begin);
    assert.notEqual(end, -1);
    return source.slice(begin, end + 4);
  }
  const fn = extractFunction(SMOKE_SOURCE, "waitForPrune")
    .replace("30_000", "60")
    .replace("setTimeout(r, 200)", "setTimeout(r, 2)");
  const throwingFail = (message) => { throw new Error(message); };

  const ok = (entries, unreadable = []) => ({ state: "ok", entries, unreadable });
  const unknown = (reason) => ({ state: "unknown", reason });
  const row = (id) => ({ id });

  /** A reader pair over a fixed snapshot sequence; counts loadRegistry polls. */
  function readerSequence(results) {
    let polls = 0;
    return {
      readers: {
        loadRegistry: async () => results[Math.min(polls++, results.length - 1)],
        // The production identity rules for a row that failed validation:
        // id or label still addresses the target (registry.ts
        // rawRowMatchesTarget — for these targets the managed-name branches
        // are vacuous).
        unreadableRowsForTarget: (target, unreadable) =>
          unreadable.filter((raw) => raw && typeof raw === "object" && (raw.id === target || raw.label === target)),
      },
      polls: () => polls,
    };
  }

  async function runWait(sessionId, results) {
    const harness = readerSequence(results);
    const run = new AsyncFunction(
      "readers",
      "fail",
      fn + "\nreturn waitForPrune({registryPath:'fixture'}, " + JSON.stringify(sessionId) + ", readers);",
    );
    return { outcome: run(harness.readers, throwingFail), polls: harness.polls };
  }

  // Case 1 — the row is NEVER present: the wait must reject, not resolve.
  {
    const wait = await runWait("never-persisted", [ok([])]);
    await assert.rejects(
      () => wait.outcome,
      /never observed PRESENT|never observed present/,
      "a prune proof that never saw the row present is a false observation: the round-3 defect",
    );
  }

  // Case 2 — present, then gone: the prune is observed, the wait resolves.
  {
    const wait = await runWait("observed", [ok([row("native-terminal-pty:observed")]), ok([])]);
    await wait.outcome; // must resolve: presence, then disappearance
    assert.ok(wait.polls() >= 2, "the disappearance must be a second observation, not the absence of a first one");
  }

  // Case 3 — present but never pruned: the wait must reject naming the prune.
  {
    const wait = await runWait("never-pruned", [ok([row("native-terminal-pty:never-pruned")])]);
    await assert.rejects(
      () => wait.outcome,
      /never pruned/,
      "a row that never disappears proves the deferred prune did not run",
    );
  }

  // Case 4 — round-4 finding F02: the row is observed PRESENT, then the
  // registry becomes valid JSON of an INVALID SHAPE (the reader's "unknown").
  // An invalid shape is UNKNOWN, not empty: the wait must reject, and must
  // not stop polling on it.
  {
    const wait = await runWait("shape-lost", [ok([row("native-terminal-pty:shape-lost")]), unknown("registry has no entries array")]);
    await assert.rejects(
      () => wait.outcome,
      /never pruned/,
      "a registry of an invalid shape cannot prove the prune: only a well-shaped snapshot showing the disappearance may",
    );
    assert.ok(wait.polls() >= 2, "the invalid-shape snapshot must be re-polled, never accepted as a disappearance");
  }

  // Case 5 — the same property through the unparsable path: a parse error is
  // not an empty registry either.
  {
    const wait = await runWait("parse-lost", [ok([row("native-terminal-pty:parse-lost")]), unknown("registry is unreadable or malformed")]);
    await assert.rejects(
      () => wait.outcome,
      /never pruned/,
      "a registry that stops parsing cannot prove the prune: an unreadable snapshot is unknown, never empty",
    );
  }

  // Case 6 — round-4 finding F07/G03: after the row is observed present, a
  // row whose id became INVALID while its label still identifies the session
  // is UNREADABLE to the reader and MATCHES the target — the session's row in
  // degraded form is not its absence. The wait must reject.
  {
    const wait = await runWait("unreadable-identity", [
      ok([row("native-terminal-pty:unreadable-identity")]),
      ok([], [{
        id: null,
        label: "native-terminal-pty:unreadable-identity",
        tool: "claude",
        kind: "local",
        cwd: "",
        source: "scan",
        enrolledAt: "2026-10-11T12:00:00.000Z",
        lastSeenAt: "2026-10-11T12:00:00.000Z",
      }]),
    ]);
    await assert.rejects(
      () => wait.outcome,
      /never pruned/,
      "an unreadable row whose label still identifies the session cannot prove a prune: the production reader keeps it as the session's row, not its absence (round-4 G03)",
    );
  }

  // Case 7 — round-4 finding F07/G04: a registry REBUILT from corrupt bytes
  // (rebuiltFromCorruptAt) is state "unknown" — rows from before the rebuild
  // are not provably absent. The wait must reject.
  {
    const wait = await runWait("rebuilt", [
      ok([row("native-terminal-pty:rebuilt")]),
      unknown("registry was rebuilt from an unreadable file at 2026-10-11T12:00:00.000Z — rows from before the rebuild are not provably absent"),
    ]);
    await assert.rejects(
      () => wait.outcome,
      /never pruned/,
      "a registry rebuilt from corrupt bytes cannot prove a prune: the production reader returns unknown for rebuiltFromCorruptAt (round-4 G04)",
    );
  }

  // Case 8 — a reader that THROWS observes nothing: the failure is unknown,
  // never empty, and the wait keeps polling.
  {
    const throwing = {
      loadRegistry: async () => { throw new Error("EIO"); },
      unreadableRowsForTarget: (target, unreadable) => unreadable.filter((raw) => raw?.label === target || raw?.id === target),
    };
    const run = new AsyncFunction(
      "readers",
      "fail",
      fn + "\nreturn waitForPrune({registryPath:'fixture'}, \"reader-error\", readers);",
    );
    await assert.rejects(
      () => run(throwing, throwingFail),
      /never observed PRESENT|never observed present/,
      "a reader that always fails observes nothing: the wait must reject, never treat the failure as an empty registry",
    );
  }

  // Case 9 — an UNREADABLE row that identifies the session counts as PRESENT
  // in the presence phase too: the two-phase proof may observe the row in
  // degraded form, then its disappearance.
  {
    const wait = await runWait("degraded-then-gone", [
      ok([], [{ id: null, label: "native-terminal-pty:degraded-then-gone" }]),
      ok([]),
    ]);
    await wait.outcome; // must resolve: degraded presence, then disappearance
    assert.ok(wait.polls() >= 2, "the disappearance must be a second observation");
  }
});

test("R8.3: the smoke stays isolated — temp parents only, no real host state", () => {
  assert.ok(SMOKE_SOURCE.includes("mkdtempSync"), "the smoke must build its labs under mkdtemp'd parents");
  for (const forbidden of ["/run/user/1000", '".config/sentropic"', '".local/state"']) {
    assert.ok(
      !SMOKE_SOURCE.includes(forbidden),
      `the smoke must not reference real host state paths (${forbidden})`,
    );
  }
});
