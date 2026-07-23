import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file://${repo}/`), "utf8");

test("host capability contract has a closed, evidence-bearing state vocabulary", () => {
  const spec = read("docs/specs/2026-07-23-host-operator-capability-contract.md");
  for (const state of ["`enforced`", "`rendered`", "`guided`", "`gap`", "`not-applicable`"]) assert.match(spec, new RegExp(state));
  for (const requirement of ["Primary-source probe", "Adapter contract test", "Generated-artifact test", "Host E2E evidence"]) assert.match(spec, new RegExp(requirement));
  assert.match(spec, /never be called \*cross-host enforced\*/);
});

test("manual CLI policy reports Claude enforcement and explicit gaps elsewhere", () => {
  const spec = read("docs/specs/2026-07-23-host-operator-capability-contract.md");
  for (const [host, state] of [["Claude Code", "enforced"], ["Codex", "gap"], ["Hermes", "gap"], ["OpenCode", "gap"], ["agy", "gap"]]) {
    assert.ok(spec.includes(`| ${host} | \`${state}\``), `${host} must be ${state}`);
  }
  const guide = read("docs/host-adapter-development.md");
  assert.match(guide, /Do not emulate enforcement with a prompt, skill text, or lifecycle hook/);
});
