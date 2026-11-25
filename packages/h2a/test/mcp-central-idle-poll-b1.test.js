import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs, { chmodSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveMutationFlock, writerDirectory } from "../dist/runtime/handover/mutation.js";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { publishState, readState, replaceState } from "../dist/runtime/handover/state.js";

function fixture(t) {
  const base = tmpdir();
  const dir = mkdtempSync(join(base, "b1-idle-poll-"));
  chmodSync(dir, 0o700);
  const root = join(dir, "store");
  const runtimeBase = join(dir, "run");
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  let sweep;
  const clock = {
    now: () => Date.now(),
    setInterval(fn) { sweep = fn; return 1; },
    clearInterval() { sweep = undefined; },
  };
  let central;
  t.after(async () => {
    try { await central?.stop(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir, root, runtimeBase,
    async tick() { if (sweep) await sweep(); },
    async start(override = {}) {
      central = await startCentralMcpServer({
        root, runtimeBase, physicalPrefix: dir, env: {}, clock,
        idleTimeoutMs: 200, sessionLeaseMs: 90_000, ...override,
      });
      assert.equal(central.kind, "started");
      return central;
    },
    get central() { return central; },
  };
}

test("B-1: operator pause on disk without /stop commits in <= 2 ticks on idle central", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start();
  const marker = readState(central.markerPath, "marker").value;
  const stateDir = marker.stateDirectory;
  // Operator pause written directly on disk (as `h2a central stop` does
  // before its HTTP call): no session, no transaction, revision clean.
  publishState(join(stateDir, "operator-stop.json"),
    { schemaVersion: 1, revision: 1, paused: true, requestedAt: Date.now(), generation: marker.generation }, "pause");
  await f.tick();
  await f.tick();
  // Give the async requestStop -> stopServer a turn.
  await new Promise((r) => setTimeout(r, 200));
  const control = readState(join(stateDir, "component-control.json"), "componentControl").value;
  assert.equal(control.operatorStopCommitted, true, "idle poll must commit operator stop (B-1)");
});

test("NB-5: supervised central resyncs an externally dirtied revision stamp", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 0 });
  const owner = central.__test.participants();
  const marker = readState(central.markerPath, "marker").value;
  const revPath = join(marker.stateDirectory, "participant-revision.json");
  const prevRev = readState(revPath, "participantRevision");
  replaceState(revPath, { schemaVersion: 1, revision: prevRev.value.revision + 1 }, "participantRevision", prevRev);
  await f.tick();
  await f.tick();
  assert.equal(owner.registry.isRevisionClean(), true, "supervised sweep must resync an external revision write (NB-5)");
});

test("B-1: indeterminate on idle central reconciles in <= 2 ticks, admissions reopen", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start();
  const admin = central.__test.administration();
  const owner = central.__test.participants();
  assert.ok(admin, "test hook exposes administration");
  assert.ok(owner, "test hook exposes participants");
  // Raise indeterminate on an idle central (no session, revision clean):
  // admissions must close until poll reconciles.
  admin.indeterminate = true;
  owner.registry.indeterminate = true;
  await f.tick();
  await f.tick();
  assert.equal(admin.indeterminate, false, "idle poll must reconcile admin indeterminate (B-1)");
  assert.equal(owner.registry.indeterminate, false, "idle poll must reconcile registry indeterminate (B-1)");
  const open = await admin.admissionsOpenAsync({ nonBlocking: true });
  assert.equal(open, true, "admissions must reopen after reconcile (B-1)");
});

async function holdPresenceLockInChild(lockPath) {
  const flockTool = resolveMutationFlock();
  mkdirSync(join(lockPath, ".."), { recursive: true, mode: 0o700 });
  const fd = openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  const child = spawn(flockTool, [
    "--exclusive", "--no-fork", lockPath, process.execPath, "-e",
    "process.stdout.write('locked'); process.stdin.resume();"
  ], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = once(child, "exit");
  await Promise.race([
    once(child.stdout, "data"),
    exited.then(() => assert.fail(`flock holder exited before acquiring ${lockPath}`)),
  ]);
  return {
    child,
    async release() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin.end();
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 2_500))]);
      clearTimeout(killTimer);
    },
  };
}

test("NB-4 option A: retirement final tick probes .presence.lock, resets quietTicks while held, and retires after release", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 200, sessionLeaseMs: 90_000 });
  const wdir = writerDirectory(f.root);
  const presLock = join(wdir, ".presence.lock");
  const owner = central.__test.participants();
  const origWithLockAsync = owner.registry.withLockAsync.bind(owner.registry);
  const lockOptsSeen = [];
  owner.registry.withLockAsync = (fn, opts) => {
    lockOptsSeen.push(Boolean(opts?.bothLocks));
    return origWithLockAsync(fn, opts);
  };

  let closedResolved = false;
  void central.closed.then(() => { closedResolved = true; });

  const holder = await holdPresenceLockInChild(presLock);
  t.after(() => holder.release());
  try {
    // 1. Run 12 ticks (2+ full quiet cycles) while .presence.lock is held.
    // Early ticks only probe .mutation.lock (bothLocks=false); the 5th tick probes bothLocks=true,
    // sees .presence.lock held, resets quietTicks = 0, and keeps the server open.
    for (let i = 0; i < 12; i++) {
      await f.tick();
      assert.equal(closedResolved, false, `tick ${i + 1}: central must stay open while .presence.lock is held`);
    }
    assert.deepEqual(lockOptsSeen.slice(0, 10), [
      false, false, false, false, true,
      false, false, false, false, true,
    ], "only the final tick of each cycle may probe bothLocks (.presence.lock)");
    const ping = await fetch(new URL("/_h2a-central/ping", central.endpoint));
    assert.equal(ping.status, 200, "central still serves ping while .presence.lock contention prevents retirement");
  } finally {
    await holder.release();
  }

  // Wait a tick for OS fd release/exit settlement, then run one full cycle of 5 quiet ticks to retire.
  for (let i = 0; i < 4; i++) {
    await f.tick();
    assert.equal(closedResolved, false, `post-release early tick ${i + 1} must complete full cycle before retiring`);
  }
  await f.tick();
  await Promise.race([
    central.closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("central failed to retire after .presence.lock release")), 3_000)),
  ]);
  assert.equal(closedResolved, true);
});

test("NB-4 option A: supervised mode (idleTimeoutMs 0) is unchanged by retirement .presence.lock probe", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
  const owner = central.__test.participants();
  const withLockAsync = owner.registry.withLockAsync.bind(owner.registry);
  let probeCalls = 0;
  owner.registry.withLockAsync = (fn, opts) => {
    probeCalls++;
    return withLockAsync(fn, opts);
  };
  for (let i = 0; i < 6; i++) await f.tick();
  assert.equal(probeCalls, 0, "supervised central must never run the retirement quiet probe");
});
