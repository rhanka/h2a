import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bindingForEvent,
  classify,
  mainEligibility,
  validateInput,
} from "../../../scripts/gateway-consumer-ci.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const HEX64 = "a".repeat(64);
const HEX64B = "b".repeat(64);

function activeInput(overrides = {}) {
  const phase = overrides.phase ?? "baseline-662";
  const program = overrides.program ?? "gateway";
  const base = {
    schemaVersion: 1,
    program,
    phase,
    artifactKind: "published",
    contractSha256: HEX64,
    releaseLockSha256: HEX64B,
    artifactManifest: { sha256: HEX64 },
    artifactManifestText: "manifest-bytes",
    packages: [],
    mode: "aggregate",
    profiles: ["gateway-messaging", "gateway-runtime"],
    programCoverage: [
      {
        program,
        phase,
        contractSha256: HEX64,
        profiles: ["gateway-messaging", "gateway-runtime"],
      },
    ],
  };
  const { programCoverage, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    programCoverage: programCoverage ?? base.programCoverage,
  };
}

test("absent input is inert: ordinary CI unchanged", () => {
  const c = classify(null);
  assert.equal(c.buildCommittedLock, true);
  assert.match(c.reason, /ordinary CI unchanged/);
});

test("none phase is inert without active fields", () => {
  const input = { schemaVersion: 1, program: "gateway", phase: "none" };
  assert.deepEqual(validateInput(input), []);
  const c = classify(input);
  assert.equal(c.buildCommittedLock, true);
});

test("baseline-662 and published restore ordinary committed-lock jobs", () => {
  for (const phase of ["baseline-662", "pr1-published"]) {
    const c = classify(activeInput({ phase }));
    assert.equal(c.buildCommittedLock, true, phase);
  }
});

test("candidate phases make build/pack jobs inactive with the exact reason", () => {
  const input = {
    ...activeInput({ phase: "pr1-candidate", artifactKind: "candidate" }),
    artifactManifestText: undefined,
  };
  delete input.artifactManifestText;
  input.artifactManifest = {
    sha256: HEX64,
    path: `.github/gateway-candidates/pr1-candidate/${HEX64}/manifest.json`,
  };
  input.candidateBundle = {
    root: `.github/gateway-candidates/pr1-candidate/${HEX64}/`,
    indexPath: `.github/gateway-candidates/pr1-candidate/${HEX64}/bundle-index.json`,
    bundleSha256: HEX64,
  };
  assert.deepEqual(validateInput(input), []);
  const c = classify(input);
  assert.equal(c.buildCommittedLock, false);
  assert.equal(c.reason, "not-applicable (candidate-phase, committed lock)");
});

test("unknown keys, programs, phases and mismatched pairs are refused", () => {
  assert.match(
    validateInput({ ...activeInput(), extra: 1 }).join(";"),
    /unknown key/,
  );
  assert.match(
    validateInput(activeInput({ program: "nope" })).join(";"),
    /program/,
  );
  assert.match(validateInput(activeInput({ phase: "nope" })).join(";"), /phase/);
  assert.match(
    validateInput(activeInput({ program: "registry", phase: "pr1-published" })).join(";"),
    /program\/phase/,
  );
  assert.match(
    validateInput(activeInput({ program: "gateway", phase: "r5-published" })).join(";"),
    /program\/phase/,
  );
});

test("candidate bundle layout is pinned: root, index path and digest suffix", () => {
  const input = {
    ...activeInput({ phase: "pr1-candidate", artifactKind: "candidate" }),
    artifactManifest: {
      sha256: HEX64,
      path: `.github/gateway-candidates/pr1-candidate/${HEX64}/manifest.json`,
    },
    candidateBundle: {
      root: `.github/gateway-candidates/pr1-candidate/${HEX64}/`,
      indexPath: `.github/gateway-candidates/pr1-candidate/${HEX64}/bundle-index.json`,
      bundleSha256: HEX64,
    },
  };
  delete input.artifactManifestText;
  assert.deepEqual(validateInput(input), []);
  const traversal = structuredClone(input);
  traversal.candidateBundle.root = ".github/gateway-candidates/pr1-candidate/../x/";
  assert.match(validateInput(traversal).join(";"), /candidateBundle/i);
});

