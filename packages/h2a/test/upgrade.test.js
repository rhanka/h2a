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
  upgradeCachePath,
  canReexec,
  reexecSelf,
  H2A_AUTO_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  H2A_UPGRADE_CHECK_TTL_MS
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

test("auto-upgrade TTL is short (1h) and well under the 24h notice TTL", () => {
  assert.equal(H2A_AUTO_UPGRADE_CHECK_TTL_MS, 60 * 60 * 1000);
  assert.ok(H2A_AUTO_UPGRADE_CHECK_TTL_MS < H2A_UPGRADE_CHECK_TTL_MS);
});

test("--auto-upgrade is not masked by the 24h notice cache (the 0.39.0-stuck bug)", () => {
  const HOUR = 3_600_000;
  const now = 100_000_000_000;
  // exactly the observed state: cache written 16.4h ago saying 0.39.0 is latest
  const cache = { checkedAt: now - Math.round(16.4 * HOUR), latest: "0.39.0" };

  // 24h notice TTL: the 16.4h cache is still "fresh" → stale 0.39.0 returned, no
  // upgrade seen, no network. This is the masking that left agents on 0.39.0.
  const notice = fakeRuntime({ now, cache, latest: "0.41.0" });
  const r24 = checkUpgrade("0.39.0", {
    runtime: notice.runtime,
    cachePath: "/x",
    ttlMs: H2A_UPGRADE_CHECK_TTL_MS
  });
  assert.equal(r24.fromCache, true);
  assert.equal(r24.upgradeAvailable, false);
  assert.equal(notice.calls.fetch, 0);

  // 1h auto-upgrade TTL: the 16.4h cache is stale → re-fetch → sees 0.41.0.
  const auto = fakeRuntime({ now, cache, latest: "0.41.0" });
  const r1 = checkUpgrade("0.39.0", {
    runtime: auto.runtime,
    cachePath: "/x",
    ttlMs: H2A_AUTO_UPGRADE_CHECK_TTL_MS
  });
  assert.equal(r1.fromCache, false);
  assert.equal(r1.latest, "0.41.0");
  assert.equal(r1.upgradeAvailable, true);
  assert.equal(auto.calls.fetch, 1);
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

test("reexecSelf calls execve with the same binary+args and the guard env set", () => {
  let captured;
  // Use the real node path so the existsSync guard passes; fake execve records.
  const ok = reexecSelf({
    execve: (file, args, env) => {
      captured = { file, args, env };
      return undefined; // a real execve never returns; the fake just records
    },
    execPath: process.execPath,
    argv: ["/path/bin.js", "mcp-serve", "--auto-upgrade"],
    env: { PATH: "/x" }
  });
  assert.equal(ok, true);
  assert.equal(captured.file, process.execPath);
  assert.deepEqual(captured.args, [process.execPath, "/path/bin.js", "mcp-serve", "--auto-upgrade"]);
  assert.equal(captured.env[H2A_REEXEC_GUARD_ENV], "1", "guard env must be set to break re-exec loops");
});

test("reexecSelf returns false (no native crash) when the target binary is missing", () => {
  // A non-existent execPath must be refused BEFORE calling execve — a failing
  // process.execve aborts natively, so the existsSync guard is load-bearing.
  let called = false;
  assert.equal(
    reexecSelf({ execve: () => { called = true; }, execPath: "/no/such/binary-xyz", argv: [] }),
    false
  );
  assert.equal(called, false, "execve must not be called for a missing target");
});

test("reexecSelf returns false when execve throws (catchable)", () => {
  assert.equal(
    reexecSelf({ execve: () => { throw new Error("ENOSYS"); }, execPath: process.execPath, argv: [] }),
    false
  );
});

test("canReexec reflects process.execve availability (true on this Node 24)", () => {
  assert.equal(canReexec(), typeof process.execve === "function");
});
