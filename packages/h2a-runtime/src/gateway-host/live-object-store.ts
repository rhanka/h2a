/** R1 (LIVE §4): host-owned committed objects, never an alternate or a checkout.
 * The composition owner supplies an authorized clone/scope and local source.
 * No source config, refs, hooks, transport or credentials are consulted here.
 * Receipt publication follows pack verification, private pin and durable sync.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, createWriteStream, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  validateLiveScope, validateRetentionReceipt, validateRetentionRequest,
  type LiveScope, type OidAlgorithm, type RetentionReceiptDto,
  type RetentionReceiptQuery, type RetentionRequestDto,
} from "../vendor/engram-live/contracts.js";
import type { RetentionPort } from "../vendor/engram-live/retention.js";

export interface LiveObjectStoreOptions {
  /** Existing host-managed directory, outside every observed worktree/git-dir. */
  readonly root: string;
  readonly scope: LiveScope;
  readonly algorithm: OidAlgorithm;
  readonly source: { readonly commonDir: string; readonly worktreeRoots: readonly string[] };
  /** Maximum protected object bytes, including pack indexes; no eviction. */
  readonly quotaBytes: number;
  readonly now?: () => number;
}
type Gap = "quota_exhausted" | "objects_unavailable" | "store_busy";
export interface PendingRetention { readonly request: RetentionRequestDto; readonly reason: Gap }
export interface LiveObjectStore extends RetentionPort {
  readonly gitDir: string;
  readonly acquisitionLockPath: string;
  pending(): Promise<readonly PendingRetention[]>;
  retryPending(): Promise<void>;
  /** Local backup coordination only; never a fact/publication payload. */
  backupManifest(): { readonly gitDir: string; readonly metadataDir: string; readonly scope: LiveScope };
}

const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonicalPath = (path: string): string => existsSync(path) ? realpathSync(path) : resolve(path);
const within = (parent: string, child: string): boolean => {
  const tail = relative(parent, child);
  return tail === "" || (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`));
};

function syncPath(path: string): void {
  const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durableJson(path: string, value: unknown, generation?: string): void {
  const tmp = generation ? join(generation, `${randomUUID()}.tmp`) : `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    syncPath(tmp); renameSync(tmp, path); syncPath(resolve(path, ".."));
  } finally { rmSync(tmp, { force: true }); }
}
function syncTree(path: string): void {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) syncTree(file); else syncPath(file);
  }
  syncPath(path);
}
function bytesIn(path: string): number {
  return readdirSync(path).reduce((sum, name) => {
    const file = join(path, name); const stat = statSync(file);
    return sum + (stat.isDirectory() ? bytesIn(file) : stat.size);
  }, 0);
}

// Only the observed generation is removed; age authorizes fencing, never
// concurrent shared writes. Publications consume sources in that generation.
function takeoverStaleLock(lockPath: string): void {
  let observed: string[];
  try {
    observed = readdirSync(lockPath);
    if (Date.now() - statSync(lockPath).mtimeMs <= 60_000) throw new Error("store_busy");
  } catch (error) {
    if ((error as Error).message === "store_busy") throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || !existsSync(lockPath)) throw new Error("store_busy");
    throw error;
  }
  for (const oldToken of observed) rmSync(join(lockPath, oldToken), { recursive: true, force: true });
  try { rmdirSync(lockPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("store_busy");
  }
}

