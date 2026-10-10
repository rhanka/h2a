// Garde d'écart CLI↔runtime au lancement (incident 2026-10 : runtime 0.98.2
// déployé sous CLI 0.98.0 => toutes les CLIs mortes de crashs obscurs). Avant
// de charger @sentropic/h2a-runtime, la CLI compare la version du runtime
// INSTALLÉ à la plage qu'elle déclare dans son package.json ; hors plage =>
// refus propre (versions installée/attendue + "run h2a upgrade"), JAMAIS un
// crash en aval. dispatchRuntime est à seams injectables : ces tests ne font
// ni npm, ni réseau, ni vrai lancement lourd.
import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_RUNTIME_VERSION_EXIT,
  dispatchRuntime,
  expectedRuntimeRangeFromPackage,
  readExpectedRuntimeRange,
  resolveInstalledRuntimeVersion,
  runtimeVersionSatisfiesRange,
} from "../dist/bin-routing.js";

function captureStderr() {
  let text = "";
  return {
    write: (chunk) => {
      text += chunk;
      return true;
    },
    get text() {
      return text;
    },
  };
}

test("garde CLI↔runtime: version dans la plage => le runtime est importé et dispatché", async () => {
  let imports = 0;
  const stderr = captureStderr();
  const rc = await dispatchRuntime({
    verb: "run",
    expectedRange: "^0.98.2",
    runtimeVersion: "0.98.3",
    importRuntime: async () => {
      imports += 1;
      return {
        H2A_RUNTIME_CLI_API_VERSION: 1,
        dispatchH2a: async () => 7,
      };
    },
    stderr,
  });
  assert.equal(imports, 1, "le runtime doit être importé (pas de refus)");
  assert.equal(rc, 7, "le code retour est celui du runtime dispatché");
  assert.equal(stderr.text, "");
});

test("garde CLI↔runtime: version hors plage => refus propre AVANT tout chargement", async () => {
  let imports = 0;
  const stderr = captureStderr();
  const rc = await dispatchRuntime({
    verb: "run",
    expectedRange: "^0.98.2",
    runtimeVersion: "0.99.0",
    importRuntime: async () => {
      imports += 1;
      throw new Error("le runtime hors plage ne doit jamais être chargé");
    },
    stderr,
  });
  assert.equal(imports, 0, "le runtime ne doit PAS être importé");
  assert.equal(rc, H2A_RUNTIME_VERSION_EXIT);
  // Le message porte les deux versions et la commande de réparation.
  assert.match(stderr.text, /0\.99\.0/);
  assert.match(stderr.text, /\^0\.98\.2/);
  assert.match(stderr.text, /h2a upgrade/);
});

test("garde CLI↔runtime: égalité lockstep et version dev dans la plage => lance", async () => {
  for (const runtimeVersion of ["0.98.2", "0.98.4-dev.1"]) {
    let imports = 0;
    const rc = await dispatchRuntime({
      verb: "attach",
      expectedRange: "^0.98.2",
      runtimeVersion,
      importRuntime: async () => {
        imports += 1;
        return {
          H2A_RUNTIME_CLI_API_VERSION: 1,
          dispatchH2a: async () => 0,
        };
      },
      stderr: captureStderr(),
    });
    assert.equal(imports, 1, `${runtimeVersion} doit passer le pré-vol`);
    assert.equal(rc, 0);
  }
});

test("garde CLI↔runtime: l'installation workspace du repo passe le pré-vol", () => {
  // En dev (workspaces), le runtime du repo doit satisfaire la plage déclarée
  // par packages/h2a — sinon le lockstep du monorepo est cassé et le CI doit
  // le dire ici, pas par un crash au lancement.
  const expected = readExpectedRuntimeRange();
  assert.ok(expected, "packages/h2a déclare une plage pour @sentropic/h2a-runtime");
  const installed = resolveInstalledRuntimeVersion();
  assert.ok(installed, "le runtime workspace doit être résolu depuis la CLI");
  assert.equal(
    runtimeVersionSatisfiesRange(installed, expected),
    true,
    `runtime workspace ${installed} doit satisfaire ${expected}`,
  );
});

test("garde CLI↔runtime: évaluateur de plage (sémantique npm, fail-open sur l'illisible)", () => {
  const cases = [
    ["0.98.2", "^0.98.2", true],
    ["0.98.9", "^0.98.2", true],
    ["0.98.1", "^0.98.2", false],
    ["0.99.0", "^0.98.2", false],
    ["1.0.0", "^0.98.2", false],
    ["1.9.9", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["0.0.3", "^0.0.2", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["0.98.2", "0.98.2", true],
    ["0.98.3", "0.98.2", false],
    // Métadonnées illisibles => fail-open : la garde ne doit jamais bricker une
    // install qu'elle ne peut pas lire (l'import reste le filet de sécurité).
    ["not-a-version", "^0.98.2", true],
    ["0.98.2", "latest", true],
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(
      runtimeVersionSatisfiesRange(version, range),
      expected,
      `${version} vs ${range}`,
    );
  }
});

test("garde CLI↔runtime: la plage attendue vient des dependencies avant les peerDependencies", () => {
  assert.equal(
    expectedRuntimeRangeFromPackage({
      dependencies: { "@sentropic/h2a-runtime": "^1.2.3" },
      peerDependencies: { "@sentropic/h2a-runtime": "^9.9.9" },
    }),
    "^1.2.3",
  );
  assert.equal(
    expectedRuntimeRangeFromPackage({
      peerDependencies: { "@sentropic/h2a-runtime": "^9.9.9" },
    }),
    "^9.9.9",
  );
  assert.equal(expectedRuntimeRangeFromPackage({}), undefined);
});
