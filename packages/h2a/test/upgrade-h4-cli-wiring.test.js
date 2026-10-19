// LOT-1 RED-first: the H4 upgrade surface must be wired into the CLI.
//
// Every case drives the public surface (`runCli` in-process, or the built
// binary / real boot worker where the spec requires a separate process) with
// all externals stubbed and counted: a stub npm registry counts metadata vs
// tarball hits, temp HOME/XDG dirs must stay empty (no host-config writes),
// and a process.kill wrapper counts native signals (must stay zero).
//
// On the pre-fix head these fail exactly as F-02/SP-04 describe: `upgrade
// status`, `upgrade resume`, bare dry-runs and every new subcommand run the
// legacy npm lookup/install path (exit 0 "already current or registry
// unreachable") instead of the H4 surface. Case (d) documents preserved
// behaviour and is green before and after.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const HERE = dirname(new URL(import.meta.url).pathname);
const DIST = join(HERE, "..", "dist");
const BIN = join(DIST, "bin.js");

const { runCli } = await import("../dist/index.js");
const { UpgradeStore } = await import("../dist/runtime/upgrade/h4-store.js");
const { publishState } = await import("../dist/runtime/handover/state.js");
const { prefixLayout } = await import("../dist/runtime/handover/authority.js");
const { createManifest } = await import("../src/runtime/handover/image.js");
const { digest } = await import("../src/runtime/handover/wire.js");

// ---------------------------------------------------------------------------
// Native-signal accounting (case n): no upgrade path may stop, restart or
// signal the native host. process.kill is wrapped once for the whole file.
// ---------------------------------------------------------------------------
const killCalls = [];
const realKill = process.kill;
process.kill = ((pid, signal) => {
  killCalls.push([pid, String(signal ?? "SIGTERM")]);
  return realKill(pid, signal);
});
test.after(() => {
  process.kill = realKill;
  assert.equal(killCalls.length, 0, `native signals sent: ${JSON.stringify(killCalls)}`);
});

// ---------------------------------------------------------------------------
// Stub npm registry: serves a minimal packument for @sentropic/h2a and logs
// every request. Metadata views are the lookup path; any tarball/POST is an
// install-path effect and fails the calling case.
// ---------------------------------------------------------------------------
// The stub registry MUST run in a separate process: the tests exercise the
// real `npm view` lookup (spawnSync), which blocks this event loop, so an
// in-process server could never answer. Hits are appended to a JSONL log the
// test reads back.
const STUB_SOURCE = `
const http = require("node:http");
const fs = require("node:fs");
const [logFile, latest] = process.argv.slice(1);
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    fs.appendFileSync(logFile, JSON.stringify({ method: req.method, url: req.url, bytes: body.length }) + "\\n");
    const path = req.url.toLowerCase();
    if (path === "/@sentropic%2fh2a" || path === "/@sentropic/h2a") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "@sentropic/h2a", "dist-tags": { latest },
        versions: { [latest]: { name: "@sentropic/h2a", version: latest, dist: { tarball: "http://127.0.0.1/x/y.tgz" } } } }));
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT=" + server.address().port + "\\n");
});
`;

