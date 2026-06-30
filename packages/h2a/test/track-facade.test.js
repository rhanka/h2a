import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("h2a query délègue à track (pas un 'unknown command' h2a)", () => {
  assert.doesNotMatch(runH2a(["query", "--help"]), /Unknown command|Run `h2a --help`/);
});

test("un verbe NON-façade reste géré par h2a (pas de déroutage)", () => {
  const out = runH2a(["mcp-tools"]);
  assert.match(out, /h2a_inbox/, "mcp-tools reste une commande h2a native");
  assert.doesNotMatch(out, /track item/);
});
