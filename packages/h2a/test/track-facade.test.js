import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// P3: la façade h2a délègue les verbes track à la CLI @sentropic/track (shell-out).
const BIN = join(process.cwd(), "packages/h2a/dist/bin.js");

function runH2a(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return ((res.stdout || "") + (res.stderr || "")).trim();
}

test("h2a item délègue à `track item` (façade track)", () => {
  // `track item` sans sous-commande imprime son usage → preuve de délégation.
  assert.match(
    runH2a(["item"]),
    /track item <new\|reparent/,
    "h2a item doit produire l'usage de `track item` (délégation)"
  );
});

test("les 13 verbes façade délèguent tous à track (aucun 'unknown command' h2a)", () => {
  const verbs = [
    "decision", "report", "accept", "blocker", "item", "query",
    "consolidate", "priority", "branch", "focus", "ingest", "restructure", "snapshot"
  ];
  for (const v of verbs) {
    const out = runH2a([v, "--help"]);
    assert.doesNotMatch(
      out,
      /Unknown command|Run `h2a --help`/,
      `h2a ${v} doit déléguer à track, pas être rejeté par h2a`
    );
  }
});

test("un verbe NON-façade reste géré par h2a (pas de déroutage)", () => {
  const out = runH2a(["mcp-tools"]);
  assert.match(out, /h2a_inbox/, "mcp-tools reste une commande h2a native");
  assert.doesNotMatch(out, /track item/);
});

test("h2a --help documente la façade track (les 13 verbes + @sentropic/track)", () => {
  const help = runH2a(["--help"]);
  assert.match(help, /Track \(délégué à @sentropic\/track/);
  for (const verb of ["decision", "report", "snapshot", "item", "query", "blocker", "ingest"]) {
    assert.match(help, new RegExp(`h2a ${verb}`), `help doit lister h2a ${verb}`);
  }
});

test("report et snapshot préservent stdout/stderr/exit exactement face à Track", () => {
  // The native in-process façade and the Track binary both expose help without
  // needing a store; resolve Track's bin through its package manifest.
  const packageJson = join(process.cwd(), "packages/track/package.json");
  const manifest = JSON.parse(readFileSync(packageJson, "utf8"));
  const directBin = join(process.cwd(), "packages/track", manifest.bin.track);
  for (const verb of ["report", "snapshot"]) {
    const h2a = spawnSync(process.execPath, [BIN, verb, "--help"], { encoding: "utf8" });
    const track = spawnSync(process.execPath, [directBin, verb, "--help"], { encoding: "utf8" });
    assert.equal(h2a.status, track.status, `${verb}: exit parity`);
    assert.equal(h2a.stdout, track.stdout, `${verb}: stdout parity`);
    assert.equal(h2a.stderr, track.stderr, `${verb}: stderr parity`);
  }
});