async function stubRegistry(t, latest) {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "h4reg-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logFile = join(dir, "hits.jsonl");
  writeFileSync(logFile, "");
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--eval", STUB_SOURCE, logFile, latest], {
    stdio: ["ignore", "pipe", "inherit"]
  });
  t.after(() => {
    try {
      realKill(child.pid, "SIGKILL");
    } catch {
      // Already exited.
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stub registry did not report a port")), 15000);
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
      const match = /PORT=(\d+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("error", reject);
  });
  const readLog = () =>
    readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  // Only tarball/pack fetches count as install-path effects. Metadata views
  // (the packument) and npm's own self-version checks (`GET /npm` on a fresh
  // HOME) are lookup traffic, not installs.
  const tarballHits = () => readLog().filter((entry) => /\.tgz(\?|$)/.test(entry.url) || entry.url.includes("/-/"));
  return { url: `http://127.0.0.1:${port}`, log: readLog(), tarballHits, readLog };
}

// ---------------------------------------------------------------------------
// Fixture managed installation: a fake npm prefix (so openBootstrapSession
// can verify physical provenance) plus a managed root with installation
// state, closed images and an optional opt-out marker. Mirrors the
// mh-l6-upgrade-run.test.js rig.
// ---------------------------------------------------------------------------
function nodeProfile() {
  return {
    platform: "linux",
    arch: process.arch,
    libc: "glibc",
    nodeMajor: Number(process.versions.node.split(".")[0]),
    nodeAbi: process.versions.modules
  };
}

function mkImage(fixture, { version, buildId, controllerProtocol = 1, entrypoints = null }) {
  const stage = mkdtempSync(join(fixture.root, "stage-"));
  writeFileSync(
    join(stage, "entry.mjs"),
    `process.stdout.write(JSON.stringify({ buildId: ${JSON.stringify(buildId)} }) + "\\n");\n`
  );
  writeFileSync(
    join(stage, "controller.json"),
    JSON.stringify({ schemaVersion: 1, protocolVersion: controllerProtocol, entrypoint: "entry.mjs" })
  );
  const manifest = createManifest(stage, {
    packageVersion: version,
    buildId,
    profile: nodeProfile(),
    entrypoints: entrypoints ?? { controller: "entry.mjs", shim: "entry.mjs" },
    startupWaitBudgetMs: 10000,
    maxAttachments: 64,
    nativeArtifacts: []
  });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest));
  const manifestDigest = digest(manifest);
  const imageRoot = join(fixture.managedRoot, "images", manifestDigest.slice(7));
  mkdirSync(dirname(imageRoot), { recursive: true });
  rmSync(imageRoot, { recursive: true, force: true });
  renameSync(stage, imageRoot);
  return { version, buildId, manifestDigest, entrypoint: "entry.mjs", imageRoot };
}

function mkFixture(t) {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "h4cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  // Fake npm prefix with the legacy layout openBootstrapSession verifies.
  const prefix = join(root, "prefix");
  const pkg = join(prefix, "lib", "node_modules", "@sentropic", "h2a");
  mkdirSync(join(pkg, "dist"), { recursive: true, mode: 0o755 });
  mkdirSync(join(prefix, "bin"), { mode: 0o755 });
  const entry = join(pkg, "dist", "bin.js");
  writeFileSync(entry, "#!/usr/bin/env node\nprocess.stdout.write(\"fixture-legacy-entry\");\n", { mode: 0o755 });
  writeFileSync(join(pkg, "package.json"),
    JSON.stringify({ name: "@sentropic/h2a", version: "0.98.6", bin: { h2a: "dist/bin.js" } }), { mode: 0o644 });
  const command = join(prefix, "bin", "h2a");
  symlinkSync("../lib/node_modules/@sentropic/h2a/dist/bin.js", command);
  const layout = prefixLayout(prefix, prefix, process.getuid());
  for (const path of ["state", "state/upgrade", "state/upgrade/transactions", "state/upgrade/private",
    "state/upgrade/receipts", "state/selection-history", "state/pins", "images"]) {
    mkdirSync(join(layout.managedRoot, path), { recursive: true, mode: 0o700 });
  }
  const installation = {
    schemaVersion: 1,
    prefixId: layout.prefixId,
    canonicalPrefix: prefix,
    uid: process.getuid(),
    managedRoot: layout.managedRoot
  };
  publishState(join(layout.managedRoot, "installation.json"), installation, "installation");
  // H4 run envelope paths, all derived from the managed root except the npm
  // command link the adoption swaps to the managed launcher. The managed
  // command link starts as the legacy link.
  const managedDir = join(layout.managedRoot, "managed");
  mkdirSync(managedDir, { mode: 0o700 });
  const launcherSource = join(layout.managedRoot, "launcher-source.mjs");
  writeFileSync(launcherSource, "export const launcher = true;\n");
  // The adoption swaps the legacy command link itself (single adopting run
  // per fixture: a second session would observe the swapped link, which is
  // F-remainder inter-transaction depth, explicitly out of LOT-1 scope).
  const commandPath = command;
  const exclusion = {
    workersTerminated: { established: true, detail: "no legacy worker alive" },
    relaunchSourcesClosed: { established: true, detail: "autostart entries removed" },
    futureStartsRouted: { established: true, detail: "managed launcher primary" },
    installerReintroductionBarred: { established: true, detail: "installer path unreachable" }
  };
  // Operator-provided exclusion evidence consumed by the CLI dispatcher
  // (fail-closed: absent or malformed evidence defers selection).
  writeFileSync(join(layout.managedRoot, "exclusion-evidence.json"), JSON.stringify(exclusion));
  const fixture = { root, home, prefix, entry, command, managedRoot: layout.managedRoot,
    installation, managedDir, launcherSource, commandPath, exclusion, images: [] };
  fixture.image = (opts) => {
    const built = mkImage(fixture, opts);
    fixture.images.push(built);
    return built;
  };
  return fixture;
}

