import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateSecurityDebt } from "../../../scripts/audit-security-debt.mjs";

const PATH = "packages/example/node_modules/example";
const lockfile = { packages: { [PATH]: { version: "1.2.3" } } };
const vulnerability = {
  name: "example",
  severity: "moderate",
  nodes: [PATH],
  via: [{ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }]
};
const audit = { vulnerabilities: { example: vulnerability } };

function register(overrides = {}) {
  return {
    version: 1,
    exceptions: [{
      id: "example-debt",
      component: "example",
      severity: "moderate",
      paths: [PATH],
      installed_versions: ["1.2.3"],
      advisory_ids: ["GHSA-aaaa-bbbb-cccc"],
      owner: "@owner",
      discovered: "2026-07-01",
      review_due: "2026-07-31",
      rationale: "fixture",
      exit: "fixture exit",
      ...overrides
    }]
  };
}

test("security debt gate accepts an exact active exception", () => {
  const result = evaluateSecurityDebt({ audit, register: register(), lockfile, today: new Date("2026-07-20T00:00:00Z") });
  assert.deepEqual(result.errors, []);
});

test("security debt gate rejects unregistered moderate findings", () => {
  const result = evaluateSecurityDebt({ audit, register: { version: 1, exceptions: [] }, lockfile, today: new Date("2026-07-20T00:00:00Z") });
  assert.match(result.errors.join("\n"), /unregistered security debt/);
});

test("security debt gate rejects an expired exception", () => {
  const result = evaluateSecurityDebt({ audit, register: register(), lockfile, today: new Date("2026-08-01T00:00:00Z") });
  assert.match(result.errors.join("\n"), /expired/);
});

test("security debt gate rejects a path that drifted", () => {
  const result = evaluateSecurityDebt({ audit, register: register({ paths: ["node_modules/example"] }), lockfile, today: new Date("2026-07-20T00:00:00Z") });
  assert.match(result.errors.join("\n"), /no longer exactly matches/);
});

test("security debt gate rejects an advisory that drifted", () => {
  const result = evaluateSecurityDebt({ audit, register: register({ advisory_ids: ["GHSA-zzzz-yyyy-xxxx"] }), lockfile, today: new Date("2026-07-20T00:00:00Z") });
  assert.match(result.errors.join("\n"), /no longer exactly matches/);
});

test("security debt gate fails closed on malformed audit output", () => {
  const result = evaluateSecurityDebt({ audit: {}, register: register(), lockfile });
  assert.match(result.errors.join("\n"), /did not return a vulnerabilities object/);
});

test("security debt gate also audits the independent Focus lockfile", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["audit:security"], "node scripts/audit-security-debt.mjs && npm run audit:security:focus");
  assert.equal(packageJson.scripts["audit:security:focus"], "npm --prefix apps/focus audit --audit-level=moderate");
});
