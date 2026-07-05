import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { H2A_NATIVE_VERBS, shouldDispatchRemote } from "../dist/bin-routing.js";

// Slice A — `h2a harness <verb>` is a NAMESPACED in-process passthrough to the
// `@sentropic/harness` method CLI (`runHarnessCli`). It must NOT be treated as an
// unknown command, and must NOT leak to the remote runtime (golden rule).
const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

function runH2a(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return {
    out: ((res.stdout || "") + (res.stderr || "")).trim(),
    stdout: (res.stdout || "").trim(),
    status: res.status
  };
}

test("h2a harness délègue à @sentropic/harness (usage harness, pas 'Unknown command')", () => {
  const { out } = runH2a(["harness", "--help"]);
  // Preuve de délégation : l'usage harness liste ses verbes de méthode.
  assert.match(out, /harness check <scope\|branch>/, "doit produire l'usage harness");
  assert.match(out, /brainstorm|review|plan|verify/, "doit lister les verbes méthode harness");
  // Ni rejeté par h2a, ni dérouté vers le runtime remote.
  assert.doesNotMatch(out, /Unknown command|Run `h2a --help`/, "ne doit pas être rejeté par h2a");
  assert.doesNotMatch(out, /requiert le runtime remote|@sentropic\/h2a-runtime/, "ne doit pas partir au runtime");
});

test("h2a harness check --help délègue (usage harness, sous-verbe)", () => {
  const { out } = runH2a(["harness", "check", "--help"]);
  assert.match(out, /harness check <scope\|branch>/, "sous-verbe check délégué à harness");
  assert.doesNotMatch(out, /Unknown command|Run `h2a --help`/);
});

test("anti-drift: `harness` est un verbe NATIF (jamais routé remote)", () => {
  assert.ok(H2A_NATIVE_VERBS.has("harness"), "harness doit être dans H2A_NATIVE_VERBS");
  assert.equal(shouldDispatchRemote(["harness"]), false, "harness ne doit pas partir au runtime");
});

test("parité: `h2a harness check --help` == `harness check --help` (bin @sentropic/harness)", (t) => {
  // Résout le bin harness depuis la dépendance installée (pas le global PATH),
  // via le main exporté puis dérivation du bin (dist/index.js → dist/bin/harness.js).
  let harnessBin;
  try {
    const require = createRequire(import.meta.url);
    const harnessMain = require.resolve("@sentropic/harness/package.json", {
      paths: [join(ROOT, "packages/h2a"), ROOT]
    });
    harnessBin = join(dirname(harnessMain), "dist", "bin", "harness.js");
  } catch {
    // `exports` peut bloquer package.json — repli sur les emplacements connus.
    for (const cand of [
      join(ROOT, "node_modules/@sentropic/harness/dist/bin/harness.js"),
      join(ROOT, "packages/h2a/node_modules/@sentropic/harness/dist/bin/harness.js")
    ]) {
      if (existsSync(cand)) {
        harnessBin = cand;
        break;
      }
    }
  }
  if (!harnessBin || !existsSync(harnessBin)) {
    t.skip("bin @sentropic/harness introuvable — parité non vérifiable ici");
    return;
  }
  const viaH2a = runH2a(["harness", "check", "--help"]);
  const direct = spawnSync(process.execPath, [harnessBin, "check", "--help"], { encoding: "utf8" });
  assert.equal(
    viaH2a.stdout,
    (direct.stdout || "").trim(),
    "la sortie stdout du passthrough doit être identique au bin harness"
  );
  assert.equal(viaH2a.status, direct.status, "le code de sortie doit être identique");
});