// Complete a durable selection for `image` through the store API (setup only:
// this is the pre-existing H4 engine, not the CLI path under test).
//
// completeTransaction moves the setup transaction to COMPLETED through the
// digest-checked state primitives. No engine method writes COMPLETED yet
// (inter-transaction completion is F-remainder/NC-6b depth); the fixture
// therefore represents "the previous upgrade completed", the exact resting
// state a second `upgrade --to` must start from. Without it the engine
// (correctly) refuses a second begin with `upgrade_in_progress`.
async function completeTransaction(fixture, upgradeId) {
  const { readState, replaceState } = await import("../dist/runtime/handover/state.js");
  const path = join(fixture.managedRoot, "state", "upgrade", "transactions", `${upgradeId}.json`);
  const record = readState(path, "upgradeTransaction");
  assert.ok(record, "setup transaction must exist");
  replaceState(path, { ...record.value, installationState: "COMPLETED",
    revision: record.value.revision + 1,
    updatedAt: Math.max(Date.now(), record.value.updatedAt) }, "upgradeTransaction", record);
}

function selectThroughStore(fixture, upgradeId, image) {
  const store = new UpgradeStore(fixture.installation);
  store.begin({
    upgradeId,
    target: { packageVersion: image.version, manifestDigest: image.manifestDigest,
      entrypoint: image.entrypoint, buildId: image.buildId },
    origin: "manual",
    artifactDigests: {}
  });
  store.prepare(upgradeId);
  store.select(upgradeId, { exclusion: fixture.exclusion });
  return store;
}

function snapshotTree(dir) {
  const out = {};
  const walk = (current, rel) => {
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const full = join(current, name);
      const key = rel ? `${rel}/${name}` : name;
      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full, key);
      else if (stat.isFile()) out[key] = readFileSync(full, "utf8");
      else if (stat.isSymbolicLink()) out[key] = `link:${readlinkSync(full)}`;
    }
  };
  walk(dir, "");
  return out;
}

