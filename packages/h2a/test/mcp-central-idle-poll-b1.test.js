import assert from "node:assert/strict";
import fs, { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
