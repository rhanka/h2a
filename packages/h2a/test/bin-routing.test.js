import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { H2A_NATIVE_VERBS, shouldDispatchRemote } from "../dist/bin-routing.js";
import { H2A_CLI_VERB_CONTRACTS } from "../dist/cli-contract.js";
import { TRACK_FACADE_VERBS } from "../dist/cli.js";

const ROOT = process.cwd();

test("parité: les verbes runtime (non-natifs) → dispatchRemote", () => {
  for (const v of [
    "ls", "jobs", "delegate", "wake-request", "rename", "restart", "select",
    "pick", "back", "migrate", "run", "attach", "stop", "workspace", "agents", "tunnel", "secrets"
  ]) {
    assert.equal(shouldDispatchRemote([v]), true, `${v} doit être délégué au runtime`);
  }
});

test("les verbes h2a-natifs (dont collisions) → PAS de délégation", () => {
  for (const v of [
    "status", "connect", "conductor-launch", "loop", "negotiate", "discover",
    "inbox", "sessions", "drumbeat", "mcp-serve", "keepalive", "remote", "drive", "sysml",
    // façade track (déléguée par runCli à la CLI track, PAS au runtime)
    "item", "decision", "report", "query", "blocker", "focus"
  ]) {
    assert.equal(shouldDispatchRemote([v]), false, `${v} doit rester natif`);
  }
});

test("focus reste natif pour permettre l'interception exacte serve/web avant la façade track", () => {
  assert.equal(shouldDispatchRemote(["focus", "serve"]), false);
  assert.equal(shouldDispatchRemote(["focus", "web"]), false);
  assert.ok(TRACK_FACADE_VERBS.has("focus"), "le focus Track historique reste dans la façade");
});

test("anti-drift: façade track ⊆ verbes natifs (ne partent jamais au runtime)", () => {
  for (const v of TRACK_FACADE_VERBS) {
    assert.ok(H2A_NATIVE_VERBS.has(v), `verbe façade track "${v}" doit être natif`);
  }
});

test("argv vide → pas de délégation", () => {
  assert.equal(shouldDispatchRemote([]), false);
});

test("anti-drift: le set natif couvre TOUS les 1ers mots du contrat CLI + routes bin.ts", () => {
  for (const c of H2A_CLI_VERB_CONTRACTS) {
    const first = c.verb.split(" ")[0];
    assert.ok(H2A_NATIVE_VERBS.has(first), `1er mot du contrat "${first}" doit être natif`);
  }
  for (const w of ["mcp-serve", "remote", "drive", "drumbeat", "sysml", "keepalive", "loop"]) {
    assert.ok(H2A_NATIVE_VERBS.has(w), `route bin.ts "${w}" doit être native`);
  }
});

test("golden cli-verbs.json câblé : chaque 1er mot est un verbe natif", () => {
  const golden = JSON.parse(readFileSync(join(ROOT, "docs/contracts/golden/cli-verbs.json"), "utf8"));
  for (const v of golden) {
    assert.ok(H2A_NATIVE_VERBS.has(v.split(" ")[0]), `golden "${v}" 1er mot doit être natif`);
  }
});

test("les 3 collisions connues sont natives (contrat gelé intact)", () => {
  for (const v of ["status", "connect", "conductor-launch"]) {
    assert.ok(H2A_NATIVE_VERBS.has(v), `collision ${v} doit rester native`);
  }
});
