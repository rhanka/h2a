// Compatibility of the historical exported worker source for external callers.
// Production boot now uses runtime/upgrade/boot-worker.js; the real path is
// exercised in mh-l6-components.test.js. The old export still runs as
//   node --input-type=module --eval <src> -- <moduleUrl> <root> <ttl> <mode>
// where <src> is the exported MCP_UPGRADE_WORKER_SOURCE and <moduleUrl> is the compiled
// dist upgrade module. Since LOT-1 the worker delegates to the single H4 pass
// (`runBootUpgrade` + `describeBootUpgrade`): the legacy staged engine is
// unreachable from this source. Its body is wrapped in a catch (best-effort: a boot
// failure must never break serving), so a symbol that fails to RESOLVE at runtime would be
// swallowed — presence of an export in dist is not resolution in the real --eval context.
// These tests run the real compatibility export (not a copy) in that context.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MCP_UPGRADE_WORKER_SOURCE } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Engine used by the compatibility export: dist/runtime/upgrade/index.js.
const MODULE_URL = pathToFileURL(join(HERE, "..", "dist", "runtime", "upgrade", "index.js")).href;

// Launch the real compatibility export in its historical eval context.
function runWorker(moduleUrl, mode, root) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", MCP_UPGRADE_WORKER_SOURCE, "--", moduleUrl, root, "3600000", mode],
    { encoding: "utf8", timeout: 30_000 }
  );
}

// A data: module that replaces runBootUpgrade with a recorder returning a
// canned H4 result — so the worker's delegation and stderr routing (via the
// real describeBootUpgrade) are exercised without any network or disk
// mutation. The legacy staged engine symbols are exported as traps: any call
// throws, proving the worker cannot reach the legacy path. When withDescribe
// is false, describeBootUpgrade is NOT exported (simulates a version skew).
function stubModule(canned, { withDescribe = true } = {}) {
  const src =
    `export function runBootUpgrade(options) {\n` +
    `  process.stderr.write("CALL:" + JSON.stringify({ mode: options.mode, root: options.root, ttlMs: options.ttlMs }) + "\\n");\n` +
    `  return ${JSON.stringify(canned)};\n` +
    `}\n` +
    (withDescribe ? `export { describeBootUpgrade } from ${JSON.stringify(MODULE_URL)};\n` : "") +
    `function trapped(name) { throw new Error("legacy-engine-reached:" + name); }\n` +
    `export const performAutoUpgrade = () => trapped("performAutoUpgrade");\n` +
    `export const checkUpgrade = () => trapped("checkUpgrade");\n` +
    `export const currentCliVersion = () => trapped("currentCliVersion");\n` +
    `export const upgradeCachePath = () => trapped("upgradeCachePath");\n`;
  return "data:text/javascript," + encodeURIComponent(src);
}

function splitCall(result) {
  const lines = result.stderr.split("\n");
  const call = lines.find((line) => line.startsWith("CALL:"));
  const rest = lines.filter((line) => line && !line.startsWith("CALL:")).join("\n");
  return { call: call === undefined ? null : JSON.parse(call.slice("CALL:".length)), rest };
}

// Resolution: the REAL dist module exposes every symbol the worker imports (probe exits 3 on
// any missing one — verified separately). Guards against dropping an export the worker needs.
const PROBE_SRC = `
const [moduleUrl] = process.argv.slice(1);
const upgrade = await import(moduleUrl);
const need = ["runBootUpgrade", "describeBootUpgrade"];
const missing = need.filter((n) => typeof upgrade[n] !== "function");
if (missing.length) { process.stderr.write("MISSING:" + missing.join(",")); process.exit(3); }
process.stdout.write("ok");
`;

test("boot worker: the dist module exposes every symbol the worker imports", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "--eval", PROBE_SRC, "--", MODULE_URL], {
    encoding: "utf8",
    timeout: 30_000
  });
  assert.equal(r.status, 0, `missing worker symbol(s): ${r.stderr}`);
  assert.equal(r.stdout, "ok");
});

test("boot worker: the REAL worker source delegates auto to the H4 pass and surfaces selection", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw-"));
  try {
    const r = runWorker(
      stubModule({ mode: "auto", completed: true, reason: "selected", current: "0.98.6", latest: "9.9.9", selectedVersion: "9.9.9" }),
      "auto",
      root
    );
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    const { call, rest } = splitCall(r);
    assert.deepEqual(call, { mode: "auto", root, ttlMs: 3600000 }, "worker calls runBootUpgrade with its argv");
    assert.match(rest, /auto-selected h2a 9\.9\.9 \(applies on next launch\)/, "selection surfaces on stderr at boot");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boot worker: a quiet H4 outcome stays silent and the legacy engine is never called", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw-"));
  try {
    const r = runWorker(
      stubModule({ mode: "auto", completed: false, reason: "already_adopted", current: "0.98.6" }),
      "auto",
      root
    );
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    const { call, rest } = splitCall(r);
    assert.deepEqual(call, { mode: "auto", root, ttlMs: 3600000 });
    assert.equal(rest.trim(), "", "a benign H4 outcome stays quiet (legacy traps uncalled)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boot worker: the REAL worker source routes check notices through the H4 description", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw-"));
  try {
    const r = runWorker(
      stubModule({ mode: "check", completed: false, reason: "upgrade_available", current: "0.98.6", latest: "9.9.9" }),
      "check",
      root
    );
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    const { call, rest } = splitCall(r);
    assert.deepEqual(call, { mode: "check", root, ttlMs: 3600000 });
    assert.match(rest, /h2a 9\.9\.9 available \(current 0\.98\.6\)/, "check notice preserved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The `?.` fail-open: if the imported (older) module lacks runBootUpgrade, a
// generic line must STILL surface (fail-open) rather than the alarm being lost
// silently. Reproduces the version-skew case (rollback/downgrade during boot
// on the hinge release).
test("boot worker: a missing runBootUpgrade fails OPEN (message shown, alarm not lost)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw2-"));
  try {
    const src =
      `export function currentCliVersion() { return "0.0.0"; }\n` +
      `export function performAutoUpgrade() { return { outcome: "blocked-undecidable", message: "legacy-alarm" }; }\n`;
    const legacyOnly = "data:text/javascript," + encodeURIComponent(src);
    const r = runWorker(legacyOnly, "auto", root);
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    assert.match(r.stderr, /legacy upgrade module/, "message shown even without the H4 entry");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boot worker: a missing describeBootUpgrade fails OPEN with the recorded-outcome line", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw2-"));
  try {
    const r = runWorker(
      stubModule({ mode: "auto", completed: true, reason: "selected", current: "0.98.6", latest: "9.9.9", selectedVersion: "9.9.9" }, { withDescribe: false }),
      "auto",
      root
    );
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    const { rest } = splitCall(r);
    assert.match(rest, /outcome recorded/, "fail-open line shown without the description export");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
