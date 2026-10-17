import assert from "node:assert/strict";
import test from "node:test";

import {
  bindingForEvent,
  classify,
  mainEligibility,
  validateInput,
} from "../../../scripts/gateway-consumer-ci.mjs";

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
