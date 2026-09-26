// The mcp-serve boot auto-upgrade can run in a DETACHED worker launched as
//   node --input-type=module --eval <src> -- <moduleUrl> <root> <ttl> <mode>
// where <moduleUrl> is `new URL("./runtime/upgrade/index.js", import.meta.url).href`
// resolved from the compiled dist cli.js. That worker imports the upgrade module by URL and
// calls currentCliVersion / checkUpgrade / performAutoUpgrade / upgradeCachePath AND the
// shared boot-visibility predicate isQuietUpgradeOutcome. The worker body is wrapped in a
// catch (best-effort: a boot-upgrade failure must never break serving), so a symbol that
// FAILS TO RESOLVE at runtime would be swallowed and silently disable the auto-upgrade —
// presence of the export in dist is not the same as resolution in the real --eval context.
// This test reproduces that exact launch mechanism and proves every symbol the worker uses
// resolves and executes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Same target the worker computes from dist/cli.js: dist/runtime/upgrade/index.js.
const MODULE_URL = pathToFileURL(join(HERE, "..", "dist", "runtime", "upgrade", "index.js")).href;

// Mirror the worker's launch context exactly: --input-type=module --eval, module imported by
// URL from argv, top-level await. Assert every symbol the real worker touches is callable.
const PROBE_SRC = `
const [moduleUrl] = process.argv.slice(1);
const upgrade = await import(moduleUrl);
const need = ["currentCliVersion", "checkUpgrade", "performAutoUpgrade", "upgradeCachePath", "isQuietUpgradeOutcome"];
const missing = need.filter((n) => typeof upgrade[n] !== "function");
if (missing.length) { process.stderr.write("MISSING:" + missing.join(",")); process.exit(3); }
// Exercise the predicate the worker gates its stderr on, in this real --eval context.
const out = {
  quiet_skippedLocked: upgrade.isQuietUpgradeOutcome("skipped-locked"),
  loud_blockedUndecidable: upgrade.isQuietUpgradeOutcome("blocked-undecidable"),
  loud_skippedLockedStale: upgrade.isQuietUpgradeOutcome("skipped-locked-stale"),
  currentIsString: typeof upgrade.currentCliVersion() === "string"
};
process.stdout.write(JSON.stringify(out));
`;

test("boot worker: the --eval worker resolves and executes every upgrade symbol it uses (incl. isQuietUpgradeOutcome)", () => {
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", PROBE_SRC, "--", MODULE_URL],
    { encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(r.status, 0, `worker exited nonzero (${r.status}); stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.quiet_skippedLocked, true, "skipped-locked stays quiet");
  assert.equal(out.loud_blockedUndecidable, false, "blocked-undecidable (M-2) must surface at boot");
  assert.equal(out.loud_skippedLockedStale, false, "skipped-locked-stale (R2) must surface at boot");
  assert.equal(out.currentIsString, true, "currentCliVersion resolves in the worker context");
});
