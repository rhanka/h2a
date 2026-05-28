import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cmdUpgrade,
  checkUpgrade,
  isNewerVersion,
  performUpgrade,
  upgradeCachePath
} from "../dist/index.js";

function fakeRuntime(overrides = {}) {
  const calls = { fetch: 0, install: 0 };
  return {
    calls,
    runtime: {
      fetchLatest: () => {
        calls.fetch++;
        // Default far-future version so "upgrade available" holds regardless of
        // the package.json version the test runs against (CI runs at the bumped
        // version, which once equalled the old hard-coded "0.16.0" fixture).
        return overrides.latest ?? "999.0.0";
      },
      runInstall: () => {
        calls.install++;
        return overrides.installOk ?? true;
      },
      now: () => overrides.now ?? 1_000_000,
      readCache: () => overrides.cache,
      writeCache: (_p, e) => {
        calls.written = e;
      },
      ...overrides.runtime
    }
  };
}

test("isNewerVersion compares strict X.Y.Z", () => {
  assert.equal(isNewerVersion("0.16.0", "0.15.0"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerVersion("0.15.0", "0.15.0"), false);
  assert.equal(isNewerVersion("0.14.9", "0.15.0"), false);
  assert.equal(isNewerVersion("garbage", "0.15.0"), false);
});

test("checkUpgrade (force) hits the network and flags an available upgrade", () => {
  const { runtime, calls } = fakeRuntime({ latest: "0.16.0" });
  const r = checkUpgrade("0.15.0", { runtime, force: true });
  assert.deepEqual(
    { current: r.current, latest: r.latest, upgradeAvailable: r.upgradeAvailable, fromCache: r.fromCache },
    { current: "0.15.0", latest: "0.16.0", upgradeAvailable: true, fromCache: false }
  );
  assert.equal(calls.fetch, 1);
});

test("checkUpgrade uses a fresh cache (no network) and writes the cache when stale", () => {
  // fresh cache → no fetch
  const fresh = fakeRuntime({ now: 1_000_000, cache: { checkedAt: 999_000, latest: "0.16.0" } });
  const r1 = checkUpgrade("0.15.0", { runtime: fresh.runtime, cachePath: "/x", ttlMs: 10_000 });
  assert.equal(r1.fromCache, true);
  assert.equal(r1.upgradeAvailable, true);
  assert.equal(fresh.calls.fetch, 0);

  // stale cache → fetch + rewrite
  const stale = fakeRuntime({ now: 1_000_000, cache: { checkedAt: 1, latest: "0.15.0" }, latest: "0.16.0" });
  const r2 = checkUpgrade("0.15.0", { runtime: stale.runtime, cachePath: "/x", ttlMs: 10_000 });
  assert.equal(r2.fromCache, false);
  assert.equal(stale.calls.fetch, 1);
  assert.equal(stale.calls.written.latest, "0.16.0");
});

test("checkUpgrade never throws on registry failure", () => {
  const r = checkUpgrade("0.15.0", { runtime: { fetchLatest: () => undefined, runInstall: () => false, now: () => 0, readCache: () => undefined, writeCache: () => {} }, force: true });
  assert.equal(r.upgradeAvailable, false);
  assert.equal(r.latest, undefined);
});

test("performUpgrade delegates to runInstall", () => {
  const { runtime, calls } = fakeRuntime({ installOk: true });
  assert.equal(performUpgrade(runtime), true);
  assert.equal(calls.install, 1);
});

test("cmdUpgrade --check reports without installing", () => {
  const { runtime, calls } = fakeRuntime(); // default latest 999.0.0 → always newer
  let out = "";
  const rc = cmdUpgrade({ check: "true" }, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.install, 0, "--check must not install");
  assert.match(out, /"upgradeAvailable": true/);
});

test("cmdUpgrade (bare) installs when an upgrade is available", () => {
  const { runtime, calls } = fakeRuntime({ installOk: true }); // default latest 999.0.0
  let out = "";
  const rc = cmdUpgrade({}, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.install, 1);
  assert.match(out, /"upgraded": true/);
});

test("cmdUpgrade (bare) does not install when already current", () => {
  // latest equals whatever current is → no upgrade; fake latest lower than any real current is risky,
  // so force latest very low to guarantee not-newer.
  const { runtime, calls } = fakeRuntime({ latest: "0.0.1" });
  let out = "";
  const rc = cmdUpgrade({}, { stdout: { write: (c) => void (out += c) }, stderr: { write: () => {} } }, runtime);
  assert.equal(rc, 0);
  assert.equal(calls.install, 0);
  assert.match(out, /"upgraded": false/);
});

test("upgradeCachePath is under the root", () => {
  assert.equal(upgradeCachePath("/r/.h2a"), join("/r/.h2a", "upgrade-check.json"));
});
