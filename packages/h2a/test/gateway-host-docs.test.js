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
