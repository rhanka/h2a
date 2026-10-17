// cli-seat-direct-matrix.test.js
//
// L2-s direct matrix: 25 directed pairs x 4 scenarios = 100 synthetic cells.
// Credential-free fixture/contract coverage for public PR gates. No real
// credential, no live CLI, no network. Authenticated NxN execution uses only
// scripts/e2e-cli-seats-direct.mjs in private jobs.
//
// Fail-closed: missing credentials/preflight produce unavailable/failed
// receipts and fail the suite; a passing skip is never emitted. Every
// inventory enumerates all five CLIs (agy, codex, vibe, muse, claude);
// gemini is not a member of this circuit.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

// Compile the exact repository sources into a disposable module tree. No
// installed runtime, provider, native host or owner profile is resolved.
const compiled = mkdtempSync(join(tmpdir(), "h2a-seat-sources-"));
after(() => rmSync(compiled, { recursive: true, force: true }));
const runtimeRoot = mkdtempSync(join(tmpdir(), "h2a-seat-matrix-runtime-"));
const previousRuntime = process.env.XDG_RUNTIME_DIR;
process.env.XDG_RUNTIME_DIR = runtimeRoot;
after(() => {
  if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = previousRuntime;
  rmSync(runtimeRoot, { recursive: true, force: true });
});
writeFileSync(join(compiled, "package.json"), JSON.stringify({ type: "module" }));
for (const name of ["cli-seat-fixtures", "cli-seat-codecs", "cli-seat-materialization"]) {
  const source = readFileSync(new URL(`../../h2a-runtime/src/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(compiled, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const seats = await import(pathToFileURL(join(compiled, "cli-seat-materialization.js")).href);
const fixtures = await import(pathToFileURL(join(compiled, "cli-seat-fixtures.js")).href);

const CLIS = fixtures.SEAT_CLIS_5;
const SCENARIOS = fixtures.SEAT_SCENARIOS_4;
const admission = { entitlementClass: "lab-seat", ownerApproved: true, q3Approved: true, consumedUnits: 0, requestedUnits: 1 };

function syntheticCell(sender, receiver, scenario) {
  const root = mkdtempSync(join(runtimeRoot, "h2a-seat-matrix-"));
  try {
    return seats.runSyntheticSeatCell(sender, receiver, scenario, { parentDir: root, admission });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("matrix inventory enumerates 25 directed pairs x 4 scenarios", () => {
  const pairs = [];
  for (const sender of CLIS) for (const receiver of CLIS) pairs.push([sender, receiver]);
  assert.equal(pairs.length, 25);
  assert.equal(new Set(pairs.map(([s, r]) => `${s}>${r}`)).size, 25);
  assert.deepEqual([...CLIS].sort(), ["agy", "claude", "codex", "muse", "vibe"]);
  assert.ok(!CLIS.includes("gemini"));
  assert.deepEqual(SCENARIOS, ["message", "unavailable", "loop", "negotiation"]);
});

test("100 synthetic directed cells with direct route and h2a MCP", async (t) => {
  let cells = 0;
  for (const sender of CLIS) {
    for (const receiver of CLIS) {
      for (const scenario of SCENARIOS) {
        await t.test(`${sender}>${receiver}/${scenario}`, () => {
          const receipt = syntheticCell(sender, receiver, scenario);
          assert.equal(receipt.outcome, "synthetic-pass");
          assert.equal(receipt.gateway, "off");
          assert.notEqual(receipt.seatRef, receipt.peerRef);
          assert.notEqual(receipt.familyRef, receipt.peerFamilyRef);
          assert.equal(receipt.actors.length, 2);
          assert.notEqual(receipt.actors[0].runId, receipt.actors[1].runId);
          assert.equal(receipt.q1ConsumedUnits, 1);
          assert.deepEqual(receipt.actors.map(a => a.cli), [sender, receiver]);
          assert.ok(receipt.actors.every(a => ["static-key", "access-only"].includes(a.capability)));
          cells += 1;
        });
      }
    }
  }
  assert.equal(cells, 100);
});

test("serialized-only diagonals execute and clear the full family cycle in all four scenarios", async t => {
  for (const cli of CLIS.filter(cli => cli !== "vibe")) {
    for (const scenario of SCENARIOS) await t.test(`${cli}>${cli}/${scenario}/serialized`, () => {
      const root = mkdtempSync(join(runtimeRoot, "serialized-cell-"));
      try {
        const first = fixtures.makeSyntheticSeatBundle(cli), second = fixtures.makeSyntheticSeatBundle(cli);
        second.identity.seatRef += "-peer";
        second.identity.refreshFamilyRef += "-peer";
        first.nativeUse = second.nativeUse = { kind: "unavailable", reason: "serialized-only" };
        const receipt = seats.runSyntheticSeatCell(cli, cli, scenario, { parentDir: root, admission, bundles: [first, second] });
        assert.equal(receipt.outcome, "synthetic-pass");
        assert.deepEqual(receipt.actors.map(a => a.capability), ["serialized", "serialized"]);
        for (const bundle of [first, second]) {
          const ticket = seats.beginSerializedStream(bundle.identity.refreshFamilyRef, bundle.lifecycle);
          seats.captureSerializedResult(ticket, { failed: false, changed: false, ambiguous: false });
          assert.equal(seats.validateStreamClearance(ticket, { ...ticket, cleanupComplete: true }).cleared, true);
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
});

test("missing credential yields an unavailable receipt, never a passing skip", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-seat-missing-"));
  try {
    const receipt = seats.runSyntheticSeatCell("claude", "codex", "message", { parentDir: root, admission, bundles: [undefined, fixtures.makeSyntheticConsumerBundle("codex")] });
    assert.equal(receipt.outcome, "unavailable");
    assert.notEqual(receipt.outcome, "synthetic-pass");
    assert.equal(receipt.q1ConsumedUnits, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("billing admission refuses daily credentials, missing owner/Q3 approval and Q1 reserve use", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-seat-billing-"));
  try {
    for (const rejected of [{ entitlementClass: "daily" }, { ownerApproved: false }, { q3Approved: false }, { consumedUnits: 8 }, { requestedUnits: NaN }, { requestedUnits: -1 }]) {
      const receipt = seats.runSyntheticSeatCell("claude", "codex", "message", { parentDir: root, admission: { ...admission, ...rejected } });
      assert.equal(receipt.outcome, "unavailable"); assert.equal(receipt.q1ConsumedUnits, 0);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("serialized family admission excludes a second process", () => {
  const root = mkdtempSync(join(runtimeRoot, "h2a-seat-stream-process-"));
  try {
    const predecessor = { epoch: 1, generation: 0, operationId: "synthetic-process-op" };
    seats.beginSerializedStream("synthetic-process-family", predecessor, root);
    const moduleUrl = pathToFileURL(join(compiled, "cli-seat-materialization.js")).href;
    const script = `const seats = await import(process.argv[1]); try {
      seats.beginSerializedStream("synthetic-process-family", { epoch: 1, generation: 0, operationId: "synthetic-process-op" }, process.argv[2]);
      process.exitCode = 1;
    } catch (error) { if (error.code !== "family-pending") throw error; }`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, moduleUrl, root], {
      encoding: "utf8", timeout: 5_000,
      env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, XDG_RUNTIME_DIR: root },
    });
    assert.ifError(result.error); assert.equal(result.signal, null);
    assert.equal(result.status, 0, "a different process must observe the pending family fence");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("live stub refuses missing receipts without resolving installed provider packages", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-seat-stub-"));
  try {
    const resolutions = join(root, "resolutions.jsonl");
    writeFileSync(resolutions, "");
    const probe = join(root, "resolution-probe.mjs");
    writeFileSync(probe, `
      import Module, { isBuiltin } from "node:module";
      import { appendFileSync } from "node:fs";
      const original = Module._resolveFilename;
      Module._resolveFilename = function(request, ...args) {
        if (!isBuiltin(request)) {
          appendFileSync(${JSON.stringify(resolutions)}, JSON.stringify(request) + "\\n");
          throw new Error("provider package resolution refused in synthetic lane");
        }
        return original.call(this, request, ...args);
      };
    `);
    const env = { PATH: process.env.PATH, HOME: join(root, "home"), TMPDIR: root,
      XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"),
      XDG_RUNTIME_DIR: join(root, "runtime") };
    for (const dir of Object.values(env).filter(value => value?.startsWith(root))) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const script = new URL("../../../scripts/e2e-cli-seats-direct.mjs", import.meta.url);
    const result = spawnSync(process.execPath, ["--import", probe, fileURLToPath(script),
      "--cli", "all", "--scenario", "all", "--platform", "linux"],
    { env, cwd: root, encoding: "utf8", timeout: 5_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /refusing live execution: L2-s is synthetic only/);
    assert.match(result.stderr, /missing receipt: L1 seat contract/);
    assert.match(result.stderr, /missing receipt: L2a runner qualification/);
    assert.equal(readFileSync(resolutions, "utf8"), "", "a package version cannot substitute for an L1 receipt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
