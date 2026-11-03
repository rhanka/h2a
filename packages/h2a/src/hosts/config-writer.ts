import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { replaceJsonEntry } from "./json-entry.js";

export class HostConfigConflict extends Error {}

/** Explicit opt-in writer. Never removes another MCP entry or rewrites its bytes. */
export function writeHostMcpEntry(path: string, incoming: unknown, allowTracked: boolean): { backupPath?: string } {
  const target = resolve(path);
  const parent = dirname(target);
  if (existsSync(target) && !lstatSync(target).isFile()) {
    throw new HostConfigConflict("host config must be a regular file (symlinks are refused)");
  }
  if (existsSync(parent)) {
    try {
      execFileSync("git", ["--literal-pathspecs", "-C", realpathSync(parent), "ls-files", "--error-unmatch", "--", basename(target)], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, LC_ALL: "C" } });
      if (!allowTracked) throw new HostConfigConflict("git-tracked host config requires --allow-tracked");
    } catch (error) {
      if (error instanceof HostConfigConflict) throw error;
      const { status, stderr } = error as { status?: number; stderr?: Buffer };
      const outsideRepo = status === 128 && stderr?.toString().includes("not a git repository");
      if (status !== 1 && !outsideRepo) throw new HostConfigConflict("cannot verify whether host config is git-tracked");
    }
  }
  const existed = existsSync(target);
  const original = existed ? readFileSync(target) : undefined;
  let edited: string;
  try {
    const text = original?.toString("utf8") ?? "{}\n";
    if (original && !Buffer.from(text).equals(original)) throw new Error("host config is not valid UTF-8");
    edited = replaceJsonEntry(text, ["mcpServers", "h2a"], incoming);
  } catch (error) {
    throw new HostConfigConflict(`cannot preserve host config: ${(error as Error).message}`);
  }
  if (original?.equals(Buffer.from(edited))) return {};
  const mode = existed ? lstatSync(target).mode & 0o777 : 0o600;
  mkdirSync(parent, { recursive: true });
  const backupPath = original ? `${target}.backup-${randomUUID()}` : undefined;
  if (backupPath) writeFileSync(backupPath, original!, { flag: "wx", mode: 0o600 });
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(staging, edited, { flag: "wx", mode });
    chmodSync(staging, mode);
    if (existed ? !lstatSync(target).isFile() || !readFileSync(target).equals(original!) : existsSync(target)) {
      throw new HostConfigConflict("host config changed while preparing the edit; refusing to overwrite it");
    }
    renameSync(staging, target);
  } finally {
    try { unlinkSync(staging); } catch { /* rename consumed staging */ }
  }
  return backupPath ? { backupPath } : {};
}
