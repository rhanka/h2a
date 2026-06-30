/**
 * Durable, path/machine-independent workspace id derived from git history.
 *
 * DESIGN:
 *  - The pure function `computeDurableWorkspaceId` is I/O-free and unit-testable
 *    with no filesystem dependency.
 *  - The I/O function `durableWorkspaceId` runs git commands (execFileSync) and
 *    returns undefined on any error (git absent / not a repo / command failure).
 *  - The core package (@sentropic/h2a) stays pure — no git/fs is added there.
 *
 * DERIVATION (pinned with track):
 *   workspaceId = "ws:" + sha256hex( rootCommitSHA + "\n" + worktreeRelPath )
 *
 *   rootCommitSHA : all root commits from `git rev-list --max-parents=0 HEAD`,
 *                   sorted ascending, joined with ",". Invariant across
 *                   clones / paths / machines.
 *
 *   worktreeRelPath: "" for the main worktree; the worktree NAME (basename of
 *                   the .git/worktrees/<name> dir) for a linked worktree.
 *                   Contains no absolute path.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Pure (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Compute the durable workspace id from pre-fetched git values.
 *
 * @param rootCommitSHA All root commit SHAs, sorted ascending, joined with ","
 *                      (single root is the single SHA).
 * @param worktreeRelPath "" for the main worktree; the worktree name for a
 *                        linked worktree.
 * @returns "ws:" + sha256hex(rootCommitSHA + "\n" + worktreeRelPath)
 */
export function computeDurableWorkspaceId(
  rootCommitSHA: string,
  worktreeRelPath: string
): string {
  const payload = rootCommitSHA + "\n" + worktreeRelPath;
  const hash = createHash("sha256").update(payload, "utf8").digest("hex");
  return "ws:" + hash;
}

// ---------------------------------------------------------------------------
// I/O (git commands, never throws)
// ---------------------------------------------------------------------------

/**
 * Run git commands to derive the durable workspace id for `cwd`.
 *
 * Returns `undefined` if:
 * - git is unavailable (git not installed, PATH issue, Windows no-git)
 * - `cwd` is not inside a git repository
 * - any git command fails for any reason
 *
 * On success returns `computeDurableWorkspaceId(rootCommitSHA, worktreeRelPath)`.
 */
export function durableWorkspaceId(cwd: string): string | undefined {
  // Resolve the real path for the git -C argument, but don't propagate errors.
  let resolvedCwd: string;
  try {
    resolvedCwd = realpathSync(cwd);
  } catch {
    resolvedCwd = cwd;
  }

  // Git spawn options: inherit nothing from the calling process's I/O,
  // never hang on stdin, and use a generous but finite timeout (5 s).
  const spawnOpts = {
    cwd: resolvedCwd,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true
  };

  // --- rootCommitSHA -------------------------------------------------------
  let rootCommitSHA: string;
  try {
    const raw = execFileSync(
      "git",
      ["-C", resolvedCwd, "rev-list", "--max-parents=0", "HEAD"],
      spawnOpts
    )
      .toString("utf8")
      .trim();
    if (!raw) return undefined;
    // Sort ascending so multiple root commits (shallow octopus merges) are
    // deterministic regardless of the output order.
    const lines = raw.split(/\r?\n/).filter(Boolean).sort();
    rootCommitSHA = lines.join(",");
  } catch {
    return undefined;
  }

  // --- worktreeRelPath -----------------------------------------------------
  let worktreeRelPath: string;
  try {
    // git-dir is the effective .git directory (or .git/worktrees/<name> for a
    // linked worktree).
    const gitDir = execFileSync(
      "git",
      ["-C", resolvedCwd, "rev-parse", "--git-dir"],
      spawnOpts
    )
      .toString("utf8")
      .trim();

    // git-common-dir is always the top-level .git directory (same as git-dir
    // for the main worktree).
    const gitCommonDir = execFileSync(
      "git",
      ["-C", resolvedCwd, "rev-parse", "--git-common-dir"],
      spawnOpts
    )
      .toString("utf8")
      .trim();

    // Resolve both to real (absolute) paths before comparing; git may return
    // relative paths such as ".git".
    let resolvedGitDir: string;
    let resolvedCommonDir: string;
    try {
      resolvedGitDir = realpathSync(
        gitDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(gitDir)
          ? gitDir
          : `${resolvedCwd}/${gitDir}`
      );
    } catch {
      resolvedGitDir = gitDir;
    }
    try {
      resolvedCommonDir = realpathSync(
        gitCommonDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(gitCommonDir)
          ? gitCommonDir
          : `${resolvedCwd}/${gitCommonDir}`
      );
    } catch {
      resolvedCommonDir = gitCommonDir;
    }

    if (resolvedGitDir === resolvedCommonDir) {
      // Main worktree — no relative path embedded.
      worktreeRelPath = "";
    } else {
      // Linked worktree: .git/worktrees/<name>
      // basename of resolvedGitDir is the worktree name, which is stable and
      // contains no absolute path.
      worktreeRelPath = basename(resolvedGitDir);
    }
  } catch {
    return undefined;
  }

  return computeDurableWorkspaceId(rootCommitSHA, worktreeRelPath);
}