export function createLiveObjectStore(options: LiveObjectStoreOptions): LiveObjectStore {
  const scope = snapshot(options.scope); const algorithm = options.algorithm;
  if (!validateLiveScope(scope).ok || scope.worktree !== undefined) throw new Error("invalid retention scope");
  if (algorithm !== "sha1" && algorithm !== "sha256") throw new Error("invalid retention algorithm");
  if (!Number.isSafeInteger(options.quotaBytes) || options.quotaBytes < 0) throw new Error("invalid object quota");
  const quota = options.quotaBytes;
  const root = realpathSync(options.root);
  const commonDir = canonicalPath(options.source.commonDir);
  for (const source of [commonDir, ...options.source.worktreeRoots.map(canonicalPath)]) {
    if (within(source, root) || within(root, source)) throw new Error("private object store must be outside source roots");
  }
  const scopeKey = createHash("sha256").update(JSON.stringify([scope.tenant, scope.clone])).digest("hex");
  const metadataDir = join(root, "live-object-store", scopeKey, algorithm);
  const gitDir = join(metadataDir, "objects.git");
  const requests = join(metadataDir, "requests"); const receipts = join(metadataDir, "receipts");
  const gaps = join(metadataDir, "gaps"); const empty = join(metadataDir, "empty");
  for (const dir of [join(root, "live-object-store"), join(root, "live-object-store", scopeKey), metadataDir, requests, receipts, gaps, empty]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const noConfig = join(metadataDir, "no-config");
  if (!existsSync(noConfig)) writeFileSync(noConfig, "", { mode: 0o600, flag: "wx" });
  // Whitelist the environment: inherited Git config, alternates, SSH commands,
  // credentials, templates and exec-path overrides must never reach Git.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: metadataDir, XDG_CONFIG_HOME: metadataDir,
    XDG_RUNTIME_DIR: metadataDir, TMPDIR: metadataDir,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: noConfig, GIT_CONFIG_GLOBAL: noConfig,
    GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1", LC_ALL: "C",
  };
  const flags = ["--no-optional-locks", "-c", `core.hooksPath=${empty}`, "-c", "core.fsmonitor=false",
    "-c", "protocol.allow=never", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
  const git = (dir: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string =>
    execFileSync("git", [...flags, `--git-dir=${dir}`, ...args], {
      cwd: metadataDir, env: { ...env, ...extraEnv }, encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1024 * 1024,
    }).trim();
  const init = (dir: string) => {
    git(dir, ["init", "--bare", `--object-format=${algorithm}`, `--template=${empty}`, dir]);
    // git init honors the caller's umask for its top directory. Create that
    // directory ourselves before invoking it (all descendants stay protected).
  };
  if (!existsSync(join(gitDir, "HEAD"))) { mkdirSync(gitDir, { mode: 0o700 }); init(gitDir); }
  mkdirSync(join(gitDir, "refs", "h2a", "retained"), { recursive: true, mode: 0o700 });
  const acquisitionLockPath = join(metadataDir, "acquisition.lock");
  const checkScope = (candidate: LiveScope, format: OidAlgorithm) => {
    if (!validateLiveScope(candidate).ok || candidate.worktree !== undefined ||
        candidate.tenant !== scope.tenant || candidate.clone !== scope.clone) throw new Error("retention scope mismatch");
    if (format !== algorithm) throw new Error("retention algorithm mismatch");
  };
  const pin = (oid: string) => `refs/h2a/retained/${oid}`;
  const backupRef = (oid: string) => `h2a-live-object:${scopeKey}:${algorithm}:${oid}`;
  const requestPath = (oid: string) => join(requests, `${oid}.json`);
  const receiptPath = (oid: string) => join(receipts, `${oid}.json`);
  const acknowledgePin = (oid: string, generation: string) => {
    durableJson(receiptPath(oid), { scope, algorithm, oid,
      receivedAt: (options.now ?? Date.now)(), backupRef: backupRef(oid) }, generation);
  };
  const readRequest = (oid: string): RetentionRequestDto => {
    const request: RetentionRequestDto = JSON.parse(readFileSync(requestPath(oid), "utf8"));
    if (!validateRetentionRequest(request).ok || request.oid !== oid) throw new Error("invalid durable retention request");
    checkScope(request.scope, request.algorithm); return request;
  };
  const verified = (dir: string, oid: string): void => {
    if (git(dir, ["cat-file", "-t", oid]) !== "commit") throw new Error("retention root must be committed history");
    // Includes parents, trees and blobs. A tip alone is never sufficient.
    git(dir, ["fsck", "--strict", "--no-reflogs", "--no-dangling", oid]);
  };

  async function recordReceipt(candidate: RetentionReceiptDto): Promise<{ received: true }> {
    const receipt = snapshot(candidate);
    if (!validateRetentionReceipt(receipt).ok) throw new Error("invalid retention receipt scope or fields");
    checkScope(receipt.scope, receipt.algorithm);
    if (!existsSync(requestPath(receipt.oid))) throw new Error("retention receipt has no recorded request");
    readRequest(receipt.oid);
    if (receipt.backupRef !== backupRef(receipt.oid)) throw new Error("retention backup reference mismatch");
    if (git(gitDir, ["rev-parse", "--verify", pin(receipt.oid)]) !== receipt.oid) throw new Error("unprotected retention pin");
    if (hasReceipt(receipt.oid)) return { received: true };
    await withAcquisitionLock(async (generation) => {
      verified(gitDir, receipt.oid);
      syncTree(gitDir);
      durableJson(receiptPath(receipt.oid), receipt, generation);
    });
    return { received: true };
  }

  // Single-receipt fast path: one file read plus one rev-parse, no full scan
  // and no fsck. recordRequest uses this instead of a full load per request.
  function hasReceipt(oid: string): boolean {
    try {
      if (!existsSync(receiptPath(oid))) return false;
      const receipt: RetentionReceiptDto = JSON.parse(readFileSync(receiptPath(oid), "utf8"));
      if (!validateRetentionReceipt(receipt).ok || receipt.oid !== oid) return false;
      if (receipt.scope.tenant !== scope.tenant || receipt.scope.clone !== scope.clone ||
          receipt.scope.worktree !== undefined || receipt.algorithm !== algorithm) return false;
      if (receipt.backupRef !== backupRef(oid)) return false;
      readRequest(oid);
      return git(gitDir, ["rev-parse", "--verify", pin(oid)]) === oid;
    } catch { return false; }
  }

  async function loadReceipts(query: RetentionReceiptQuery): Promise<{ receipts: readonly RetentionReceiptDto[] }> {
    checkScope(query.scope, query.algorithm);
    const loaded: RetentionReceiptDto[] = [];
    for (const name of readdirSync(receipts).filter((name) => name.endsWith(".json")).sort()) {
      // Quarantine: one corrupt receipt, foreign receipt, missing request or
      // missing pin skips that entry instead of failing the whole pass. The
      // skipped OID stays pending and is reacquired on retry.
      try {
        const receipt: RetentionReceiptDto = JSON.parse(readFileSync(join(receipts, name), "utf8"));
        if (!validateRetentionReceipt(receipt).ok || name !== `${receipt.oid}.json`) continue;
        if (receipt.scope.tenant !== scope.tenant || receipt.scope.clone !== scope.clone ||
            receipt.scope.worktree !== undefined || receipt.algorithm !== algorithm) continue;
        try { readRequest(receipt.oid); } catch { continue; }
        if (receipt.backupRef !== backupRef(receipt.oid)) continue;
        let pinned: string;
        try { pinned = git(gitDir, ["rev-parse", "--verify", pin(receipt.oid)]); } catch { continue; }
        if (pinned !== receipt.oid) continue;
        loaded.push(receipt);
      } catch { continue; }
    }
    return { receipts: loaded };
  }

  async function acquire(request: RetentionRequestDto, stage: string): Promise<void> {
    // This git-dir has only host-created config. Only immutable source objects
    // are exposed to pack-objects; source refs/config/index are never loaded.
    const sourceObjects = join(commonDir, "objects");
    // Borrowing a source alternate would make both authority and availability
    // ambiguous. Report a gap; never create an alternate in the private store.
    if (existsSync(join(sourceObjects, "info", "alternates"))) throw new Error("source alternates not authorized");
    const remaining = quota - bytesIn(join(gitDir, "objects"));
    if (remaining <= 0) throw new Error("quota_exhausted");
    // Exclude retained history using only host-owned refs. The private store
    // is a read-only, ephemeral alternate for this command, so exclusions
    // also work after the corresponding root disappeared from the source.
    const incoming = join(stage, "incoming.pack");
    const child = spawn("git", [...flags, `--git-dir=${stage}`, "pack-objects", "--stdout", "--revs",
      "--no-use-bitmap-index", "--no-reuse-delta", "--no-reuse-object"], {
      cwd: metadataDir, env: { ...env, GIT_OBJECT_DIRECTORY: sourceObjects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, "objects") }, stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    // Stream exclusions with backpressure: the number of retained refs has no
    // fixed ceiling and must never be limited by execFileSync's maxBuffer.
    const retained = spawn("git", [...flags, `--git-dir=${gitDir}`, "for-each-ref",
      "--format=^%(objectname)", "refs/h2a/retained"], {
      cwd: metadataDir, env, stdio: ["ignore", "pipe", "pipe"],
    });
    const retainedClosed = new Promise<number | null>((resolve, reject) => {
      retained.once("error", reject); retained.once("close", resolve);
    });
    // Drain errors, but never retain/log potentially sensitive source text.
    child.stderr.resume(); retained.stderr.resume();
    child.stdin.on("error", () => {}); child.stdin.write(`${request.oid}\n`);
    let count = 0; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); retained.kill("SIGKILL"); }, 30_000);
    const transfers = [
      pipeline(retained.stdout, child.stdin),
      pipeline(child.stdout, new Transform({ transform(chunk: Buffer, _encoding, callback) {
        count += chunk.length;
        callback(count > remaining ? new Error("quota_exhausted") : null, count > remaining ? undefined : chunk);
      } }), createWriteStream(incoming, { flags: "wx", mode: 0o600 })),
    ];
    try {
      const [code, retainedCode] = await Promise.all([closed, retainedClosed, ...transfers]);
      if (code !== 0 || retainedCode !== 0 || timedOut) throw new Error("objects_unavailable");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (retained.exitCode === null && retained.signalCode === null) retained.kill("SIGKILL");
      await Promise.allSettled([closed, retainedClosed, ...transfers]);
    }
    // index-pack writes alongside incoming; move the complete verified
    // pair into staging's object db before connectivity verification.
    writeFileSync(join(stage, "objects", "info", "alternates"), join(gitDir, "objects") + "\n", { flag: "wx", mode: 0o600 });
    const hash = git(stage, ["index-pack", "--strict", incoming]);
    const stagedPacks = join(stage, "objects", "pack");
    renameSync(incoming, join(stagedPacks, `pack-${hash}.pack`));
    renameSync(join(stage, "incoming.idx"), join(stagedPacks, `pack-${hash}.idx`));
    // Closure is verified over the incoming objects plus retained objects;
    // this alternate exists only inside the disposable acquisition generation.
    verified(stage, request.oid);
    if (bytesIn(join(gitDir, "objects")) + bytesIn(stagedPacks) > quota) throw new Error("quota_exhausted");
    // Install the pack before its index. A crash can leave an unindexed
    // orphan pack, never an index referring to an absent pack.
    for (const name of readdirSync(stagedPacks).sort((a, b) => Number(b.endsWith(".pack")) - Number(a.endsWith(".pack")))) {
      renameSync(join(stagedPacks, name), join(gitDir, "objects", "pack", name));
    }
    syncTree(join(gitDir, "objects"));
    // Every publication consumes a source in this generation. A takeover
    // removes those sources before a successor is admitted; even a holder
    // suspended inside rename cannot publish after being fenced.
    const stagedPin = join(stage, "pin");
    writeFileSync(stagedPin, request.oid + "\n", { flag: "wx", mode: 0o600 });
    syncPath(stagedPin);
    renameSync(stagedPin, join(gitDir, pin(request.oid)));
    syncPath(join(gitDir, "refs", "h2a", "retained"));
    syncPath(join(gitDir, "refs", "h2a")); syncPath(join(gitDir, "refs")); syncPath(gitDir);
    syncPath(metadataDir);
    acknowledgePin(request.oid, stage);
  }

  async function withAcquisitionLock(action: (generation: string) => Promise<void>): Promise<void> {
    const token = randomUUID();
    const candidate = `${acquisitionLockPath}.${token}.candidate`;
    const generation = join(acquisitionLockPath, token);
    let locked = false;
    try {
      mkdirSync(candidate, { mode: 0o700 });
      mkdirSync(join(candidate, token), { mode: 0o700 });
      init(join(candidate, token));
      for (;;) {
        try { renameSync(candidate, acquisitionLockPath); locked = true; break; }
        catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
        takeoverStaleLock(acquisitionLockPath);
      }
      await action(generation);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
      if (locked) {
        rmSync(generation, { recursive: true, force: true });
        try { rmdirSync(acquisitionLockPath); }
        catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      }
    }
  }

  async function recordRequest(input: RetentionRequestDto): Promise<{ received: true }> {
    const request = snapshot(input);
    if (!validateRetentionRequest(request).ok) throw new Error("invalid retention request scope or fields");
    checkScope(request.scope, request.algorithm);
    if (!existsSync(requestPath(request.oid))) durableJson(requestPath(request.oid), request);
    else readRequest(request.oid);
    if (hasReceipt(request.oid)) return { received: true };
    try {
      await withAcquisitionLock(async generation => {
        try {
          let pinned = false;
          try { pinned = git(gitDir, ["rev-parse", "--verify", pin(request.oid)]) === request.oid; } catch { /* not acquired */ }
          if (pinned) {
            // Recover a pin whose receipt was interrupted, without the source.
            verified(gitDir, request.oid); syncTree(gitDir);
            acknowledgePin(request.oid, generation);
          } else await acquire(request, generation);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code && ["EACCES", "EROFS", "EIO", "ENOSPC"].includes(code)) throw error;
          // A fenced holder cannot overwrite its successor's gap or receipt.
          if (!existsSync(generation)) return;
          const reason: Gap = (error as Error).message === "quota_exhausted" ? "quota_exhausted" : "objects_unavailable";
          try { durableJson(join(gaps, `${request.oid}.json`), { reason }, generation); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
        }
      });
    } catch (error) {
      if ((error as Error).message !== "store_busy") throw error;
      // Durable request remains pending; contention never writes a shared gap.
    }
    return { received: true };
  }
  async function pending(): Promise<readonly PendingRetention[]> {
    const acknowledged = new Set((await loadReceipts({ scope, algorithm })).receipts.map((receipt) => receipt.oid));
    return readdirSync(requests).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
      const request = readRequest(name.slice(0, -5));
      if (acknowledged.has(request.oid)) return [];
      const gapPath = join(gaps, name);
      const reason: Gap = existsSync(gapPath) ? JSON.parse(readFileSync(gapPath, "utf8")).reason : "store_busy";
      return [{ request, reason }];
    });
  }
  return { gitDir, acquisitionLockPath, recordRequest, recordReceipt, loadReceipts, pending,
    async retryPending() { for (const { request } of await pending()) await recordRequest(request); },
    backupManifest: () => ({ gitDir, metadataDir, scope: snapshot(scope) }),
  };
}
