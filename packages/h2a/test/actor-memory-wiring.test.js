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

test("every actor brief names BOTH files it must read first — COMMON.md and RECALL.md", () => {
  // A brief that drops either pointer wakes its actor without part of its memory. Review of
  // PR 90 found the RECALL.md check alone let a brief silently lose the COMMON.md pointer.
  const missingRecall = briefs().filter((name) => !read(name).includes("RECALL.md"));
  const missingCommon = briefs().filter((name) => !read(name).includes("COMMON.md"));
  assert.deepEqual(
    missingRecall,
    [],
    `these briefs do not point their actor at docs/agents/RECALL.md: ${missingRecall.join(", ")}`,
  );
  assert.deepEqual(
    missingCommon,
    [],
    `these briefs do not point their actor at docs/agents/COMMON.md: ${missingCommon.join(", ")}`,
  );
});

test("every doctrine ULID cited in RECALL.md resolves in the committed journal", () => {
  // Review of PR 90 replaced a real decision ULID inside the doctrine block with a fabricated
  // one and every test stayed green — the file whose reading rule 2 is "every entry names its
  // locator" accepted an invented locator. This test closes that: each ULID between the
  // DOCTRINE-PROJECTION markers must appear in the committed .track/events.jsonl, or it is a
  // fabricated citation. This is reading rules 2/3 made enforceable rather than habitual.
  const recall = read("RECALL.md");
  // Match the HTML-comment markers, not the prose that merely names them a few lines above.
  const block = recall.match(/<!-- DOCTRINE-PROJECTION:START -->([\s\S]*?)<!-- DOCTRINE-PROJECTION:END -->/);
  assert.ok(block, "the doctrine block must be present and bounded by its HTML-comment markers");
  // The projected TABLE rows must resolve; the "Unprojected legacy" section below the table is,
  // by definition, the part whose decision has no journal event (e.g. DOC-07), so it is excluded.
  const legacyAt = block[1].indexOf("Unprojected legacy");
  const table = legacyAt >= 0 ? block[1].slice(0, legacyAt) : block[1];
  const ulids = [...new Set(table.match(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g) ?? [])];
  assert.ok(ulids.length >= 6, `expected at least the six settled-doctrine ULIDs in the projected table, found ${ulids.length}`);
  // Resolve against the SELECTED-DECISION set, not a substring of the whole file: a doctrine row
  // is a decision whose option was selected, so a ULID that is merely present as some other event's
  // id (or a substring) must NOT count as resolving. Review mutation (c) got a non-decision id past
  // the earlier `journal.includes(id)` check; this closes it.
  const journal = readFileSync(join(REPO_ROOT, ".track", "events.jsonl"), "utf8");
  const selectedDecisionIds = new Set();
  for (const line of journal.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "decision.option-selected" && typeof ev.aggregateId === "string") {
      selectedDecisionIds.add(ev.aggregateId);
    }
  }
  const unresolved = ulids.filter((id) => !selectedDecisionIds.has(id));
  assert.deepEqual(
    unresolved,
    [],
    `these doctrine ULIDs do not resolve in .track/events.jsonl — fabricated or lost citations: ${unresolved.join(", ")}`,
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
