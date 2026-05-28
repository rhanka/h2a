/**
 * Durable blockage registry (DEC-092, EVO-3). Parallel to the drumbeat
 * registry: a peer's blockage must outlive the ~15s presence sweep so other
 * agents can see it and help. Stored at `<root>/.h2a/blockage/<safe-instance>.json`.
 * The `NotificationDispatcher` diffs this directory to push `peer.blocked` /
 * `peer.unblocked` to subscribed peers (DEC-052).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { H2ABlockage } from "@sentropic/h2a";

import { localStorePaths, safePathSegment } from "../local-files/paths.js";

function entryFile(root: string, instance: string): string {
  return join(localStorePaths(root).blockage, `${safePathSegment(instance)}.json`);
}

function ensureDir(root: string): void {
  mkdirSync(localStorePaths(root).blockage, { recursive: true });
}

export interface RaiseBlockageInput {
  readonly instance: string;
  readonly scope: string;
  readonly reason: string;
  readonly needs?: string;
}

/**
 * Raise (upsert) a blockage. A fresh raise clears any prior resolution — the
 * agent is blocked again, on possibly a new reason.
 */
export function raiseBlockage(
  root: string,
  input: RaiseBlockageInput,
  now: number = Date.now()
): H2ABlockage {
  ensureDir(root);
  const blockage: H2ABlockage = {
    instance: input.instance,
    scope: input.scope,
    reason: input.reason,
    ...(input.needs ? { needs: input.needs } : {}),
    raisedAt: new Date(now).toISOString()
  };
  writeFileSync(entryFile(root, input.instance), `${JSON.stringify(blockage, null, 2)}\n`, "utf8");
  return blockage;
}

export function readBlockage(root: string, instance: string): H2ABlockage | undefined {
  const file = entryFile(root, instance);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as H2ABlockage;
  } catch {
    return undefined;
  }
}

export function listBlockages(root: string): H2ABlockage[] {
  const dir = localStorePaths(root).blockage;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: H2ABlockage[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), "utf8")) as H2ABlockage);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/**
 * Resolve a blockage (idempotent). Returns the resolved blockage, or undefined
 * if the instance has none recorded. Re-resolving keeps the first resolution.
 */
export function resolveBlockage(
  root: string,
  instance: string,
  options: { by?: string; now?: number } = {}
): H2ABlockage | undefined {
  const current = readBlockage(root, instance);
  if (!current) return undefined;
  if (current.resolvedAt !== undefined) return current;
  const resolved: H2ABlockage = {
    ...current,
    resolvedAt: new Date(options.now ?? Date.now()).toISOString(),
    ...(options.by ? { resolvedBy: options.by } : {})
  };
  writeFileSync(entryFile(root, instance), `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
  return resolved;
}
