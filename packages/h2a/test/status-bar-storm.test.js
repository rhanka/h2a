import assert from "node:assert/strict";
import test from "node:test";

import {
  installH2aStatusSurfaceWithAccess,
} from "../../h2a-runtime/dist/tmux.js";

// Regression guard for the 2026-07-31 status-bar spawn storm: tmux re-runs
// every #(...) command in status-left/status-right once per status-interval
// for EVERY session, so a bar that embeds `#(h2a status ...)` starts a full
// node process per session per refresh (~16/s at 40 sessions). The installed
// bar must never start a process per refresh: its only #(...) commands must be
// bounded file reads produced by the single background writer.

function fakeAccess() {
  const store = new Map([
    ["status", "on"],
    ["status-left", "[prev] "],
    ["status-right", "%H:%M"],
    ["status-interval", "1"],
    ["status-left-length", "10"],
    ["status-right-length", "40"],
  ]);
  return {
    store,
    access: {
      read: (_session, option) => store.get(option) ?? "",
      set: (_session, option, value) => {
        store.set(option, value);
        return true;
      },
      unset: (_session, option) => {
        store.delete(option);
        return true;
      },
    },
  };
}

test("installed status surface never starts h2a per refresh", () => {
  const { store, access } = fakeAccess();
  assert.equal(installH2aStatusSurfaceWithAccess("h2a-worker", access), true);
  for (const option of ["status-left", "status-right"]) {
    const value = store.get(option) ?? "";
    assert.ok(
      !value.includes("#(h2a"),
      `${option} must not spawn h2a per refresh, got: ${value}`,
    );
  }
});

test("every per-refresh command in the installed bar is a bounded file read", () => {
  const { store, access } = fakeAccess();
  assert.equal(installH2aStatusSurfaceWithAccess("h2a-worker", access), true);
  let commands = 0;
  for (const option of ["status-left", "status-right"]) {
    const value = store.get(option) ?? "";
    for (const [, command] of value.matchAll(/#\(([^)]*)\)/g)) {
      commands += 1;
      assert.match(
        command,
        /^cat /,
        `${option} may only read a prepared file per refresh, got: ${command}`,
      );
    }
  }
  assert.ok(commands > 0, "the truthful bar still reads live segments");
});
