/**
 * Local binding of an h2a workspace to ONE sentropic workspace, per sentropic server.
 *
 * The local workspace is identified by its durable git identity `ws:<sha256>` (the same id
 * track and h2a compute: root commits + linked-worktree name), never by a path or a name. The
 * sentropic workspace is the id the human names explicitly (`h2a sentropic bind <id>`): a
 * pre-existing workspace is never adopted by name. The binding is a LOCAL routing choice for
 * publishing; it grants nothing — the resource server re-checks membership on every call.
 *
 * Storage: one 0600 JSON file per (server, local workspace) in a 0700 directory, written to a
 * unique temp name opened exclusively and renamed into place. A bind replaces only its own
 * slot and there is no shared map to read-modify-write, so two workspaces bound at once never
 * race; the last explicit choice for one slot wins, which is the intended semantics.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { computeDurableWorkspaceId, normalizeRootCommits } from "../conductor-launch.js";
import { serverKey } from "./auth-token.js";
import { SentropicPublishError } from "./publish-errors.js";

export interface WorkspaceBinding {
  /** The local h2a workspace: its durable `ws:<sha256>` identity. */
  readonly localWorkspace: string;
  /** The sentropic server (resource server origin) the binding routes to. */
  readonly server: string;
  /** The sentropic workspace id, as named by the human. */
  readonly workspaceId: string;
  /** The tenant (`tid`) of the account that bound it, when the token carried one. */
  readonly tenantId?: string;
  /** The account (`sub`) that bound it. */
  readonly subject?: string;
  /** ISO time of the bind. */
  readonly boundAt: string;
}

const LOCAL_WORKSPACE = /^ws:[0-9a-f]{64}$/u;
const SENTROPIC_WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function bindingError(message: string): SentropicPublishError {
  return new SentropicPublishError("binding", message);
}

export function assertLocalWorkspaceId(id: string): string {
  if (!LOCAL_WORKSPACE.test(id)) {
    throw bindingError("the local workspace must be a durable ws:<sha256> identity");
  }
  return id;
}

/** A sentropic workspace id: a plain identifier (no path, space or control characters). */
export function assertSentropicWorkspaceId(id: string): string {
  if (!SENTROPIC_WORKSPACE.test(id)) {
    throw bindingError(
      "the sentropic workspace id must be a plain identifier (letters, digits, . _ : -, at most 128 characters)",
    );
  }
  return id;
}

export function bindingsDir(dir: string): string {
  return join(dir, "h2a-bindings");
}

/** The slot of one (server, local workspace) pair; the name reveals neither. */
export function bindingFilePath(server: string, localWorkspace: string, dir: string): string {
  const slot = createHash("sha256").update(`${serverKey(server)}\n${localWorkspace}`, "utf8").digest("hex");
  return join(bindingsDir(dir), `${slot}.json`);
}

function isBinding(value: unknown): value is WorkspaceBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.localWorkspace === "string" &&
    typeof b.server === "string" &&
    typeof b.workspaceId === "string" &&
    typeof b.boundAt === "string" &&
    (b.tenantId === undefined || typeof b.tenantId === "string") &&
    (b.subject === undefined || typeof b.subject === "string")
  );
}

/**
 * The binding of `localWorkspace` on `server`, or undefined when unbound. A file that cannot be
 * read, does not parse, or records another slot's identity is reported (typed error, file path
 * only) — never parsed into a binding, and its bytes never reach the message.
 */
export function readBinding(server: string, localWorkspace: string, dir: string): WorkspaceBinding | undefined {
  const path = bindingFilePath(server, localWorkspace, dir);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw bindingError(`the binding file is unreadable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw bindingError(`the binding file is damaged (not JSON); run \`h2a sentropic unbind\`: ${path}`);
  }
  if (
    !isBinding(parsed) ||
    parsed.localWorkspace !== localWorkspace ||
    serverKey(parsed.server) !== serverKey(server) ||
    !SENTROPIC_WORKSPACE.test(parsed.workspaceId)
  ) {
    throw bindingError(`the binding file does not hold this workspace's binding; run \`h2a sentropic unbind\`: ${path}`);
  }
  return parsed;
}

/** Record `binding` (0600 file, 0700 directory, exclusive unique temp + rename). */
export function writeBinding(binding: WorkspaceBinding, dir: string): void {
  assertLocalWorkspaceId(binding.localWorkspace);
  assertSentropicWorkspaceId(binding.workspaceId);
  const record: WorkspaceBinding = { ...binding, server: serverKey(binding.server) };
  const path = bindingFilePath(record.server, record.localWorkspace, dir);
  const parent = bindingsDir(dir);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Remove the binding of `localWorkspace` on `server`. True when one was removed. */
export function removeBinding(server: string, localWorkspace: string, dir: string): boolean {
  const path = bindingFilePath(server, localWorkspace, dir);
  try {
    rmSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw bindingError(`the binding file could not be removed: ${path}`);
  }
}

function canonicalDir(cwd: string, dir: string): string {
  const abs = resolve(cwd, dir);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

export type GitRunner = (args: readonly string[], cwd: string) => { status: number | null; stdout: string };

const defaultGit: GitRunner = (args, cwd) => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    windowsHide: true,
  });
  return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "" };
};

/**
 * The durable `ws:<sha256>` identity of the git workspace at `cwd`, computed like track and
 * h2a (all root commits, sorted; "" for the primary worktree, the worktree name for a linked
 * one). Undefined outside a git repository or when git fails.
 */
export function resolveLocalWorkspaceId(cwd: string, git: GitRunner = defaultGit): string | undefined {
  try {
    const roots = git(["rev-list", "--max-parents=0", "HEAD"], cwd);
    if (roots.status !== 0) return undefined;
    const rootCommitSHA = normalizeRootCommits(roots.stdout.split("\n"));
    if (!rootCommitSHA) return undefined;
    const dir = git(["rev-parse", "--git-dir"], cwd);
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    if (dir.status !== 0 || common.status !== 0) return undefined;
    const gitDir = dir.stdout.trim();
    const commonDir = common.stdout.trim();
    if (!gitDir || !commonDir) return undefined;
    // Same rule as track (packages/track/src/workspace-id.ts): git reports these relative to cwd
    // OR absolute, inconsistently (from a subdirectory --git-dir is absolute while
    // --git-common-dir stays relative), so compare canonical absolute paths, and take the
    // worktree name from the RAW --git-dir.
    const worktreeRelPath =
      canonicalDir(cwd, gitDir) === canonicalDir(cwd, commonDir) ? "" : basename(gitDir.replace(/\/+$/u, ""));
    return computeDurableWorkspaceId(rootCommitSHA, worktreeRelPath);
  } catch {
    return undefined;
  }
}