test("candidate bundle digest must equal its directory suffix", () => {
  const input = {
    ...activeInput({ phase: "pr1-candidate", artifactKind: "candidate" }),
    artifactManifest: {
      sha256: HEX64,
      path: `.github/gateway-candidates/pr1-candidate/${HEX64}/manifest.json`,
    },
    candidateBundle: {
      root: `.github/gateway-candidates/pr1-candidate/${HEX64}/`,
      indexPath: `.github/gateway-candidates/pr1-candidate/${HEX64}/bundle-index.json`,
      bundleSha256: HEX64B,
    },
  };
  delete input.artifactManifestText;
  assert.match(validateInput(input).join(";"), /bundle/i);
});

test("baseline and candidate phases are forbidden as final main input", () => {
  assert.equal(mainEligibility("baseline-662").ok, false);
  assert.equal(mainEligibility("pr1-candidate").ok, false);
  assert.equal(mainEligibility("pr1-published").ok, true);
  assert.equal(mainEligibility("none").ok, true);
});

test("PR source binding requires identical triple across jobs", () => {
  const b = bindingForEvent({
    eventName: "pull_request",
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    mergeSha: "m".repeat(40),
    checkoutSha: "m".repeat(40),
  });
  assert.deepEqual(b.errors, []);
  const stale = bindingForEvent({
    eventName: "pull_request",
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    mergeSha: "m".repeat(40),
    checkoutSha: "x".repeat(40),
  });
  assert.match(stale.errors.join(";"), /checkout/i);
});

test("programCoverage union: cross-program rows validate with union top-level profiles", () => {
  const input = activeInput({
    phase: "pr1-published",
    profiles: [
      "gateway-messaging",
      "gateway-runtime",
      "registry-focus",
      "registry-runtime",
    ],
    programCoverage: [
      {
        program: "gateway",
        phase: "pr1-published",
        contractSha256: HEX64,
        profiles: ["gateway-messaging", "gateway-runtime"],
      },
      {
        program: "registry",
        phase: "r4-published",
        contractSha256: HEX64B,
        profiles: ["registry-focus", "registry-runtime"],
      },
    ],
  });
  assert.deepEqual(validateInput(input), []);
});

test("programCoverage rows reject unknown profiles and enforce the sorted union", () => {
  const withUnknown = activeInput({
    programCoverage: [
      {
        program: "gateway",
        phase: "baseline-662",
        contractSha256: HEX64,
        profiles: ["gateway-messaging", "gateway-runtime"],
      },
      {
        program: "registry",
        phase: "r4-published",
        contractSha256: HEX64B,
        profiles: ["unknown-profile"],
      },
    ],
  });
  assert.match(validateInput(withUnknown).join(";"), /profile/);
  const driftedUnion = activeInput({
    programCoverage: [
      {
        program: "gateway",
        phase: "baseline-662",
        contractSha256: HEX64,
        profiles: ["gateway-messaging", "gateway-runtime"],
      },
      {
        program: "registry",
        phase: "r4-published",
        contractSha256: HEX64B,
        profiles: ["registry-focus"],
      },
    ],
  });
  assert.match(validateInput(driftedUnion).join(";"), /union/);
  const badContract = activeInput({
    programCoverage: [
      {
        program: "gateway",
        phase: "baseline-662",
        contractSha256: HEX64B,
        profiles: ["gateway-messaging", "gateway-runtime"],
      },
    ],
  });
  assert.match(
    validateInput(badContract).join(";"),
    /active row must match top-level contract/,
  );
});

test("phase none is exactly schemaVersion/program/phase", () => {
  assert.match(
    validateInput({
      schemaVersion: 1,
      program: "gateway",
      phase: "none",
      candidateBundle: { fake: true },
      artifactManifestText: "x",
      scopes: ["y"],
    }).join(";"),
    /phase none/,
  );
});

