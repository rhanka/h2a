import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const BIN = join(PKG_ROOT, "dist", "bin.js");
const EXPECTED = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;

function runBin(arg) {
  const home = mkdtempSync(join(tmpdir(), "h2a-bin-version-home-"));
  const run = mkdtempSync(join(tmpdir(), "h2a-bin-version-run-"));
  return spawnSync(process.execPath, [BIN, arg], {
    env: {
      ...process.env,
      HOME: home,
      XDG_RUNTIME_DIR: run,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
    },
    encoding: "utf8",
  });
}

// Régression 0.98.7-rc.7 : un dispatch runtime précoce interceptait ce trio
// (`version` → « error: unknown command », `--version` → « 0.0.0 »).
test("h2a version imprime exactement la version du package (exit 0)", () => {
  const result = runBin("version");
  assert.equal(result.status, 0, `h2a version doit sortir en 0 (stderr: ${result.stderr})`);
  assert.equal(result.stdout.trim(), EXPECTED, `h2a version doit imprimer ${EXPECTED}`);
});

test("h2a --version imprime exactement la version du package (exit 0)", () => {
  const result = runBin("--version");
  assert.equal(result.status, 0, `h2a --version doit sortir en 0 (stderr: ${result.stderr})`);
  assert.equal(result.stdout.trim(), EXPECTED, `h2a --version doit imprimer ${EXPECTED}`);
});

test("h2a -v imprime exactement la version du package (exit 0)", () => {
  const result = runBin("-v");
  assert.equal(result.status, 0, `h2a -v doit sortir en 0 (stderr: ${result.stderr})`);
  assert.equal(result.stdout.trim(), EXPECTED, `h2a -v doit imprimer ${EXPECTED}`);
});

test("bin.ts ne dispatche vers le runtime qu'au fallback final (aucun dispatch avant la branche version)", () => {
  const src = readFileSync(join(PKG_ROOT, "src", "bin.ts"), "utf8");
  const versionPos = src.indexOf('argv[0] === "--version"');
  assert.ok(versionPos !== -1, "la branche --version/-v/version doit exister dans bin.ts");
  const dispatchSites = [...src.matchAll(/dispatchRuntime\(\)/g)].map((m) => m.index ?? -1);
  assert.equal(dispatchSites.length, 1, "un seul site de dispatch runtime (le fallback final)");
  assert.ok(versionPos < dispatchSites[0], "la branche version doit précéder le dispatch runtime");
});
