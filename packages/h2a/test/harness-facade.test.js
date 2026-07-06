import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { H2A_NATIVE_VERBS, shouldDispatchRemote } from "../dist/bin-routing.js";

// `h2a harness <verb>` is a NAMESPACED in-process method CLI. Harness is
// h2a-owned/vendored: it must NOT require an external @sentropic/harness package,
// and must NOT leak to the remote runtime (golden rule).
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

test("h2a harness exposes the integrated harness usage, not 'Unknown command'", () => {
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

test("h2a harness check --help is served by the vendored h2a harness code", () => {
  const viaH2a = runH2a(["harness", "check", "--help"]);
  assert.equal(viaH2a.status, 2);
  assert.match(viaH2a.stdout, /harness check <scope\|branch>/);
  assert.doesNotMatch(viaH2a.out, /Cannot find package '@sentropic\/harness'|ERR_MODULE_NOT_FOUND/);
});
