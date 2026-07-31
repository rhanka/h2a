#!/usr/bin/env node
/**
 * Project settled doctrine from the append-only track journal into RECALL.md.
 *
 * The table deliberately has no clock: its dates come from
 * decision.option-selected events.  Editorial rules are a small, explicit
 * preservation layer for wording that is sharper than the selected option's
 * summary; every other cell comes directly from the journal.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const DOCTRINE_START = "<!-- DOCTRINE-PROJECTION:START -->";
export const DOCTRINE_END = "<!-- DOCTRINE-PROJECTION:END -->";

/**
 * These rules are copied from the pre-projection DOC-01…DOC-07 prose.  The
 * key is the journal decision ULID, so an override cannot attach to a new or
 * unrelated decision merely because its wording happens to look similar.
 */
export const EDITORIAL_RULES = new Map([
  [
    "01KY66FVKFFVKRDXY9PFGEF4RD",
    {
      id: "DOC-01",
      rule: "Several candidates match a target → **h2a refuses and prints the list**. It does not pick."
    }
  ],
  [
    "01KY66FW260Q5TV1DVR6ZPH891",
    {
      id: "DOC-02",
      rule: "\"Agent available\" requires **three** facts together: the tmux pane exists, the agent process runs, and there was recent MCP activity."
    }
  ],
  [
    "01KYNGMC6979YKMXV8MQQ8A16H",
    {
      id: "DOC-03",
      rule: "A name resolves in **one pass** against four namespaces — h2a role, `run --name`, CLI-native name, tmux session name — and h2a shows which one matched. ⚠ **DECIDED, NOT IMPLEMENTED:** `resolveRecipient({ target, liveInstances, registeredInstances })` takes no name and no workspace — it matches a target string against instance-id lists. Verified in `packages/h2a/src/runtime/local-files/paths.ts`. Do not cite this as behaviour."
    }
  ],
  [
    "01KYNGMCB0Z7ESGYJKFVCTW8MH",
    {
      id: "DOC-04",
      rule: "Known prefixes (`remote-`, `h2a-`) are **stripped before comparison**; nothing is renamed. ⚠ **DECIDED, NOT IMPLEMENTED:** no prefix logic exists in the resolver (same locator as DOC-03). `graphify` attributed a real cross-repo name collision to this stripping — a mechanism that does not yet exist. Citing a decided-but-unbuilt rule as a cause sends the fix to the wrong place."
    }
  ],
  [
    "01KYQ5RRN67190YMZ08EGGBSBT",
    {
      id: "DOC-05",
      rule: "An item closed without human validation **can be reopened**: `done → in-progress` and `cancelled → in-progress` become legal, the reopening event carries its reason, nothing is erased. *Decided; implementation in flight on `fix/track-reopen-closed-item`, **not merged** into `origin/main` — so a WP percentage can still be wrong in its own favour. See REC-05.*"
    }
  ],
  [
    "01KYQ89WANWD257Y3GCW7YM8BZ",
    {
      id: "DOC-06",
      rule: "Twelve durable actors: four transverse (`architect` WP6, `conductor` WP4, `harness` WP9, `cyber` no WP) and eight domain lanes (`coop` WP1-3, `runtime` WP5+7, `track` WP8, `plugins` WP10, `memory` WP11, `portal` WP12, `agents` WP13, `gateway` WP14)."
    }
  ],
  [
    "01KYQZXCEZJXYAJ04YB5YMEWK0",
    {
      id: "DOC-07",
      rule: "**Durable actor memory lives at the tracked path `docs/agents/`, and only the durable part.** `tmp/` stays ignored — the test runner writes `tmp/test-runtime` and worktrees live under `tmp/worktrees`, so un-ignoring it would version scratch. Tracked: `COMMON.md`, the twelve actor briefs, `RECALL.md`, `DELEGATION.md`, `launch.sh`. **Deliberately NOT tracked: per-task subcontract briefs** — they are written for one delegation and die with it, and versioning them would turn a working directory into a graveyard. The line is durability, not importance. Short-name aliases (`BRIEF-arch.md`, `BRIEF-cond.md`) were byte-identical copies of the canonical files and are not carried over: one file per actor, or the copies drift. Its decision now resolves on `origin/main` (recovered 2026-07-31); this row promotes from legacy to the projected table at the next regeneration against main — see REC-12."
    }
  ]
]);

