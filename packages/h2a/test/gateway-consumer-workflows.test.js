import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const readWorkflow = (name) =>
  readFileSync(join(REPO, ".github", "workflows", name), "utf8");

test("smoke and rehearsal gate committed-lock jobs behind consumer-phase", () => {
  for (const file of ["smoke.yml", "publish-rehearsal.yml"]) {
    const yml = readWorkflow(file);
    assert.match(yml, /consumer-phase/, `${file} has a consumer-phase job`);
    assert.match(
      yml,
      /scripts\/gateway-consumer-ci\.mjs/,
      `${file} classifies with the shared helper`,
    );
    assert.match(
      yml,
      /buildCommittedLock/,
      `${file} exposes the buildCommittedLock output`,
    );
    assert.match(
      yml,
      /needs:.*consumer-phase/,
      `${file} wires downstream jobs behind consumer-phase`,
    );
    assert.match(
      yml,
      /needs\.consumer-phase\.outputs\.buildCommittedLock == 'true'/,
      `${file} restores ordinary jobs only on committed-lock phases`,
    );
    assert.match(
      yml,
      /not-applicable \(candidate-phase, committed lock\)/,
      `${file} records the exact candidate inactivity reason`,
    );
  }
});

test("candidate inactivity never weakens the real gates", () => {
  const smoke = readWorkflow("smoke.yml");
  assert.match(smoke, /smoke-install/, "smoke-install job retained");
  assert.match(
    smoke,
    /os: \[ubuntu-latest, macos-latest, windows-latest\]/,
    "three-OS smoke matrix retained",
  );
  const rehearsal = readWorkflow("publish-rehearsal.yml");
  assert.match(rehearsal, /rehearse-publish/, "rehearse-publish job retained");
  assert.match(rehearsal, /npm publish --dry-run/, "dry-run publish retained");
});

test("ci verifies merge parents are base and head on PRs", () => {
  const ci = readWorkflow("ci.yml");
  assert.match(ci, /fetch-depth: 2/, "ci fetches merge parents");
  assert.match(
    ci,
    /check-merge-parents/,
    "ci checks merge parents against base/head",
  );
  assert.match(
    ci,
    /github\.event_name == 'pull_request'/,
    "merge-parent check scoped to PR merge checkouts",
  );
});

test("native-namespace guard follows the path-filter condition", () => {
  const yml = readWorkflow("native-namespace-qualification.yml");
  const companionPaths = [
    "packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts",
    "packages/h2a/test/gateway-consumer-ci.test.js",
    "scripts/gateway-consumer-ci.mjs",
    ".github/gateway-consumer-input.schema.json",
  ];
  const filterHits = companionPaths.filter((p) => {
    if (yml.includes(`- '${p}'`)) return true;
    const dir = p.split("/").slice(0, -1).join("/");
    return yml.includes(`${dir}/**`);
  });
  assert.deepEqual(
    filterHits,
    [],
    `namespace filter excludes this companion's scope (${filterHits}); no guard edit required, ordinary trigger rules apply`,
  );
});

test("shared schema file is the frozen GWRC-CI-V1 declaration", () => {
  const raw = readFileSync(
    join(REPO, ".github", "gateway-consumer-input.schema.json"),
    "utf8",
  );
  const schema = JSON.parse(raw);
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.properties.program.enum, ["gateway", "registry"]);
  assert.ok(
    schema.properties.phase.enum.includes("baseline-662"),
    "H0 baseline phase frozen",
  );
  assert.ok(
    schema.properties.phase.enum.includes("pr1-candidate"),
    "candidate phases frozen",
  );
  assert.ok(
    schema.properties.phase.enum.includes("pr1-published"),
    "published phases frozen",
  );
  assert.equal(schema.additionalProperties, false);
});
