// The mcp-serve boot auto-upgrade can run in a DETACHED worker launched as
//   node --input-type=module --eval <src> -- <moduleUrl> <root> <ttl> <mode>
// where <src> is the exported MCP_UPGRADE_WORKER_SOURCE and <moduleUrl> is the compiled
// dist upgrade module. The worker imports that module by URL and calls currentCliVersion /
// checkUpgrade / performAutoUpgrade / upgradeCachePath AND the shared boot-visibility
// predicate isQuietUpgradeOutcome. Its body is wrapped in a catch (best-effort: a boot
// failure must never break serving), so a symbol that fails to RESOLVE at runtime would be
// swallowed — presence of an export in dist is not resolution in the real --eval context.
// These tests run the REAL worker source (not a copy) in that exact context.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MCP_UPGRADE_WORKER_SOURCE } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Same target the worker computes from dist/cli.js: dist/runtime/upgrade/index.js.
const MODULE_URL = pathToFileURL(join(HERE, "..", "dist", "runtime", "upgrade", "index.js")).href;

// Launch the REAL worker source exactly as cli.js does.
function runWorker(moduleUrl, mode, root) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", MCP_UPGRADE_WORKER_SOURCE, "--", moduleUrl, root, "3600000", mode],
    { encoding: "utf8", timeout: 30_000 }
  );
}

// A data: module that re-exports the real symbols the worker reads from dist but replaces
// performAutoUpgrade with one that returns a chosen outcome — so the worker's stderr routing
// (gated on isQuietUpgradeOutcome) is exercised without any network or disk mutation. When
// withQuiet is false, isQuietUpgradeOutcome is NOT exported (simulates a version skew).
function stubModule(outcome, { withQuiet = true } = {}) {
  const names = withQuiet
    ? "currentCliVersion, checkUpgrade, upgradeCachePath, isQuietUpgradeOutcome"
    : "currentCliVersion, checkUpgrade, upgradeCachePath";
  const src =
    `export { ${names} } from ${JSON.stringify(MODULE_URL)};\n` +
    `export function performAutoUpgrade() { return { outcome: ${JSON.stringify(outcome)}, message: "worker-test-" + ${JSON.stringify(outcome)} }; }\n`;
  return "data:text/javascript," + encodeURIComponent(src);
}

// Resolution: the REAL dist module exposes every symbol the worker imports (probe exits 3 on
// any missing one — verified separately). Guards against dropping an export the worker needs.
const PROBE_SRC = `
const [moduleUrl] = process.argv.slice(1);
const upgrade = await import(moduleUrl);
const need = ["currentCliVersion", "checkUpgrade", "performAutoUpgrade", "upgradeCachePath", "isQuietUpgradeOutcome"];
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

test("boot worker: the REAL worker source surfaces an actionable outcome and stays quiet on a benign one", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw-"));
  try {
    const loud = runWorker(stubModule("blocked-undecidable"), "auto", root);
    assert.equal(loud.status, 0, `worker errored: ${loud.stderr}`);
    assert.match(loud.stderr, /worker-test-blocked-undecidable/, "an actionable outcome surfaces on stderr at boot");

    const quiet = runWorker(stubModule("skipped-locked"), "auto", root);
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stderr.trim(), "", "a benign skip stays quiet");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The `?.` fail-open: if the imported (older) module lacks isQuietUpgradeOutcome, the message
// must STILL surface (fail-open) rather than the alarm being lost silently. Reproduces the
// version-skew case (rollback/downgrade during boot on the hinge release).
test("boot worker: a missing isQuietUpgradeOutcome fails OPEN (message shown, alarm not lost)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-bw2-"));
  try {
    const r = runWorker(stubModule("blocked-undecidable", { withQuiet: false }), "auto", root);
    assert.equal(r.status, 0, `worker errored: ${r.stderr}`);
    assert.match(r.stderr, /worker-test-blocked-undecidable/, "message shown even without the quiet predicate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
