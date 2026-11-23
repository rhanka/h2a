import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  THRESHOLD_MAX,
  THRESHOLD_WATCH,
} from "../scripts/change-risk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(
  resolve(HERE, "../skills/harness/test/SKILL.md"),
  "utf8"
);

test("harness/test states the same change-risk thresholds as the tool", () => {
  assert.match(SKILL, new RegExp(`Over ${THRESHOLD_MAX}: to fix`));
  assert.match(
    SKILL,
    new RegExp(`Between ${THRESHOLD_WATCH} and ${THRESHOLD_MAX}: worth a look`)
  );
  assert.match(SKILL, /CRAP = complexity/);
});