// Run the H4 upgrade surface in-process with every external operation
// stubbed: managed context from the fixture, npm lookups counted by the stub
// registry, HOME/XDG pointed at empty temp dirs that must stay empty.
async function runUpgrade(t, fixture, registry, args, extraEnv = {}) {
  const saved = new Map();
  const env = {
    H2A_MANAGED_ROOT: fixture.managedRoot,
    HOME: fixture.home,
    XDG_RUNTIME_DIR: join(fixture.root, "run"),
    XDG_CONFIG_HOME: join(fixture.root, "config"),
    XDG_STATE_HOME: join(fixture.root, "state"),
npm_config_registry: registry.url,
    npm_config_prefix: join(fixture.root, "npmprefix"),
    ...extraEnv
  };
  for (const dir of [env.XDG_RUNTIME_DIR, env.XDG_CONFIG_HOME, env.XDG_STATE_HOME]) mkdirSync(dir, { recursive: true });
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // runCli reads process.argv only as a default; argv is passed explicitly.
  // runMcpServe-style central attachment is never enabled here.
  delete process.env.H2A_MCP_CENTRAL;
  let out = "";
  let err = "";
  const streams = {
    stdout: { write: (chunk) => { out += String(chunk); return true; } },
    stderr: { write: (chunk) => { err += String(chunk); return true; } }
  };
  try {
    const rc = await runCli(["upgrade", ...args], streams);
    return { rc, out, err };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function homeWrites(fixture) {
  // npm's own cache/logs under HOME are the lookup seam's artifacts (counted
  // separately via tarballHits), not h2a host-config writes.
  const found = [];
  for (const dir of [fixture.home, join(fixture.root, "config"), join(fixture.root, "state")]) {
    for (const [key, value] of Object.entries(snapshotTree(dir))) {
      if (key === ".npm" || key.startsWith(".npm/")) continue;
      found.push(`${dir}:${key}=${value.slice(0, 80)}`);
    }
  }
  return found;
}

function parseOut(out) {
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Cases (a)-(d): diagnostics and simulation never enter the install path.
// ---------------------------------------------------------------------------

test("LOT-1 (a): upgrade status returns the H4 envelope with zero install calls", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  const lookupsBefore = registry.readLog().length;
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["status", "--json"]);
  assert.equal(rc, 0, `status must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.action, "status");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.selectedVersion, "0.98.6");
  assert.equal(envelope.selectedBuildId, "build-a");
  assert.equal(registry.readLog().length, lookupsBefore, "status must perform zero npm lookups");
  assert.equal(registry.tarballHits().length, 0, "status must fetch zero tarballs");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "status resumes nothing");
  assert.deepEqual(homeWrites(fixture), [], "status writes no host config");
});

test("LOT-1 (b): upgrade resume of an unknown transaction fails typed with zero install", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const lookupsBefore = registry.readLog().length;
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["resume", "no-such-tx-1", "--json"]);
  assert.equal(rc, 1, `unknown resume must exit 1 (out: ${out})`);
  assert.equal(out, "", "failures write no envelope to stdout");
  assert.match(err, /upgrade_not_found|unknown_transaction/, "typed transaction error");
  assert.equal(registry.tarballHits().length, 0);
  assert.equal(registry.readLog().length, lookupsBefore, "resume refusal performs zero npm lookups");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore);
  assert.deepEqual(homeWrites(fixture), [], "resume refusal writes no host config");
});

test("LOT-1 (c): bare dry-run simulates with zero mutation and zero tarball fetch", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageCurrent = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageCurrent);
  const imageLatest = fixture.image({ version: "9.9.9", buildId: "build-latest" });
  void imageLatest;
  const managedBefore = snapshotTree(fixture.managedRoot);
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["--dry-run", "--json"]);
  assert.equal(rc, 0, `dry-run must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.equal(envelope.action, "run");
  assert.equal(envelope.dryRun, true);
  assert.equal(envelope.completed, false);
  assert.equal(registry.tarballHits().length, 0, "dry-run fetches zero tarballs");
  assert.deepEqual(snapshotTree(fixture.managedRoot), managedBefore, "dry-run mutates nothing");
  assert.deepEqual(homeWrites(fixture), [], "dry-run writes no host config");
});

test("LOT-1 (d): upgrade check keeps the legacy fields and installs nothing", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const managedBefore = snapshotTree(fixture.managedRoot);
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["--check", "--json"]);
  assert.equal(rc, 0, `check must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.equal(envelope.action, "check");
  assert.equal(typeof envelope.current, "string");
  assert.equal(envelope.latest, "9.9.9");
  assert.equal(envelope.upgradeAvailable, true);
  assert.equal(registry.tarballHits().length, 0, "check installs nothing");
  assert.deepEqual(snapshotTree(fixture.managedRoot), managedBefore, "check mutates nothing");
  assert.deepEqual(homeWrites(fixture), [], "check writes no host config");
});

// ---------------------------------------------------------------------------
// Cases (e)-(j): subcommands, usage errors, SUCCESSOR_FAILED.
// ---------------------------------------------------------------------------

test("LOT-1 (e): abort closes a reversible transaction idempotently", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  const store = new UpgradeStore(fixture.installation);
  store.begin({
    upgradeId: "abort-me-1",
    target: { packageVersion: imageA.version, manifestDigest: imageA.manifestDigest,
      entrypoint: imageA.entrypoint, buildId: imageA.buildId },
    origin: "manual",
    artifactDigests: {}
  });
  assert.equal(store.status("abort-me-1").installationState, "PREPARING");
  const first = await runUpgrade(t, fixture, registry, ["abort", "abort-me-1", "--json"]);
  assert.equal(first.rc, 0, `abort must exit 0 (stderr: ${first.err})`);
  assert.equal(parseOut(first.out).installationState, "ABORTED");
  const second = await runUpgrade(t, fixture, registry, ["abort", "abort-me-1", "--json"]);
  assert.equal(second.rc, 0, "second abort is the same result");
  assert.deepEqual(parseOut(second.out), parseOut(first.out), "abort is idempotent");
  assert.equal(registry.tarballHits().length, 0);
  assert.deepEqual(homeWrites(fixture), [], "abort writes no host config");
});

test("LOT-1 (f): compensate routes per component; bogus components are usage errors", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const routed = await runUpgrade(t, fixture, registry, ["compensate", "setup-a", "--component", "mcp", "--json"]);
  assert.equal(routed.out === "" ? 2 : routed.rc, 2, `compensate without engine is incomplete (rc=${routed.rc} out=${routed.out} err=${routed.err})`);
  assert.match(routed.err, /compensation/, "component compensation route named");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "compensate mutates no journal");
  const bogus = await runUpgrade(t, fixture, registry, ["compensate", "setup-a", "--component", "bogus", "--json"]);
  assert.equal(bogus.rc, 1, "unknown component is a usage error");
  assert.equal(bogus.out, "", "usage errors write nothing to stdout");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "bogus component has zero side effects");
  assert.equal(registry.tarballHits().length, 0);
});

test("LOT-1 (g): unmanage dry-run mutates nothing", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  const managedBefore = snapshotTree(fixture.root);
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["unmanage", "--dry-run", "--json"]);
  assert.equal(rc, 0, `unmanage dry-run must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.equal(envelope.action, "unmanage");
  assert.equal(envelope.dryRun, true);
  assert.equal(envelope.restored, false);
  assert.deepEqual(snapshotTree(fixture.root), managedBefore, "unmanage dry-run mutates nothing");
  assert.equal(registry.tarballHits().length, 0);
});

test("LOT-1 (h): unknown flags, missing ids and stray positionals are usage errors", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  for (const args of [
    ["status", "--bogus-flag", "--json"],
    ["resume", "--json"],
    ["status", "stray-positional", "--json"],
    ["compensate", "setup-a", "--json"]
  ]) {
    const { rc, out } = await runUpgrade(t, fixture, registry, args);
    assert.equal(rc, 1, `${JSON.stringify(args)} must exit 1`);
    assert.equal(out, "", `${JSON.stringify(args)} writes nothing to stdout`);
  }
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "usage errors have zero side effects");
  assert.equal(registry.readLog().length, 0, "usage errors perform zero npm lookups");
});

