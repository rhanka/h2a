// Self-heal du conflit de registre au resume (incident 2026-10 : deux lignes
// même convId/cwd/tool avec des pins bare/gatewayMode divergents => fatal
// "cannot recover pinned launch options: conflicting registry rows" qui
// bloquait TOUT resume). `runtime:run --resume` délègue maintenant la
// résolution à resolvePinnedLaunchEntries : les lignes conflictuelles sont
// sondées, les lignes PROUVÉEMENT mortes sont élaguées du registre, et un
// conflit qui survit reste un fatal — mais avec les ids et l'action de
// réparation. Ces tests couvrent les trois cas du garde-fou.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createPrivateTestDirectory,
  installNativeTestEnvironment,
  nativeTestEnvironment,
} from "./helpers/native-isolation.js";

import {
  enroll,
  loadRegistry,
  probeTmuxSession,
  resolveRegistryPath,
} from "../../h2a-runtime/dist/registry.js";
import { resolvePinnedLaunchEntries } from "../../h2a-runtime/dist/resume-launch-options.js";

const CONV_ID = "00000000-0000-4000-8000-0000000000aa";

function makeFixture() {
  const root = createPrivateTestDirectory("resume-conflict-");
  const project = join(root, "home", "src", "sentropic");
  const configDir = join(root, "config", ".config", "sentropic", "remote-cli");
  mkdirSync(project, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      layout: {
        maxAgeHours: 48,
        maxPerWindow: 20,
        sharedWindows: 1,
        multiSession: {},
        multiSessionDefault: 1,
        groups: [],
      },
    }),
    "utf8",
  );
  return { root, project, configDir };
}

// loadRegistry() returns a 3-state read; these fixtures always produce a
// readable registry, so this helper asserts that precondition and hands back
// the plain entries array the assertions expect.
function readEntries() {
  const read = loadRegistry(resolveRegistryPath());
  assert.equal(read.state, "ok");
  return read.entries;
}

function enrollRow({ id, kind, gatewayMode, tmuxSession }) {
  return enroll({
    id,
    tool: "claude",
    kind,
    cwd: process.env.H2A_RESUME_TEST_CWD,
    source: "run",
    sessionClass: "human",
    convId: CONV_ID,
    ...(gatewayMode !== undefined ? { gatewayMode } : {}),
    ...(tmuxSession !== undefined ? { tmuxSession } : {}),
  });
}

function runResolution(probes) {
  return resolvePinnedLaunchEntries({
    convId: CONV_ID,
    cwd: process.env.H2A_RESUME_TEST_CWD,
    tool: "claude",
    ...(probes !== undefined ? { probes } : {}),
  });
}

function setupTest(t, fixture) {
  const restoreEnvironment = installNativeTestEnvironment(nativeTestEnvironment(fixture.root));
  process.env.H2A_RESUME_TEST_CWD = fixture.project;
  t.after(() => {
    delete process.env.H2A_RESUME_TEST_CWD;
    restoreEnvironment();
    rmSync(fixture.root, { recursive: true, force: true });
  });
}

test("resume self-heal: ligne morte + ligne vivante => le resume continue, la ligne morte est élaguée", (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);
  // Conflit réel du run --resume : deux pins divergents (gateway vs direct).
  enrollRow({ id: "dead-tmux", kind: "local-tmux", gatewayMode: "gateway", tmuxSession: "h2a-dead-tmux" });
  enrollRow({ id: "live-native", kind: "local-native", gatewayMode: "direct" });

  // La ligne tmux est prouvée morte par la SONDE RÉELLE (session inexistante,
  // pid absent) ; la ligne native vivante est simulée par une sonde injectée
  // (pas de host natif dans un test).
  const resolution = runResolution({
    tmux: (name) => probeTmuxSession(name),
    native: () => "live",
  });

  assert.equal(resolution.state, "ok");
  assert.equal(resolution.entries.length, 1);
  assert.equal(resolution.entries[0]?.id, "live-native");
  assert.deepEqual(resolution.prunedIds, ["dead-tmux"]);
  // L'élaguage est durable : la ligne morte n'est plus dans le registre.
  const remaining = readEntries().map((entry) => entry.id);
  assert.deepEqual(remaining, ["live-native"]);
});

test("resume self-heal: deux lignes vivantes => fatal avec les ids et l'action de réparation", (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);
  enrollRow({ id: "live-tmux", kind: "local-tmux", gatewayMode: "gateway", tmuxSession: "h2a-live-tmux" });
  enrollRow({ id: "live-native", kind: "local-native", gatewayMode: "direct" });

  const resolution = runResolution({
    tmux: () => "live",
    native: () => "live",
  });

  assert.equal(resolution.state, "conflict");
  assert.deepEqual(resolution.ids, ["live-tmux", "live-native"]);
  assert.match(
    resolution.reason,
    /cannot recover pinned launch options: conflicting registry rows/,
  );
  assert.match(resolution.reason, /ids live-tmux, live-native/);
  assert.match(resolution.reason, /stop the stale session or remove its row/);
  // Fail-closed : rien n'est élagué tant que les deux lignes sont vivantes.
  const remaining = readEntries().map((entry) => entry.id);
  assert.deepEqual(remaining, ["live-tmux", "live-native"]);
});

test("resume self-heal: une seule ligne => aucun changement (pas de régression)", (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);
  enrollRow({ id: "solo", kind: "local-tmux", gatewayMode: "direct", tmuxSession: "h2a-solo" });

  // Sans conflit, aucune sonde ne doit être consultée.
  const resolution = runResolution({
    tmux: () => {
      throw new Error("no probe may run without a conflict");
    },
    native: () => {
      throw new Error("no probe may run without a conflict");
    },
  });

  assert.equal(resolution.state, "ok");
  assert.deepEqual(resolution.prunedIds, []);
  assert.equal(resolution.entries.length, 1);
  assert.equal(resolution.entries[0]?.id, "solo");
  const remaining = readEntries().map((entry) => entry.id);
  assert.deepEqual(remaining, ["solo"]);
});

test("resume self-heal: sonde inconnue => fail-closed, pas d'élagage sur un état non prouvable", (t) => {
  const fixture = makeFixture();
  setupTest(t, fixture);
  enrollRow({ id: "unprovable-tmux", kind: "local-tmux", gatewayMode: "gateway", tmuxSession: "h2a-unprovable" });
  enrollRow({ id: "live-native", kind: "local-native", gatewayMode: "direct" });

  const resolution = runResolution({
    tmux: () => "unknown",
    native: () => "live",
  });

  assert.equal(resolution.state, "conflict");
  assert.deepEqual(resolution.ids, ["unprovable-tmux", "live-native"]);
  const remaining = readEntries().map((entry) => entry.id);
  assert.deepEqual(remaining, ["unprovable-tmux", "live-native"]);
});
