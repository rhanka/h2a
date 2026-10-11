// Persistance des bearers de la gateway (incident 2026-10-10 : un restart ou
// un upgrade de la gateway invalidait le token de TOUTES les sessions vivantes
// — 401 généralisés — car le registre vivait dans deux Map en mémoire). Le
// registre persiste maintenant dans ~/.sentropic/llm-mesh-gateway-sessions.json
// (écriture atomique 0600) : un ancien token re-présenté après boot est
// accepté, et re-acquérir le même sessionId retourne le MÊME token au lieu
// d'en minter un nouveau. Ces tests simulent un nouveau boot par import
// dynamique avec query (nouvelle instance du module = nouveau process).
import assert from "node:assert/strict";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createPrivateTestDirectory,
  installNativeTestEnvironment,
  nativeTestEnvironment,
} from "./helpers/native-isolation.js";

const DIST_SESSIONS = new URL(
  "../../h2a-runtime/dist/gateway-host/sessions.js",
  import.meta.url,
);

let bootCounter = 0;
/** Fresh module instance = a new gateway process boot. */
async function freshSessionsModule() {
  bootCounter += 1;
  return import(`${DIST_SESSIONS.href}?boot=${bootCounter}`);
}

function makeFixture() {
  const root = createPrivateTestDirectory("gateway-bearer-persist-");
  mkdirSync(join(root, "home"), { recursive: true });
  return { root };
}

function setupTest(t, fixture) {
  const restoreEnvironment = installNativeTestEnvironment(nativeTestEnvironment(fixture.root));
  t.after(() => {
    restoreEnvironment();
    rmSync(fixture.root, { recursive: true, force: true });
  });
}

function storePath() {
  return join(
    process.env.HOME ?? "",
    ".sentropic",
    "llm-mesh-gateway-sessions.json",
  );
}

test("acquireSession mint, persiste en 0600, et un nouveau boot retrouve le MÊME token", async (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);

  const boot1 = await freshSessionsModule();
  const first = await boot1.acquireSession("i-cond");
  assert.ok(first.gatewayToken.startsWith("gw-v2-"));

  // The store is written atomically with private permissions.
  const path = storePath();
  assert.equal(statSync(path).mode & 0o777, 0o600, "le magasin doit être en 0600");

  // Simulated restart/upgrade: a brand new process state re-reads the store.
  const boot2 = await freshSessionsModule();
  assert.equal(boot2.sessionCount(), 1, "le boot doit restaurer 1 bearer");

  const again = await boot2.acquireSession("i-cond");
  assert.equal(again.gatewayToken, first.gatewayToken, "même sessionId => même token après restart");

  const looked = await boot2.lookupToken(first.gatewayToken);
  assert.ok(looked, "un ancien token doit rester valide après restart");
  assert.equal(looked.sessionId, "i-cond");
});

test("resetSessions vide les maps ET le magasin persisté", async (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);

  const boot1 = await freshSessionsModule();
  await boot1.acquireSession("s-a");
  await boot1.acquireSession("s-b");
  assert.equal(boot1.sessionCount(), 2);
  boot1.resetSessions();
  assert.equal(boot1.sessionCount(), 0);

  const boot2 = await freshSessionsModule();
  assert.equal(boot2.sessionCount(), 0, "le boot après reset ne doit rien restaurer");
});

test("un magasin corrompu ne fait jamais crasher le boot (fail-soft)", async (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);

  const path = storePath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "{not valid json at all", "utf8");

  const boot1 = await freshSessionsModule();
  assert.equal(boot1.sessionCount(), 0, "magasin corrompu => démarrage à vide");
  // Minting still works after a corrupt read.
  const minted = await boot1.acquireSession("post-corrupt");
  assert.ok(minted.gatewayToken.startsWith("gw-v2-"));

  const boot2 = await freshSessionsModule();
  assert.equal(boot2.sessionCount(), 1, "le magasin réécrit sain est restauré");
});

test("les sessions restaurées ne fuient pas leur token dans la vue publique", async (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);

  const boot1 = await freshSessionsModule();
  const first = await boot1.acquireSession("pub-check", { profile: "claude" });
  const boot2 = await freshSessionsModule();
  const publicView = boot2.listPublicSessions();
  assert.equal(publicView.length, 1);
  assert.equal(publicView[0].sessionId, "pub-check");
  assert.equal(publicView[0].profile, "claude");
  assert.ok(!("gatewayToken" in publicView[0]), "la vue publique ne doit pas exposer le bearer");
  const looked = await boot2.lookupSessionById("pub-check");
  assert.equal(looked?.gatewayToken, first.gatewayToken);
});