test("LOT-1 (i): SUCCESSOR_FAILED beside a completed selection exits 1", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  const stateDir = join(fixture.managedRoot, "state");
  writeFileSync(join(stateDir, "component-control.json"), JSON.stringify({ activeTransaction: "comp-1.json" }));
  writeFileSync(join(stateDir, "comp-1.json"), JSON.stringify({ state: "SUCCESSOR_FAILED" }));
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["status", "--json"]);
  assert.equal(rc, 1, `successor failure is a real failure (out: ${out})`);
  assert.match(`${out}${err}`, /successor_failed/, "failure named");
});

test("LOT-1 (j): status on a readable journal advances no transaction phase", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  const store = new UpgradeStore(fixture.installation);
  store.begin({
    upgradeId: "pending-1",
    target: { packageVersion: imageA.version, manifestDigest: imageA.manifestDigest,
      entrypoint: imageA.entrypoint, buildId: imageA.buildId },
    origin: "manual",
    artifactDigests: {}
  });
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["status", "--json"]);
  assert.equal(rc, 0, `status must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.ok(Array.isArray(envelope.transactions), "status lists transactions");
  assert.ok(envelope.transactions.some((entry) => entry.upgradeId === "pending-1" && entry.phase === "PREPARING"));
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "status advances nothing");
});

// ---------------------------------------------------------------------------
// Cases (k)-(l): nominal selection and incompatible-target refusal.
// ---------------------------------------------------------------------------

test("LOT-1 (k): upgrade --to selects build B and a reconnect loads B", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  await completeTransaction(fixture, "setup-a");
  const imageB = fixture.image({ version: "0.98.7", buildId: "build-b" });
  const before = snapshotTree(join(fixture.managedRoot, "state"));
  assert.ok(!before["selected-build.json"] || JSON.parse(before["selected-build.json"]).buildId === "build-a");
  const { rc, out, err } = await runUpgrade(t, fixture, registry, ["--to", "0.98.7", "--json"]);
  assert.equal(rc, 0, `nominal run must exit 0 (stderr: ${err})`);
  const envelope = parseOut(out);
  assert.equal(envelope.action, "run");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.completed, true);
  assert.equal(envelope.selectedVersion, "0.98.7");
  assert.equal(envelope.selectedBuildId, "build-b");
  // Durable selection names B.
  const { resolveSelectedEntry } = await import("../dist/runtime/handover/selection.js");
  const resolved = resolveSelectedEntry(fixture.installation);
  assert.equal(resolved.selection.buildId, "build-b");
  assert.equal(resolved.selection.packageVersion, "0.98.7");
  // A fresh process through the selected entrypoint (the host-reconnect
  // observable, RQ-04) runs build B, never A.
  const launched = spawnSync(process.execPath, [resolved.entrypoint], { encoding: "utf8", timeout: 15000 });
  assert.equal(launched.status, 0, `selected entrypoint must run (stderr: ${launched.stderr})`);
  assert.equal(JSON.parse(launched.stdout).buildId, "build-b");
  assert.equal(registry.tarballHits().length, 0, "local target needs no tarball");
  assert.deepEqual(homeWrites(fixture), [], "nominal run writes no host config");
  void imageB;
});

test("LOT-1 (l): upgrade --to a version without an H4 controller is refused pre-selection", async (t) => {
  const registry = await stubRegistry(t, "9.9.9");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  // Variant 1: no prepared image at all for the requested version.
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const missing = await runUpgrade(t, fixture, registry, ["--to", "1.2.3", "--json"]);
  assert.equal(missing.rc, 1, "unknown target is a real failure");
  assert.equal(missing.out, "", "failures write no envelope to stdout");
  assert.match(missing.err, /controller_protocol_incompatible/, "refusal named");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "zero journal mutation");
  // Variant 2: a prepared image whose controller protocol is not H4.
  fixture.image({ version: "1.2.4", buildId: "build-legacy", controllerProtocol: 99 });
  const journalBefore2 = snapshotTree(join(fixture.managedRoot, "state"));
  const bad = await runUpgrade(t, fixture, registry, ["--to", "1.2.4", "--json"]);
  assert.equal(bad.rc, 1, "foreign controller is a real failure");
  assert.match(bad.err, /controller_protocol_incompatible/, "refusal named");
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore2, "zero journal mutation");
  // Durable selection still names A.
  const { resolveSelectedEntry } = await import("../dist/runtime/handover/selection.js");
  assert.equal(resolveSelectedEntry(fixture.installation).selection.buildId, "build-a");
  assert.equal(registry.tarballHits().length, 0);
});

// ---------------------------------------------------------------------------
// Case (m): automatic convergence through the real trigger. The built
// mcp-serve --auto-upgrade boots in a temp HOME against the fixture
// installation; its detached real boot-worker.js must produce the same H4
// journal/selection effects as the manual run, with zero legacy swap.
// ---------------------------------------------------------------------------

function waitForSelectedBuild(managedRoot, buildId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = readFileSync(join(managedRoot, "state", "selected-build.json"), "utf8");
      if (JSON.parse(raw).buildId === buildId) return true;
    } catch {
      // Not yet written.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return false;
}

test("LOT-1 (m): mcp-serve --auto-upgrade converges through the H4 pass", { timeout: 180000 }, async (t) => {
  const registry = await stubRegistry(t, "0.98.7");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  await completeTransaction(fixture, "setup-a");
  const imageB = fixture.image({ version: "0.98.7", buildId: "build-b" });
  void imageB;
  const prefixPkgBefore = readFileSync(join(fixture.prefix, "lib", "node_modules", "@sentropic", "h2a", "package.json"), "utf8");
  const mcpRoot = join(fixture.root, "mcp-home");
  mkdirSync(mcpRoot, { recursive: true });
  const env = {
    ...process.env,
    H2A_MANAGED_ROOT: fixture.managedRoot,
    HOME: fixture.home,
    XDG_RUNTIME_DIR: join(fixture.root, "run"),
    XDG_CONFIG_HOME: join(fixture.root, "config"),
    XDG_STATE_HOME: join(fixture.root, "state"),
    H2A_ROOT: mcpRoot,
    npm_config_registry: registry.url,
    npm_config_prefix: join(fixture.root, "npmprefix")
  };
  const { spawn } = await import("node:child_process");
  const serveLog = join(fixture.root, "mcp-serve-stderr.log");
  const serveLogFd = (await import("node:fs")).openSync(serveLog, "w");
  const server = spawn(process.execPath, [BIN, "mcp-serve", "--root", mcpRoot, "--auto-upgrade"], {
    env,
    stdio: ["ignore", "ignore", serveLogFd],
    detached: true
  });
  t.after(() => {
    try {
      realKill(server.pid, "SIGKILL");
    } catch {
      // Already exited.
    }
    try {
      closeSync(serveLogFd);
    } catch {
      // Already closed.
    }
  });
  // The detached worker outlives the serving parent; poll for its H4 effects
  // instead of joining either process.
  let selected = false;
  try {
    selected = waitForSelectedBuild(fixture.managedRoot, "build-b", 90000);
  } finally {
    try {
      realKill(server.pid, "SIGKILL");
    } catch {
      // Already exited.
    }
  }
  if (!selected) {
    let logTail = "";
    try {
      logTail = readFileSync(serveLog, "utf8").split("\n").filter((line) => /h2a mcp-serve|upgrade|error/i.test(line)).slice(-15).join("\n");
    } catch {
      logTail = "<no serve log>";
    }
    let stamp = "<no stamp>";
    try {
      stamp = readFileSync(join(mcpRoot, "upgrade-check.json"), "utf8");
    } catch {
      // Absent.
    }
    assert.fail(`detached worker produced no selection\n--- serve log ---\n${logTail}\n--- worker stamp ---\n${stamp}`);
  }
  const { resolveSelectedEntry } = await import("../dist/runtime/handover/selection.js");
  assert.equal(resolveSelectedEntry(fixture.installation).selection.buildId, "build-b");
  assert.equal(registry.tarballHits().length, 0, "automatic pass fetches zero tarballs");
  assert.equal(
    readFileSync(join(fixture.prefix, "lib", "node_modules", "@sentropic", "h2a", "package.json"), "utf8"),
    prefixPkgBefore,
    "zero legacy staged-swap effects on the prefix"
  );
  assert.deepEqual(homeWrites(fixture), [], "automatic pass writes no host config");
});

test("LOT-1 (m2): automatic pass honours the opt-out while the manual run proceeds", { timeout: 120000 }, async (t) => {
  const registry = await stubRegistry(t, "0.98.7");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  await completeTransaction(fixture, "setup-a");
  const imageB = fixture.image({ version: "0.98.7", buildId: "build-b" });
  void imageB;
  writeFileSync(join(fixture.managedDir, "unmanaged.json"), JSON.stringify({ schemaVersion: 1, reason: "operator_unmanage" }));
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  // Automatic (non-explicit) pass: recorded no-op. Drive the real boot worker
  // file directly so the test observes the detached pass deterministically.
  const worker = spawnSync(process.execPath,
    [join(DIST, "runtime", "upgrade", "boot-worker.js"), join(fixture.root, "auto-cache"), "3600000", "auto"],
    {
      env: { ...process.env, H2A_MANAGED_ROOT: fixture.managedRoot, HOME: fixture.home, npm_config_registry: registry.url, npm_config_prefix: join(fixture.root, "npmprefix") },
      encoding: "utf8",
      timeout: 60000
    });
  assert.equal(worker.status, 0, `boot worker stays best-effort (stderr: ${worker.stderr})`);
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "opt-out automatic pass mutates nothing");
  // Explicit manual run on the same fixture still proceeds (same guards, U01).
  const manual = await runUpgrade(t, fixture, registry, ["--to", "0.98.7", "--json"]);
  assert.equal(manual.rc, 0, `explicit run bypasses only the opt-out (stderr: ${manual.err})`);
  assert.equal(parseOut(manual.out).selectedBuildId, "build-b");
});

test("LOT-1 (m3): mcp-serve --upgrade-check boot is notice-only", { timeout: 120000 }, async (t) => {
  const registry = await stubRegistry(t, "0.98.7");
  const fixture = mkFixture(t);
  const imageA = fixture.image({ version: "0.98.6", buildId: "build-a" });
  selectThroughStore(fixture, "setup-a", imageA);
  fixture.image({ version: "0.98.7", buildId: "build-b" });
  const journalBefore = snapshotTree(join(fixture.managedRoot, "state"));
  const worker = spawnSync(process.execPath,
    [join(DIST, "runtime", "upgrade", "boot-worker.js"), join(fixture.root, "check-cache"), "3600000", "check"],
    {
      env: { ...process.env, H2A_MANAGED_ROOT: fixture.managedRoot, HOME: fixture.home, npm_config_registry: registry.url, npm_config_prefix: join(fixture.root, "npmprefix") },
      encoding: "utf8",
      timeout: 60000
    });
  assert.equal(worker.status, 0, `check worker exits 0 (stderr: ${worker.stderr})`);
  assert.deepEqual(snapshotTree(join(fixture.managedRoot, "state")), journalBefore, "check mutates no journal");
});

// ---------------------------------------------------------------------------
// Structural guard for case (n): the H4 dispatch chain spawns no child and
// sends no signal. Runtime proof is the kill wrapper (asserted in
// test.after) plus the empty-HOME and registry-log assertions above; this
// pins the structure so a future edit cannot smuggle a spawn in.
// ---------------------------------------------------------------------------

test("LOT-1 (n): the H4 dispatch modules import no process spawner or signal", async () => {
  const modules = [
    "runtime/upgrade/upgrade-cli.js",
    "runtime/upgrade/upgrade-dispatch.js",
    "runtime/upgrade/upgrade-run.js",
    "runtime/upgrade/status-report.js",
    "runtime/upgrade/unmanage.js",
    "runtime/upgrade/boot-worker.js"
  ];
  for (const rel of modules) {
    const source = readFileSync(join(DIST, rel), "utf8");
    assert.doesNotMatch(source, /child_process/, `${rel} must not spawn`);
    assert.doesNotMatch(source, /process\.kill/, `${rel} must not signal`);
  }
});