test("closed sub-objects reject unknown keys", () => {
  const manifest = activeInput({
    artifactManifest: { sha256: HEX64, bogus: 1 },
  });
  assert.match(
    validateInput(manifest).join(";"),
    /artifactManifest has unknown key/,
  );
  const bundle = {
    ...activeInput({ phase: "pr1-candidate", artifactKind: "candidate" }),
    artifactManifest: {
      sha256: HEX64,
      path: `.github/gateway-candidates/pr1-candidate/${HEX64}/manifest.json`,
    },
    candidateBundle: {
      root: `.github/gateway-candidates/pr1-candidate/${HEX64}/`,
      indexPath: `.github/gateway-candidates/pr1-candidate/${HEX64}/bundle-index.json`,
      bundleSha256: HEX64,
      bogus: 1,
    },
  };
  delete bundle.artifactManifestText;
  assert.match(
    validateInput(bundle).join(";"),
    /candidateBundle has unknown key/,
  );
  const pkg = activeInput({
    packages: [
      {
        lockLocation: "a",
        name: "b",
        version: "c",
        resolved: "d",
        integrity: "e",
        bogus: 1,
      },
    ],
  });
  assert.match(validateInput(pkg).join(";"), /packages\[0\] has unknown key/);
  const coverage = activeInput({
    programCoverage: [
      {
        program: "gateway",
        phase: "baseline-662",
        contractSha256: HEX64,
        profiles: ["gateway-messaging", "gateway-runtime"],
        bogus: 1,
      },
    ],
  });
  assert.match(
    validateInput(coverage).join(";"),
    /programCoverage\[0\] has unknown key/,
  );
});

test("candidateBundle.root must resolve under the active candidate phase", () => {
  const input = {
    ...activeInput({ phase: "pr1-candidate", artifactKind: "candidate" }),
    artifactManifest: {
      sha256: HEX64,
      path: `.github/gateway-candidates/pr2-candidate/${HEX64}/manifest.json`,
    },
    candidateBundle: {
      root: `.github/gateway-candidates/pr2-candidate/${HEX64}/`,
      indexPath: `.github/gateway-candidates/pr2-candidate/${HEX64}/bundle-index.json`,
      bundleSha256: HEX64,
    },
  };
  delete input.artifactManifestText;
  assert.match(
    validateInput(input).join(";"),
    /active candidate phase/,
  );
});

test("schema binds candidate phases to candidate and published phases to published", () => {
  const schema = JSON.parse(
    readFileSync(join(REPO, ".github", "gateway-consumer-input.schema.json"), "utf8"),
  );
  const binds = (phases, kind) =>
    schema.allOf.some(
      (branch) =>
        Array.isArray(branch?.if?.properties?.phase?.enum) &&
        phases.every((p) => branch.if.properties.phase.enum.includes(p)) &&
        branch?.then?.properties?.artifactKind?.const === kind,
    );
  const candidates = [
    "pr1-candidate",
    "pr2-candidate",
    "pr3-candidate",
    "r4-candidate",
    "r5-candidate",
    "r6-candidate",
    "r7b-candidate",
  ];
  const published = [
    "baseline-662",
    "pr1-published",
    "pr2-published",
    "pr3-published",
    "r4-published",
    "r5-published",
    "r6-published",
    "r7b-published",
  ];
  assert.equal(binds(candidates, "candidate"), true);
  assert.equal(binds(published, "published"), true);
});

test("scoped mode requires selectors; aggregate forbids them", () => {
  const scoped = activeInput({
    mode: "scoped",
    scopes: ["packages/h2a/test/gateway-consumer-ci.test.js"],
  });
  assert.deepEqual(validateInput(scoped), []);
  assert.match(
    validateInput(activeInput({ mode: "scoped" })).join(";"),
    /scopes/,
  );
  assert.match(
    validateInput(
      activeInput({ scopes: ["packages/h2a/test/gateway-consumer-ci.test.js"] }),
    ).join(";"),
    /scopes/,
  );
});
