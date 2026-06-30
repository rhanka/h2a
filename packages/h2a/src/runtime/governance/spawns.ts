/**
 * Governance D3 — Conductor-spawn request store (append-only).
 *
 * Records each time h2a emits a conductor-launch-request envelope to a remote
 * agent, so the cap/cooldown guard can suppress duplicate requests within the
 * 30-minute window.
 *
 * File: `<root>/.h2a/governance/conductor-spawns.jsonl`
 * Event shape: `{ workspaceId: string, at: string, to?: string }`
 *
 * API mirrors claims.ts — append-only, no deletion, no enforcement.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalAddress, localStorePaths } from "../local-files/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnRequestEvent {
  readonly workspaceId: string;
  /** ISO 8601 timestamp when the request was emitted. */
  readonly at: string;
  /** The remote instance that received the request, if known. */
  readonly to?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function governanceDir(root: string): string {
  return join(localStorePaths(root).root, "governance");
}

function spawnsFile(root: string): string {
  return join(governanceDir(root), "conductor-spawns.jsonl");
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

/**
 * Append a conductor-spawn request event to the JSONL store.
 * Creates the governance directory if it does not exist.
 */
export function recordSpawnRequest(
  root: string,
  event: SpawnRequestEvent
): void {
  const dir = governanceDir(root);
  mkdirSync(dir, { recursive: true });
  appendFileSync(spawnsFile(root), `${JSON.stringify(event)}\n`, "utf8");
}

/**
 * Return all spawn request events for a workspace, sorted ascending by `at`.
 * Skips malformed lines. Returns an empty array if the file does not exist.
 */
function listSpawnRequests(root: string, workspaceId: string): SpawnRequestEvent[] {
  const file = spawnsFile(root);
  if (!existsSync(file)) return [];
  const wantWs = canonicalAddress(workspaceId);
  const out: SpawnRequestEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as SpawnRequestEvent;
      if (canonicalAddress(ev.workspaceId) === wantWs) {
        out.push(ev);
      }
    } catch {
      // skip malformed line
    }
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/**
 * Return the `at` timestamp of the most recent spawn request for a workspace,
 * or `undefined` if none has been recorded.
 *
 * Uses canonical comparison so the workspace id is case-fold and slug-stable.
 */
export function lastSpawnRequestAt(root: string, workspaceId: string): string | undefined {
  const events = listSpawnRequests(root, workspaceId);
  if (events.length === 0) return undefined;
  return events[events.length - 1].at;
}

// ---------------------------------------------------------------------------
// Pure cap/cooldown helper
// ---------------------------------------------------------------------------

export interface SpawnAllowedOpts {
  /** ISO 8601 timestamp of the last recorded spawn request, or undefined. */
  readonly lastSpawnAt?: string;
  /** Reference instant in ms (Date.now()). */
  readonly now: number;
  /** Cooldown window in ms (default 1 800 000 = 30 min). */
  readonly cooldownMs?: number;
}

/**
 * Pure helper: return true iff emitting a new spawn request is allowed.
 *
 * Rules:
 * - No previous request → always allowed.
 * - Previous request exists → allowed only if `now - Date.parse(lastSpawnAt) >= cooldownMs`.
 *
 * Default cooldown is 30 minutes (1 800 000 ms).
 */
export function spawnAllowed(opts: SpawnAllowedOpts): boolean {
  const { lastSpawnAt, now, cooldownMs = 1_800_000 } = opts;
  if (lastSpawnAt === undefined) return true;
  const elapsed = now - Date.parse(lastSpawnAt);
  return elapsed >= cooldownMs;
}
