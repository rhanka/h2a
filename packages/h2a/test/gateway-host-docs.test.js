import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const runtime = "../../h2a-runtime/src/";

test("launch skill documents direct defaults and cluster-mesh backend", () => {
  const skill = source("../skills/h2a-run/SKILL.md");
  assert.match(skill, /cluster-mesh/);
  assert.match(skill, /"auto"[^\n]*direct/);
  const migration = source("../../../docs/llm-mesh-account-migration.md");
  assert.match(migration, /0\.98\.1/);
  assert.match(migration, /rollback/i);
});

test("launch and review skills keep the vibe surface documented at runtime parity", () => {
  const skill = source("../skills/h2a-run/SKILL.md");
  // Every runtime h2a_run profile (pinned by mcp-run.test.js) is documented,
  // including vibe.
  for (const profile of ["claude", "codex", "agy", "muse", "vibe"]) {
    assert.match(skill, new RegExp(`\\*\\*Profile\\*\\*.*\\b${profile}\\b`));
  }
  // The vibe facts mirror the measured runtime behavior (agent-launch-args.ts,
  // agent-launch.ts): direct Mistral provider, "required" rejected, headless
  // rejected, model/effort are config concerns rather than launch argv.
  assert.match(skill, /Vibe \(Mistral Vibe CLI\) talks to the Mistral provider directly/);
  assert.match(skill, /AGY, Muse and Vibe use `"off"`, `"required"` is rejected for them/);
  assert.match(skill, /Muse and Vibe reject `true`/);
  assert.match(skill, /no launch-argv effect for `profile: "vibe"`/);
  // The harness review workflow can select and dispatch a vibe reviewer leg.
  const review = source("../skills/harness/review/SKILL.md");
  assert.match(review, /`profile: "claude"\|"codex"\|"vibe"`/);
  assert.match(review, /reviewer-host: claude\|codex\|vibe/);
  assert.match(review, /A vibe leg is always direct/);
  // The tracked integration status names vibe with its real wiring.
  const matrix = source("../../../docs/host-integration-matrix.md");
  assert.match(matrix, /^\| Vibe \| shipped\/rendered/m);
  assert.match(matrix, /post_agent/);
});