function asObject(value, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function asString(value, context) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function selectedDate(at, decisionId) {
  const timestamp = asString(at, `decision ${decisionId} selection time`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) {
    throw new Error(`decision ${decisionId} selection time is not an ISO timestamp`);
  }
  return timestamp.slice(0, 10);
}

function tableCell(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/**
 * Fold the journal's decision events in stream order.  `dossier.revised` is
 * last-write-wins, matching Track's decision fold, so a revision after option
 * selection supplies the option summary shown in the doctrine projection.
 */
export function projectDoctrine(eventsJsonl, { editorialRules = EDITORIAL_RULES } = {}) {
  const decisions = new Map();
  const lines = String(eventsJsonl).split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    if (rawLine.trim() === "") continue;

    let event;
    try {
      event = JSON.parse(rawLine);
    } catch (error) {
      throw new Error(`journal line ${index + 1} is not valid JSON: ${error.message}`);
    }

    if (event.aggregate !== "decision") continue;
    const decisionId = asString(event.aggregateId, `journal line ${index + 1} decision id`);
    const payload = asObject(event.payload, `journal line ${index + 1} payload`);
    const current = decisions.get(decisionId) ?? { id: decisionId };

    if (event.type === "decision.created") {
      current.title = asString(payload.title, `decision ${decisionId} title`);
      current.dossier = asObject(payload.dossier, `decision ${decisionId} dossier`);
    } else if (event.type === "dossier.revised") {
      current.dossier = asObject(payload.dossier, `decision ${decisionId} revised dossier`);
    } else if (event.type === "decision.option-selected") {
      current.selection = {
        optionId: asString(payload.optionId, `decision ${decisionId} selected option id`),
        at: asString(event.at, `decision ${decisionId} selection time`)
      };
    }

    decisions.set(decisionId, current);
  }

  const projection = [];
  for (const decision of decisions.values()) {
    if (decision.selection === undefined) continue;
    if (decision.title === undefined || decision.dossier === undefined) {
      throw new Error(`selected decision ${decision.id} has no decision.created event`);
    }

    const options = decision.dossier.options;
    if (!Array.isArray(options)) {
      throw new Error(`selected decision ${decision.id} has no dossier options`);
    }
    const option = options.find((candidate) => candidate?.id === decision.selection.optionId);
    if (option === undefined) {
      throw new Error(`selected option ${decision.selection.optionId} is absent from decision ${decision.id}`);
    }

    const editorial = editorialRules.get(decision.id);
    projection.push({
      id: editorial?.id ?? "—",
      question: decision.title,
      optionId: decision.selection.optionId,
      optionSummary: asString(option.summary, `decision ${decision.id} selected option summary`),
      editorialRule: editorial?.rule ?? "—",
      locator: decision.id,
      settled: selectedDate(decision.selection.at, decision.id)
    });
  }

  return projection.sort((left, right) => {
    if (left.settled < right.settled) return -1;
    if (left.settled > right.settled) return 1;
    if (left.locator < right.locator) return -1;
    if (left.locator > right.locator) return 1;
    return 0;
  });
}

export function renderDoctrineTable(eventsJsonl, options) {
  const rows = projectDoctrine(eventsJsonl, options);
  const header = [
    "| id | question | selected option (journal) | editorial rule (hand-written where sharper) | locator (decision ULID) | settled |",
    "|---|---|---|---|---|---|"
  ];
  const body = rows.map((row) =>
    `| ${tableCell(row.id)} | ${tableCell(row.question)} | \`${tableCell(row.optionId)}\` — ${tableCell(row.optionSummary)} | ${tableCell(row.editorialRule)} | \`${tableCell(row.locator)}\` | ${row.settled} |`
  );
  return [...header, ...body].join("\n");
}

export function renderDoctrineProjection(eventsJsonl, { editorialRules = EDITORIAL_RULES } = {}) {
  const rows = projectDoctrine(eventsJsonl, { editorialRules });
  const table = renderDoctrineTable(eventsJsonl, { editorialRules });
  const projectedLocators = new Set(rows.map((row) => row.locator));
  const unprojectedEditorialRules = [...editorialRules.entries()]
    .filter(([locator]) => !projectedLocators.has(locator))
    .sort(([, left], [, right]) => {
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });

  if (unprojectedEditorialRules.length === 0) return table;

  const legacyRules = unprojectedEditorialRules.map(([locator, editorial]) =>
    `- \`${editorial.id}\` is not a doctrine row because \`${locator}\` has no ` +
      `\`decision.option-selected\` event in this journal. Its preserved hand-written wording is: ${editorial.rule}`
  );
  return `${table}\n\n**Unprojected legacy rules — not doctrine.** They remain visible so a missing journal ` +
    `event cannot silently erase their phrasing; if the event arrives, the generator moves the rule into ` +
    `the table.\n\n${legacyRules.join("\n")}`;
}

export function replaceDoctrineTable(recallContent, table) {
  const start = recallContent.indexOf(DOCTRINE_START);
  const end = recallContent.indexOf(DOCTRINE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`RECALL.md must contain ${DOCTRINE_START} followed by ${DOCTRINE_END}`);
  }
  if (recallContent.indexOf(DOCTRINE_START, start + DOCTRINE_START.length) !== -1) {
    throw new Error(`RECALL.md contains more than one ${DOCTRINE_START} marker`);
  }
  if (recallContent.indexOf(DOCTRINE_END, end + DOCTRINE_END.length) !== -1) {
    throw new Error(`RECALL.md contains more than one ${DOCTRINE_END} marker`);
  }

  return `${recallContent.slice(0, start + DOCTRINE_START.length)}\n${table}\n${recallContent.slice(end)}`;
}

function main(argv) {
  const check = argv.includes("--check");
  const stdout = argv.includes("--stdout");
  if (argv.some((argument) => argument !== "--check" && argument !== "--stdout")) {
    throw new Error("usage: node scripts/generate-recall-doctrine.mjs [--check|--stdout]");
  }
  if (check && stdout) {
    throw new Error("--check and --stdout cannot be used together");
  }

  const eventsPath = resolve(REPO_ROOT, ".track", "events.jsonl");
  const recallPath = resolve(REPO_ROOT, "docs", "agents", "RECALL.md");
  const projection = renderDoctrineProjection(readFileSync(eventsPath, "utf8"));

  if (stdout) {
    process.stdout.write(`${projection}\n`);
    return;
  }

  const current = readFileSync(recallPath, "utf8");
  const rendered = replaceDoctrineTable(current, projection);
  if (check) {
    if (rendered !== current) {
      throw new Error("RECALL.md doctrine projection is stale; run node scripts/generate-recall-doctrine.mjs");
    }
    process.stdout.write("RECALL.md doctrine projection is current\n");
    return;
  }

  if (rendered === current) {
    process.stdout.write("RECALL.md doctrine projection is already current\n");
    return;
  }
  writeFileSync(recallPath, rendered, "utf8");
  process.stdout.write("RECALL.md doctrine projection updated\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`generate-recall-doctrine: ${error.message}\n`);
    process.exitCode = 1;
  }
}
