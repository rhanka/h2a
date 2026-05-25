import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { localStorePaths, safePathSegment } from "./paths.js";

export interface SanitizeRenameEntry {
  readonly from: string;
  readonly to: string;
  readonly status: "renamed" | "would-rename" | "conflict" | "skipped";
}

export interface SanitizePathsResult {
  readonly ok: boolean;
  readonly root: string;
  readonly dryRun: boolean;
  readonly renamed: readonly SanitizeRenameEntry[];
  readonly conflicts: readonly SanitizeRenameEntry[];
}

/**
 * Container directories whose immediate children are named after ids
 * (DEC-031). For each, the child entry name is the id (a directory for
 * negotiations/contracts/engagements/inbox/outbox, a `<id>.json` file for
 * policies, a `<sid>.json` file for presence).
 */
const ID_DIR_CHILDREN = [
  "negotiations",
  "inbox",
  "outbox",
  "contracts",
  "engagements"
] as const;

const ID_FILE_CHILDREN = ["policies", "presence"] as const;

function sanitizeFileName(name: string): string {
  // Split a single trailing extension so `sess:abc.json` → `sess__abc.json`,
  // sanitizing only the id portion (the `.json` itself has no forbidden chars).
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return safePathSegment(name);
  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  return `${safePathSegment(base)}${ext}`;
}

/**
 * DEC-064: rename pre-DEC-062 store entries whose names contain `:` (or other
 * Windows-forbidden characters) to their `safePathSegment` form. This makes a
 * store created by `@sentropic/h2a-cli@<=0.1.23` usable on Windows and
 * consistent with the current layout on every OS.
 *
 * The pass is conservative:
 * - It only renames entries whose sanitized name differs from the original.
 * - If the sanitized target already exists, it records a `conflict` and does
 *   NOT overwrite (the caller decides what to do).
 * - With `dryRun`, nothing is written; entries are reported as `would-rename`.
 *
 * Pure-ish: only filesystem renames, no schema sentinel change (the layout
 * version stays "1"; this is a within-version cleanup, not a schema bump).
 */
export function sanitizeStorePaths(
  root: string,
  options: { dryRun?: boolean } = {}
): SanitizePathsResult {
  const dryRun = options.dryRun ?? false;
  const paths = localStorePaths(root);
  const renamed: SanitizeRenameEntry[] = [];
  const conflicts: SanitizeRenameEntry[] = [];

  function processContainer(container: string, isFile: boolean): void {
    if (!existsSync(container)) return;
    let entries: string[];
    try {
      entries = readdirSync(container);
    } catch {
      return;
    }
    for (const entry of entries) {
      const sanitized = isFile ? sanitizeFileName(entry) : safePathSegment(entry);
      if (sanitized === entry) continue;
      const fromPath = join(container, entry);
      const toPath = join(container, sanitized);
      // Only rename the expected kind (dir vs file) to avoid surprises.
      try {
        const st = statSync(fromPath);
        if (isFile ? !st.isFile() : !st.isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(toPath)) {
        conflicts.push({ from: fromPath, to: toPath, status: "conflict" });
        continue;
      }
      if (dryRun) {
        renamed.push({ from: fromPath, to: toPath, status: "would-rename" });
        continue;
      }
      try {
        renameSync(fromPath, toPath);
        renamed.push({ from: fromPath, to: toPath, status: "renamed" });
      } catch {
        conflicts.push({ from: fromPath, to: toPath, status: "conflict" });
      }
    }
  }

  for (const dir of ID_DIR_CHILDREN) {
    processContainer(paths[dir], false);
  }
  for (const dir of ID_FILE_CHILDREN) {
    processContainer(paths[dir], true);
  }

  return {
    ok: conflicts.length === 0,
    root,
    dryRun,
    renamed,
    conflicts
  };
}
