// WP11 · Memory & context — the wake path must name the wake memory.
//
// Why this test exists, measured 2026-07-30: 73 actor brief files mentioned neither
// memory, nor history, nor RECALL — zero occurrences out of 73. The twelve durable
// actors were launched with a WP perimeter and no memory, and each paid the same
// discovery costs again. A brief is the one artefact an actor is told to read, so a
// brief that does not name the recall makes the recall optional in practice.
//
// This test REFUSES that state. It is the difference between a convention (every author
// remembers to add the pointer) and a structural guarantee (a brief without the pointer
// fails the required gate). See docs/agents/RECALL.md reading rule 8: ask what refuses.

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AGENTS_DIR = join(REPO_ROOT, "docs", "agents");

const read = (name) => readFileSync(join(AGENTS_DIR, name), "utf8");
const briefs = () =>
  readdirSync(AGENTS_DIR)
    .filter((n) => n.startsWith("BRIEF-") && n.endsWith(".md"))
    .sort();

test("the durable actor memory files are all present", () => {
  for (const required of ["RECALL.md", "DELEGATION.md", "COMMON.md"]) {
    assert.doesNotThrow(
      () => read(required),
      `docs/agents/${required} must exist: it is the durable memory of the twelve actors, and it lived in a git-ignored directory until 2026-07-29`,
    );
  }
  assert.ok(
    briefs().length >= 12,
    `expected at least the twelve durable actor briefs under docs/agents/, found ${briefs().length}`,
  );
});

test("every actor brief names the recall as required reading", () => {
  const offenders = briefs().filter((name) => !read(name).includes("RECALL.md"));
  assert.deepEqual(
    offenders,
    [],
    `these briefs do not point their actor at docs/agents/RECALL.md, so the actor wakes with no memory: ${offenders.join(", ")}`,
  );
});

test("COMMON.md, which every actor reads first, names the recall and the delegation preamble", () => {
  const common = read("COMMON.md");
  assert.ok(
    common.includes("RECALL.md"),
    "COMMON.md is the one file every actor is told to read first; it must name RECALL.md",
  );
  assert.ok(
    common.includes("DELEGATION.md"),
    "COMMON.md must name DELEGATION.md: from 2026-07-29 the lanes delegate to models that start blank",
  );
});

test("the recall keeps the reading rules that make its entries falsifiable", () => {
  const recall = read("RECALL.md");
  // Rule 2/3: an entry names its locator, and an entry whose locator does not resolve is
  // quarantined rather than believed. Rule 8: ask what refuses. Losing any of these turns
  // the file back into prose that asserts more than it proves.
  assert.match(recall, /Every entry names its locator/i);
  assert.match(recall, /quarantined, not true/i);
  assert.match(recall, /Ask what REFUSES/i);
  assert.match(
    recall,
    /DOCTRINE-PROJECTION:START[\s\S]*DOCTRINE-PROJECTION:END/,
    "the generated doctrine block must stay bounded by its markers, or the projection cannot refuse drift",
  );
});
