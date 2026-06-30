/**
 * Drumbeat D5 — append-only decision log. One record per consulted finding, so
 * the operator can audit WHY the watchdog did what it did. `decided` is the
 * decider's verdict; `applied` is what the watch actually did (advisory default
 * or the enforced action after guards). Same dir + file style as `registry.ts`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { H2AReflexiveAction } from "@sentropic/h2a";

import { localStorePaths } from "../local-files/paths.js";

export interface H2ADrumbeatDecisionRecord {
  readonly instance: string;
  readonly decided: H2AReflexiveAction;
  readonly applied: H2AReflexiveAction;
  readonly reason?: string;
  readonly decider: string;
  readonly enforced: boolean;
  readonly at: string;
}

function decisionsFile(root: string): string {
  return join(localStorePaths(root).drumbeat, "decisions.jsonl");
}

export function recordDrumbeatDecision(root: string, record: H2ADrumbeatDecisionRecord): void {
  mkdirSync(localStorePaths(root).drumbeat, { recursive: true });
  appendFileSync(decisionsFile(root), `${JSON.stringify(record)}\n`, "utf8");
}

export function listDrumbeatDecisions(root: string): H2ADrumbeatDecisionRecord[] {
  const file = decisionsFile(root);
  if (!existsSync(file)) return [];
  const out: H2ADrumbeatDecisionRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as H2ADrumbeatDecisionRecord);
    } catch {
      // skip malformed
    }
  }
  return out;
}
