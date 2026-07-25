import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIRROR_PUSH_OFF_ENV,
  MIN_MIRROR_PUSH_INTERVAL_MS
} from "../dist/index.js";

// Feed-contract P1 step 4a — the shipped systemd unit is DISARMED BY DEFAULT, and
// that is a load-bearing safety property, not a documentation detail: it is the
// reason enabling the unit cannot start pushing to hosted infra on its own.
//
// A property with no gate is not a property. These tests are that gate: they fail
// if a future edit deletes the kill-switch line, drops
// RestartPreventExitStatus=1, fills the placeholders with something real, or
// switches back to Restart=always (which would make the disarmed state a
// perpetual 30s restart loop).

// Resolved from THIS FILE, not from process.cwd(): the gate that protects the
// "nothing auto-pushes" property must not be the one that dies with ENOENT when
// the suite is run from packages/h2a instead of the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UNIT_PATH = join(REPO_ROOT, "contrib/systemd/h2a-mirror-push.service");
const README_PATH = join(REPO_ROOT, "contrib/systemd/README.md");

function unit() {
  return readFileSync(UNIT_PATH, "utf8");
}

test("the shipped unit is DISARMED: the kill-switch line is active, not commented", () => {
  const text = unit();
  const lines = text.split("\n").map((l) => l.trim());
  const armed = lines.filter((l) => l.startsWith(`Environment=${MIRROR_PUSH_OFF_ENV}=`));
  assert.equal(armed.length, 1, "exactly one kill-switch Environment line");
  assert.equal(
    armed[0],
    `Environment=${MIRROR_PUSH_OFF_ENV}=1`,
    "the kill-switch must ship SET (=1), so an enabled unit is a no-op until an owner removes it"
  );
});

test("the shipped unit carries RestartPreventExitStatus=1 (the auth stop must stick)", () => {
  const lines = unit().split("\n").map((l) => l.trim());
  assert.ok(
    lines.includes("RestartPreventExitStatus=1"),
    "without this, systemd turns a deliberate exit-1 stop into an endless retry"
  );
});

test("the shipped unit does NOT use Restart=always (that loops on the disarmed exit 0)", () => {
  const lines = unit().split("\n").map((l) => l.trim());
  const restart = lines.filter((l) => l.startsWith("Restart=") && !l.startsWith("RestartSec"));
  assert.deepEqual(restart, ["Restart=on-failure"], "clean exits must not be restarted");
});

test("the shipped unit's ExecStart values are all UNFILLED placeholders", () => {
  const text = unit();
  const exec = text
    .split("\n")
    .find((l) => l.startsWith("ExecStart="));
  assert.ok(exec, "the unit has an ExecStart");
  for (const flag of ["--url", "--instance", "--private-key"]) {
    assert.ok(exec.includes(flag), `ExecStart passes ${flag}`);
  }
  // Three placeholders, so a copied unit cannot accidentally point at anything
  // real — least of all a hosted endpoint.
  const placeholders = exec.match(/REPLACE_WITH_[A-Z_]+/g) ?? [];
  assert.equal(placeholders.length, 3, "all three operator values are placeholders");
  assert.ok(
    !/https?:\/\//.test(exec),
    "ExecStart must not ship a real URL — a copied unit must not be able to push anywhere"
  );
});

test("the shipped unit opts into the daemon with an interval at or above the CLI floor", () => {
  const exec = unit().split("\n").find((l) => l.startsWith("ExecStart="));
  const match = exec.match(/--interval-ms\s+(\d+)/);
  assert.ok(match, "the unit passes --interval-ms: that flag IS the opt-in");
  const interval = Number(match[1]);
  assert.ok(
    interval >= MIN_MIRROR_PUSH_INTERVAL_MS,
    `unit interval ${interval} must respect the CLI floor ${MIN_MIRROR_PUSH_INTERVAL_MS}`
  );
  // The ratified contract's own range.
  assert.ok(interval >= 15_000 && interval <= 30_000, "and stay inside the ratified 15-30s range");
});

test("the README documents the disarmed state truthfully (exit 0, inactive, not a failure)", () => {
  const readme = readFileSync(README_PATH, "utf8");
  assert.ok(readme.includes("h2a-mirror-push"), "the README covers this unit");
  assert.ok(
    readme.includes(MIRROR_PUSH_OFF_ENV),
    "the README names the kill-switch env var"
  );
  assert.ok(
    /exits 0/.test(readme),
    "the README states the disarmed exit code, which the code must match"
  );
  assert.ok(
    readme.includes("RestartPreventExitStatus=1"),
    "the README explains why the restart guard must not be removed"
  );
});
