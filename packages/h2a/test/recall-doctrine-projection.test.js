import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATOR = resolve(HERE, "..", "..", "..", "scripts", "generate-recall-doctrine.mjs");
const FIXTURE = join(HERE, "fixtures", "recall-doctrine-projection.jsonl");

const { DOCTRINE_END, DOCTRINE_START, renderDoctrineProjection, renderDoctrineTable, replaceDoctrineTable } =
  await import(pathToFileURL(GENERATOR).href);

test("should project an exact, stable doctrine table from a frozen journal fixture", () => {
  const journal = readFileSync(FIXTURE, "utf8");
  const expected = [
    "| id | question | selected option (journal) | editorial rule (hand-written where sharper) | locator (decision ULID) | settled |",
    "|---|---|---|---|---|---|",
    "| — | Alpha decision | `B` — Alpha selected summary | — | `01J0000000000000000000000A` | 2026-02-03 |",
    "| — | Beta decision | `A` — Revised beta summary | — | `01J0000000000000000000000B` | 2026-02-03 |"
  ].join("\n");

  const options = { editorialRules: new Map() };
  assert.equal(renderDoctrineTable(journal, options), expected);
  assert.equal(renderDoctrineTable(journal, options), expected);
});

test("should replace only the bounded doctrine projection", () => {
  const journal = readFileSync(FIXTURE, "utf8");
  const table = renderDoctrineProjection(journal, { editorialRules: new Map() });
  const recall = `before\n${DOCTRINE_START}\nstale table\n${DOCTRINE_END}\nafter\n`;

  assert.equal(
    replaceDoctrineTable(recall, table),
    `before\n${DOCTRINE_START}\n${table}\n${DOCTRINE_END}\nafter\n`
  );
});
