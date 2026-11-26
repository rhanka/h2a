import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "node:http";
import { createLocalStore } from "../dist/index.js";
import { isH2AEnvelope } from "../dist/envelope.js";
import { OperationLedger, OwnershipRegistry } from "../dist/runtime/handover/ownership.js";
import { readState } from "../dist/runtime/handover/state.js";
import { canonicalBytes, digest } from "../dist/runtime/handover/wire.js";
import {
  evaluateWitnessCalibration,
  probeC51Endpoints,
  summarizeC51Trials,
} from "../../../scripts/bench-central-real-copy.mjs";
import {
  L5B_EXPECTED_COUNTS,
  computeStateFingerprint,
  generateL5bBenchState,
} from "../../../scripts/generate-l5b-bench-state.mjs";
import { collectAncestorPids, findConcurrentProcesses } from "../../../scripts/run-l5b-night-bench.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const GENERATOR_CLI = join(REPO_ROOT, "scripts", "generate-l5b-bench-state.mjs");
const NIGHT_CLI = join(REPO_ROOT, "scripts", "run-l5b-night-bench.mjs");
const BENCH_CLI = join(REPO_ROOT, "scripts", "bench-central-real-copy.mjs");

function makeLabDir(t, prefix) {
  const base = tmpdir();
  const dir = mkdtempSync(join(base, prefix));
  chmodSync(dir, 0o700);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("L5B generator produces deterministic §6.2.a state, valid handover/store formats, 0700/0600 modes and identical fingerprint", { timeout: 60_000 }, (t) => {
  const lab = makeLabDir(t, "l5b-gen-");
  const runA = join(lab, "a");
  const runB = join(lab, "b");
  const fpA = generateL5bBenchState({ stateDir: join(runA, "state"), rootDir: join(runA, "root") });
  const fpB = generateL5bBenchState({ stateDir: join(runB, "state"), rootDir: join(runB, "root") });

  assert.equal(fpA.shapeMatchesL5b, true, `shape mismatches: ${fpA.shapeMismatches.join("; ")}`);
  assert.equal(fpB.shapeMatchesL5b, true);
  assert.equal(fpA.sortedListSha256, fpB.sortedListSha256, "sorted file list SHA-256 must be deterministic");
  assert.equal(fpA.sortedContentSha256, fpB.sortedContentSha256, "sorted file content SHA-256 must be deterministic");
  assert.deepEqual(fpA.counts, fpB.counts);

  // Exact §6.2.a counts
  assert.deepEqual(fpA.counts.rootState, L5B_EXPECTED_COUNTS.rootState);
  assert.equal(fpA.counts.archive.manifestPresent, true);
  assert.ok(fpA.counts.archive.manifestLines >= Math.ceil(32935 / 32));
  assert.deepEqual(fpA.counts.archive.batches["batch-20261123"], {
    operations: 15771,
    effects: 15773,
    generationEnds: 1391,
    otherFiles: 0,
    totalFiles: 32935,
  });
  assert.equal(fpA.counts.workspaceRoot.hasSchema, true);
  assert.equal(fpA.counts.workspaceRoot.hasRegistry, true);
  assert.equal(fpA.counts.workspaceRoot.hasNegotiations, true);
  assert.equal(fpA.counts.workspaceRoot.hasInbox, true);
  assert.equal(fpA.counts.workspaceRoot.hasKeys, false);
  assert.equal(fpA.modes.violations, 0);

  // Verify manifest.jsonl canonical format + archive lookup + drain reconciliation on generated files
  const stateDir = join(runA, "state");
  const manifestRaw = readFileSync(join(stateDir, "archive", "manifest.jsonl"), "utf8");
  const manifestLines = manifestRaw.split("\n").filter(Boolean);
  assert.equal(manifestLines.length, fpA.counts.archive.manifestLines);
  let archivedOpsInManifest = 0;
  let archivedEffInManifest = 0;
  let archivedGenInManifest = 0;
  for (const line of manifestLines) {
    const rec = JSON.parse(line);
    assert.equal(`${canonicalBytes(rec).toString("utf8")}\n`, `${line}\n`, "manifest.jsonl line must be canonical");
    assert.equal(rec.batchDir, "batch-20261123");
    archivedOpsInManifest += rec.operations.length;
    archivedEffInManifest += rec.effects.length;
    archivedGenInManifest += rec.generationEnds.length;
  }
  assert.equal(archivedOpsInManifest, 15771);
  assert.equal(archivedEffInManifest, 15773);
  assert.equal(archivedGenInManifest, 1391);

  // Validate representative root & archive files via production readState()
  const rootFiles = readdirSync(stateDir);
  const sampleOps = rootFiles.filter((n) => n.startsWith("operation-")).slice(0, 5);
  const sampleEffects = rootFiles.filter((n) => n.startsWith("effect-")).slice(0, 5);
  const sampleGenEnds = rootFiles.filter((n) => n.startsWith("generation-end-")).slice(0, 5);
  const sampleOwners = rootFiles.filter((n) => n.startsWith("ownership-")).slice(0, 5);
  const allLaunches = rootFiles.filter((n) => /^launch-[a-f0-9]+\.json$/.test(n));
  const allLaunchLocs = rootFiles.filter((n) => n.startsWith("launch-location-"));
  assert.equal(allLaunches.length, 4);
  assert.equal(allLaunchLocs.length, 4);

  for (const f of sampleOps) assert.ok(readState(join(stateDir, f), "admittedOperation"));
  for (const f of sampleEffects) assert.ok(readState(join(stateDir, f), "ownerEffect"));
  for (const f of sampleGenEnds) assert.ok(readState(join(stateDir, f), "generationEnd"));
  for (const f of sampleOwners) assert.ok(readState(join(stateDir, f), "ownership"));
  for (const f of allLaunches) {
    const obs = readState(join(stateDir, f), "launchMemo");
    assert.equal(obs.value.state, "unknown");
  }
  for (const f of allLaunchLocs) assert.ok(readState(join(stateDir, f), "launchLocation"));

  // Check that the 4 launch-* unknown memos link to archived :child ops & root unknown :brief ops
  const reg = new OwnershipRegistry({ directory: stateDir, generation: "00000000-0000-4000-8000-000000000001", processIdentity: { machineId: "1".repeat(32), bootId: "00000000-0000-4000-8000-000000000002", pidNamespace: "1", nsNet: "1", pid: 1, startTime: 1 }, readOnly: true, skipSyncInit: true });
  reg._hydrateControlFiles();
  const ledger = new OperationLedger(reg, { skipAutoMigration: true });
  assert.equal(ledger.archivedOperations.size, 15771);
  assert.equal(ledger.archivedEffects.size, 15773);
  assert.equal(ledger.archivedGenerationEnds.size, 1391);
  for (const memo of reg.allLaunchMemos()) {
    const childOp = ledger.getOperation(`${memo.launchId}:child`);
    assert.equal(childOp?.state, "completed", "archived :child op must resolve from batch-20261123");
    const briefOp = readState(join(stateDir, `operation-${digest(`${memo.launchId}:brief`).slice(7)}.json`), "admittedOperation");
    assert.equal(briefOp?.value.state, "unknown", "root :brief op must exist in state unknown");
  }

  // Verify synthetic workspace root opens cleanly via createLocalStore({ initialize: false })
  const rootDir = join(runA, "root");
  const store = createLocalStore({ root: rootDir, initialize: false });
  assert.equal(store.listInstances().length, 6);
  const inboxActors = readdirSync(join(rootDir, "inbox"));
  assert.equal(inboxActors.length, 1);
  const envFiles = readdirSync(join(rootDir, "inbox", inboxActors[0]));
  assert.equal(envFiles.length, 1);
  const envJson = JSON.parse(readFileSync(join(rootDir, "inbox", inboxActors[0], envFiles[0]), "utf8"));
  assert.equal(isH2AEnvelope(envJson), true);

  // Verify mode violation detection in computeStateFingerprint
  chmodSync(join(stateDir, sampleOps[0]), 0o644);
  const fpBadMode = computeStateFingerprint(stateDir, rootDir);
  assert.equal(fpBadMode.shapeMatchesL5b, false);
  assert.ok(fpBadMode.modes.violations >= 1);
});

test("L5B generator CLI refuses /tmp paths", () => {
  const res = spawnSync(process.execPath, [GENERATOR_CLI, "--state", "/tmp/l5b-nope-state", "--root", "/tmp/l5b-nope-root"], {
    encoding: "utf8",
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /\/tmp/);
});

test("L5B night bench script refuses under high loadavg, low disk, or insufficient CPUs without measuring or creating outDir", (t) => {
  const lab = makeLabDir(t, "l5b-night-guard-");
  const fakeWitness = join(lab, "fake-witness.js");
  writeFileSync(fakeWitness, "console.log('noop');\n", { mode: 0o600 });

  // 1. Refusal on loadavg > limit
  const outLoad = join(lab, "out-load");
  const resLoad = spawnSync(
    process.execPath,
    [NIGHT_CLI, "--out", outLoad, "--witness-bin", fakeWitness, "--max-loadavg", "0.0001", "--min-disk-gb", "1", "--min-cpus", "1"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(resLoad.status, 0);
  assert.match(resLoad.stderr, /loadavg_1m=/);
  assert.equal(existsSync(outLoad), false, "refused run must not create outDir");

  // 2. Refusal on disk < limit
  const outDisk = join(lab, "out-disk");
  const resDisk = spawnSync(
    process.execPath,
    [NIGHT_CLI, "--out", outDisk, "--witness-bin", fakeWitness, "--max-loadavg", "10000", "--min-disk-gb", "9999999", "--min-cpus", "1"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(resDisk.status, 0);
  assert.match(resDisk.stderr, /disk_.*GiB/);
  assert.equal(existsSync(outDisk), false);

  // 3. Refusal on cpus < limit
  const outCpu = join(lab, "out-cpu");
  const resCpu = spawnSync(
    process.execPath,
    [NIGHT_CLI, "--out", outCpu, "--witness-bin", fakeWitness, "--max-loadavg", "10000", "--min-disk-gb", "1", "--min-cpus", "99999"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(resCpu.status, 0);
  assert.match(resCpu.stderr, /cpus=/);
  assert.equal(existsSync(outCpu), false);

  // 4. collectAncestorPids excludes self and parent from concurrent process scan
  const ancestors = collectAncestorPids();
  assert.equal(ancestors.has(process.pid), true);
  assert.equal(Array.isArray(findConcurrentProcesses(ancestors)), true);
});

test("bench-central-real-copy --strict-conditions refuses before measuring when loadavg > max-loadavg or shape mismatches", (t) => {
  const lab = makeLabDir(t, "l5b-bench-guard-");
  const sDir = join(lab, "state");
  const rDir = join(lab, "root");
  const oDir = join(lab, "out");
  const runBase = join(lab, "run-base");
  mkdirSync(sDir, { recursive: true, mode: 0o700 });
  mkdirSync(rDir, { recursive: true, mode: 0o700 });
  mkdirSync(runBase, { recursive: true, mode: 0o700 });

  const resLoad = spawnSync(
    process.execPath,
    [
      BENCH_CLI,
      "--source-state", sDir,
      "--source-root", rDir,
      "--out", oDir,
      "--run-base", runBase,
      "--skip-witness",
      "--max-loadavg", "0.0001",
      "--min-disk-gb", "1",
      "--strict-conditions",
      "--allow-stale-dist",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(resLoad.status, 0);
  assert.match(resLoad.stderr, /loadavgStart\[0\]=.*--strict-conditions|refusing to start/);
  assert.equal(existsSync(join(oDir, "results.json")), false);

  const resShape = spawnSync(
    process.execPath,
    [
      BENCH_CLI,
      "--source-state", sDir,
      "--source-root", rDir,
      "--out", oDir,
      "--run-base", runBase,
      "--skip-witness",
      "--max-loadavg", "10000",
      "--min-disk-gb", "1",
      "--require-l5b-shape",
      "--strict-conditions",
      "--allow-stale-dist",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(resShape.status, 0);
  assert.match(resShape.stderr, /sourceFingerprint shape mismatch/);
  assert.equal(existsSync(join(oDir, "results.json")), false);
});

test("NB-17 probeC51Endpoints polls until /health ready and returns bounded failure on timeout", async (t) => {
  let healthHits = 0;
  let forceStarting = false;
  const server = createServer((req, res) => {
    if (req.url === "/_h2a-central/health") {
      healthHits++;
      const ready = !forceStarting && healthHits >= 3;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ state: ready ? "ready" : "starting" }));
      return;
    }
    if (req.url === "/_h2a-central/ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}`;

  const okProbe = await probeC51Endpoints(endpoint, 3_000);
  assert.equal(okProbe.healthOk, true);
  assert.equal(okProbe.pingOk, true);
  assert.equal(okProbe.healthStatus, 200);
  assert.equal(okProbe.pingStatus, 200);
  assert.ok(okProbe.probesCount >= 3, `expected >= 3 polls, got ${okProbe.probesCount}`);

  forceStarting = true;
  const timedOutProbe = await probeC51Endpoints(endpoint, 80);
  assert.equal(timedOutProbe.healthOk, false);
  assert.equal(timedOutProbe.pingOk, true);
  assert.ok(timedOutProbe.probesCount >= 1);
});

test("NB-17 summarizeC51Trials excludes non-ok trials and publishes firstMs", () => {
  const partial = summarizeC51Trials([
    { ok: false, c51Ms: 9999 },
    { ok: true, c51Ms: 300 },
    { ok: true, c51Ms: 100 },
    { ok: true, c51Ms: 500 },
  ]);
  assert.equal(partial.firstMs, null);
  assert.equal(partial.okCount, 3);
  assert.equal(partial.allOk, false);
  assert.equal(partial.minMs, 100);
  assert.equal(partial.medianMs, 300);
  assert.equal(partial.maxMs, 500);

  const valid = summarizeC51Trials([
    { ok: true, c51Ms: 650 },
    { ok: true, c51Ms: 420 },
    { ok: true, c51Ms: 480 },
  ]);
  assert.equal(valid.firstMs, 650);
  assert.equal(valid.okCount, 3);
  assert.equal(valid.allOk, true);
  assert.equal(valid.minMs, 420);
  assert.equal(valid.medianMs, 480);
  assert.equal(valid.maxMs, 650);
});

test("NB-21 evaluateWitnessCalibration accepts pre-steps order of magnitude and rejects outliers", () => {
  const okC51 = summarizeC51Trials([
    { ok: true, c51Ms: 520 },
    { ok: true, c51Ms: 460 },
    { ok: true, c51Ms: 490 },
  ]);
  const okCal = evaluateWitnessCalibration(
    { status: "ok", steadyCpuPct: 4.3, migrationDoneMs: 6500, peakMigrationP99Ms: 90, c51Ms: 520 },
    okC51,
    3,
    5
  );
  assert.equal(okCal.calibrated, true);
  assert.deepEqual(okCal.failures, []);

  const badC51 = summarizeC51Trials([
    { ok: true, c51Ms: 90 },
    { ok: false, c51Ms: 110 },
  ]);
  const badCal = evaluateWitnessCalibration(
    { status: "ok", steadyCpuPct: 0.4, migrationDoneMs: 300, peakMigrationP99Ms: 10, c51Ms: 90 },
    badC51,
    2,
    5
  );
  assert.equal(badCal.calibrated, false);
  assert.ok(badCal.failures.length >= 4, `expected >= 4 failures, got ${badCal.failures.join("; ")}`);
});
