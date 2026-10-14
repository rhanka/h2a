import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";

const repo = new URL("../../../", import.meta.url);
const workflow = name => YAML.parse(readFileSync(new URL(`.github/workflows/${name}`, repo), "utf8"));

test("should qualify Node 22 and 24 in CI and release with no Node 20 job", () => {
  const ci = workflow("ci.yml"), release = workflow("release.yml");
  assert.deepEqual(ci.jobs["build-and-test"].strategy.matrix.node, ["22", "24"]);
  assert.deepEqual(release.jobs.verify.strategy.matrix.node, ["22", "24"]);
  for (const name of ["ci.yml", "release.yml", "native-namespace-qualification.yml", "smoke.yml", "docker.yml", "codex-drift.yml"]) {
    for (const job of Object.values(workflow(name).jobs)) {
      for (const step of job.steps ?? []) assert.notEqual(String(step.with?.["node-version"]), "20");
    }
  }
});

for (const built of [true, false]) {
  test(`should qualify the public contract without Python or an installed fallback (build ${built})`, () => {
    const lab = mkdtempSync(join(tmpdir(), "contract-node-"));
    const bin = join(lab, "bin"), calls = join(lab, "forbidden-calls");
    for (const dir of [bin, join(lab, "scripts"), join(lab, "packages/h2a"), join(lab, "run")]) mkdirSync(dir, { recursive: true });
    cpSync(new URL("docs/contracts/golden", repo), join(lab, "docs/contracts/golden"), { recursive: true });
    cpSync(new URL("scripts/check-public-contract.sh", repo), join(lab, "scripts/check-public-contract.sh"));
    writeFileSync(join(lab, "packages/h2a/package.json"), '{"dependencies":{}}');
    // These are owned shell canaries, never a Python interpreter or an
    // installed h2a. The gate must not attempt either command.
    for (const name of ["python3", "h2a"]) writeFileSync(join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${calls}'\nexit 99\n`, { mode: 0o700 });
    if (built) {
      const dist = join(lab, "packages/h2a/dist"); mkdirSync(dist);
      writeFileSync(join(dist, "bin.js"), `console.log(require('node:fs').readFileSync(${JSON.stringify(join(lab, "docs/contracts/golden/mcp-tools.json"))},'utf8'));`);
      const verbs = JSON.parse(readFileSync(join(lab, "docs/contracts/golden/cli-verbs.json"), "utf8"));
      writeFileSync(join(dist, "cli-contract.js"), `exports.H2A_CLI_VERB_CONTRACTS=${JSON.stringify(verbs.map(verb=>({verb})))};`);
    }
    try {
      const result = spawnSync("bash", [join(lab, "scripts/check-public-contract.sh")], {
        encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME:lab, XDG_RUNTIME_DIR:join(lab,"run"), TMPDIR:lab },
      });
      assert.equal(result.status, built ? 0 : 1, result.stdout + result.stderr);
      assert.equal(existsSync(calls), false, "only Node and this checkout's local build may qualify the contract");
      if (built) assert.match(result.stdout, /CONTRAT PUBLIC OK/);
    } finally { rmSync(lab, { recursive: true, force: true }); }
  });
}

test("should build the native namespace candidate in workspace dependency order", () => {
  const steps = workflow("native-namespace-qualification.yml").jobs["native-namespaces"].steps;
  const build = steps.findIndex(step => step.run === "npm run build");
  const qualify = steps.findIndex(step => String(step.run).includes("scripts/run-namespace-qualification.mjs"));
  assert.ok(build >= 0 && build < qualify, "the normal workspace build must precede native qualification");
  assert.equal(steps[build].if, undefined);
});
