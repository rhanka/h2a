import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RetentionReceiptDto, RetentionRequestDto } from "../vendor/engram-live/contracts.js";
import * as retentionEngine from "../vendor/engram-live/retention.js";
import { runRetentionPass } from "../vendor/engram-live/retention.js";
import { createLiveObjectStore } from "./live-object-store.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scope = { tenant: "local:owner", clone: "clone:fixture" };

function fixture(algorithm: "sha1" | "sha256" = "sha1") {
  const root = mkdtempSync(join(tmpdir(), "h2a-retention-")); roots.push(root);
  const repo = join(root, "source"); const managed = join(root, "managed");
  mkdirSync(managed, { mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: root, XDG_RUNTIME_DIR: root,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (...args: string[]) => execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { env, encoding: "utf8" }).trim();
  git("init", "-q", `--object-format=${algorithm}`, "--initial-branch=main", repo);
  const run = (...args: string[]) => git("-C", repo, ...args);
  const commit = (text: string) => {
    writeFileSync(join(repo, "file.txt"), text);
    run("add", "file.txt"); run("-c", "user.name=test", "-c", "user.email=test@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "-qm", text);
    return run("rev-parse", "HEAD");
  };
  const base = commit("base");
  run("checkout", "-qb", "doomed"); const oid = commit("protected history"); run("checkout", "-q", "main");
  const options = { root: managed, scope, algorithm, quotaBytes: 8 * 1024 * 1024,
    source: { commonDir: join(repo, ".git"), worktreeRoots: [repo] } };
  const request = (value = oid): RetentionRequestDto => ({ scope, algorithm, oid: value,
    firstSignal: "active-window", refName: "refs/heads/doomed", requestedAt: 123 });
  return { root, repo, managed, run, git, base, oid, options, request, commit };
}

// Complete byte/entry inventory, including ignored/untracked files, config,
// refs, objects and index. This is stronger than an empty tracked diff.
function inventory(root: string): string[] {
  const entries: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name); const stat = lstatSync(file);
      entries.push(`${relative(root, file)}:${stat.mode}:${stat.isFile() ? createHash("sha256").update(readFileSync(file)).digest("hex") : "dir"}`);
      if (stat.isDirectory()) walk(file);
    }
  }; walk(root); return entries;
}

describe("private live root retention R1", () => {
  for (const algorithm of ["sha1", "sha256"] as const) {
    it(`a deleted branch remains reconstructible after source garbage collection (${algorithm})`, async () => {
      const f = fixture(algorithm); const store = createLiveObjectStore(f.options);
      const before = inventory(f.repo);
      expect(await store.recordRequest(f.request())).toEqual({ received: true });
      expect(inventory(f.repo)).toEqual(before);
      const receipts = (await store.loadReceipts({ scope, algorithm })).receipts;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ scope, algorithm, oid: f.oid });
      f.run("branch", "-D", "doomed"); f.run("reflog", "expire", "--expire=now", "--all");
      f.run("gc", "--prune=now");
      expect(() => f.run("cat-file", "-e", f.oid)).toThrow();
      const restored = createLiveObjectStore(f.options);
      expect(await restored.loadReceipts({ scope, algorithm })).toEqual({ receipts });
      expect(f.git(`--git-dir=${restored.gitDir}`, "show", `${f.oid}:file.txt`)).toBe("protected history");
      expect(existsSync(join(restored.gitDir, "objects", "info", "alternates"))).toBe(false);
      expect(lstatSync(restored.gitDir).mode & 0o077).toBe(0);
      expect(await restored.pending()).toEqual([]);
    });
  }

  it("a removed job worktree remains reconstructible after acknowledged retention", async () => {
    const f = fixture(); const job = join(f.root, "job");
    f.run("worktree", "add", "-q", "--detach", job, f.oid);
    const store = createLiveObjectStore({ ...f.options, source: { ...f.options.source, worktreeRoots: [f.repo, job] } });
    const request = { ...f.request(), firstSignal: "worktree-head" as const, refName: null };
    const { retainBeforeJobRemoval } = await import("../delegate.js");
    expect(await retainBeforeJobRemoval(request, store, async () => { f.run("worktree", "remove", job); })).toEqual({ removed: true });
    f.run("branch", "-D", "doomed"); f.run("reflog", "expire", "--expire=now", "--all"); f.run("gc", "--prune=now");
    expect(existsSync(job)).toBe(false);
    expect(f.git(`--git-dir=${store.gitDir}`, "show", `${f.oid}:file.txt`)).toBe("protected history");
  });

  it("quota exhaustion or deletion before acquisition reports a gap without clone writes or eviction of protected roots", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request(f.base));
    const protectedReceipts = await store.loadReceipts({ scope, algorithm: "sha1" });
    const full = createLiveObjectStore({ ...f.options, quotaBytes: 1 });
    const before = inventory(f.repo);
    await full.recordRequest(f.request());
    expect(inventory(f.repo)).toEqual(before);
    expect(await full.loadReceipts({ scope, algorithm: "sha1" })).toEqual(protectedReceipts);
    expect(await full.pending()).toMatchObject([{ request: { oid: f.oid }, reason: "quota_exhausted" }]);
    const { retainBeforeJobRemoval } = await import("../delegate.js"); let removed = false;
    expect(await retainBeforeJobRemoval(f.request(), full, async () => { removed = true; })).toEqual({ removed: false, reason: "retention_gap" });
    expect(removed).toBe(false);
    await store.retryPending();
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
    const missing = f.request("f".repeat(40)); await store.recordRequest(missing);
    expect(await store.pending()).toMatchObject([{ request: { oid: missing.oid }, reason: "objects_unavailable" }]);
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
  });

  for (const quotaBytes of [128, 1024]) {
    it(`bounds streamed packs and their indexes before protection at quota ${quotaBytes}`, async () => {
      const f = fixture(); const store = createLiveObjectStore({ ...f.options, quotaBytes });
      const before = inventory(f.repo);
      await store.recordRequest(f.request());
      expect(await store.loadReceipts({ scope, algorithm: "sha1" })).toEqual({ receipts: [] });
      expect(await store.pending()).toMatchObject([{ reason: "quota_exhausted" }]);
      expect(readdirSync(join(store.gitDir, "objects", "pack"))).toEqual([]);
      expect(existsSync(store.acquisitionLockPath)).toBe(false);
      expect(inventory(f.repo)).toEqual(before);
    });
  }

  it("binds receipts and queries to the recorded request, scope, format and verified private pin", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    const bogus = { scope, algorithm: "sha1" as const, oid: f.oid, receivedAt: 1, backupRef: "invented" };
    await expect(store.recordReceipt(bogus)).rejects.toThrow(/request/);
    await store.recordRequest(f.request());
    const receipt = (await store.loadReceipts({ scope, algorithm: "sha1" })).receipts[0]!;
    await expect(store.recordReceipt({ ...receipt, backupRef: "invented" })).rejects.toThrow(/backup/);
    for (const foreign of [{ ...scope, tenant: "other" }, { ...scope, clone: "elsewhere" }, { ...scope, worktree: "wt:foreign" }]) {
      await expect(store.recordRequest({ ...f.request(), scope: foreign })).rejects.toThrow(/scope/);
      await expect(store.recordReceipt({ ...receipt, scope: foreign })).rejects.toThrow(/scope/);
      await expect(store.loadReceipts({ scope: foreign, algorithm: "sha1" })).rejects.toThrow(/scope/);
    }
    await expect(store.loadReceipts({ scope, algorithm: "sha256" })).rejects.toThrow(/algorithm/);
    const { retainBeforeJobRemoval } = await import("../delegate.js"); let removed = false;
    expect(await retainBeforeJobRemoval(f.request(), { ...store, loadReceipts: async () => ({ receipts: [{ ...receipt, scope: { ...scope, tenant: "other" } }] }) }, async () => { removed = true; })).toEqual({ removed: false, reason: "retention_gap" });
    expect(removed).toBe(false);
  });

  it("retains every root signal through the neutral port with durable restart receipts", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    const signals = ["default-branch", "active-window", "pr-head", "worktree-head", "previously-ingested"] as const;
    const oids = [f.base, f.oid];
    for (let i = 2; i < signals.length; i++) oids.push(f.commit(`root-${i}`));
    const input = { scope, now: 123, roots: signals.map((signal, i) => ({ rev: oids[i]!, qualifiedOid: { algorithm: "sha1" as const, oid: oids[i]! },
      sources: [{ signal, refName: signal === "worktree-head" ? null : "refs/heads/pinned", activityAt: null, worktreeId: null, generation: 1 }] })) };
    expect((await runRetentionPass(input, store)).state).toBe("complete");
    expect((await runRetentionPass(input, createLiveObjectStore(f.options))).stats).toEqual({ requests: 5, receipts: 5, missing: 0 });
  });

  it("ignores repository programs, remotes, replacements and uncommitted plaintext", async () => {
    const f = fixture(); const tripwire = join(f.root, "executed");
    const hook = join(f.repo, ".git", "hooks", "post-rewrite");
    writeFileSync(hook, `#!/bin/sh\ntouch '${tripwire}'\n`, { mode: 0o755 });
    f.run("config", "core.hooksPath", join(f.repo, ".git", "hooks"));
    for (const key of ["core.fsmonitor", "credential.helper", "filter.trap.process", "diff.trap.textconv", "core.sshCommand"]) f.run("config", key, `touch '${tripwire}'`);
    f.run("config", "remote.origin.url", "ext::touch never");
    writeFileSync(join(f.repo, ".gitattributes"), "* filter=trap diff=trap\n");
    writeFileSync(join(f.repo, "secret.txt"), "uncommitted plaintext");
    const secretOid = f.run("hash-object", "--no-filters", "secret.txt");
    f.run("replace", f.oid, f.base);
    const before = inventory(f.repo); const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request());
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(1);
    expect(f.git(`--git-dir=${store.gitDir}`, "show", `${f.oid}:file.txt`)).toBe("protected history");
    expect(() => f.git(`--git-dir=${store.gitDir}`, "cat-file", "-e", secretOid)).toThrow();
    expect(existsSync(tripwire)).toBe(false); expect(inventory(f.repo)).toEqual(before);
  });

  it("refuses source-overlapping storage and keeps a durable gap on missing parents or contention", async () => {
    const f = fixture();
    expect(() => createLiveObjectStore({ ...f.options, root: f.repo })).toThrow(/outside/);
    const store = createLiveObjectStore(f.options);
    mkdirSync(store.acquisitionLockPath);
    mkdirSync(join(store.acquisitionLockPath, "active-generation"));
    await store.recordRequest(f.request());
    expect(await store.pending()).toMatchObject([{ reason: "store_busy" }]);
    rmSync(store.acquisitionLockPath, { recursive: true });
    const baseObject = join(f.repo, ".git", "objects", f.base.slice(0, 2), f.base.slice(2));
    rmSync(baseObject);
    await store.retryPending();
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toEqual([]);
    expect(await store.pending()).toMatchObject([{ reason: "objects_unavailable" }]);
  });

  it("resumes an interrupted acquisition lease and reconciles a private pin before consulting a vanished source", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    mkdirSync(store.acquisitionLockPath); mkdirSync(join(store.acquisitionLockPath, "abandoned"));
    const old = new Date(Date.now() - 120_000); utimesSync(store.acquisitionLockPath, old, old);
    await store.recordRequest(f.request());
    const acknowledged = await store.loadReceipts({ scope, algorithm: "sha1" });
    expect(acknowledged.receipts).toHaveLength(1);
    // Power-loss boundary: durable pack + pin, no durable receipt yet.
    const metadata = store.backupManifest().metadataDir;
    rmSync(join(metadata, "receipts", `${f.oid}.json`));
    rmSync(f.repo, { recursive: true });
    const restarted = createLiveObjectStore(f.options);
    await restarted.retryPending();
    expect((await restarted.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(1);
    expect(await restarted.pending()).toEqual([]);
  });

  it("keeps a real deleted root pending when source GC wins acquisition, without claiming protection", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    f.run("branch", "-D", "doomed"); f.run("reflog", "expire", "--expire=now", "--all"); f.run("gc", "--prune=now");
    const before = inventory(f.repo);
    await store.recordRequest(f.request());
    expect(await store.loadReceipts({ scope, algorithm: "sha1" })).toEqual({ receipts: [] });
    expect(await createLiveObjectStore(f.options).pending()).toMatchObject([{ request: { oid: f.oid }, reason: "objects_unavailable" }]);
    expect(inventory(f.repo)).toEqual(before);
  });

  it("checks job cleanup receipts against the entry scope even when an async port mutates its arguments", async () => {
    const f = fixture(); const { retainBeforeJobRemoval } = await import("../delegate.js");
    const request = f.request(); let removed = false;
    const foreign = { ...scope, tenant: "foreign" };
    const result = retainBeforeJobRemoval(request, {
      async recordRequest(value) { Object.assign(value.scope, foreign); return { received: true }; },
      async recordReceipt() { return { received: true }; },
      async loadReceipts() { return { receipts: [{ scope: foreign, algorithm: "sha1", oid: f.oid, receivedAt: 1, backupRef: "foreign" }] }; },
    }, async () => { removed = true; });
    expect(await result).toEqual({ removed: false, reason: "retention_gap" });
    expect(removed).toBe(false);
  });

  for (const cut of ["pack", "pin", "receipt"]) {
    it(`fences a suspended real acquirer at ${cut} without writing beside its successor`, async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    const driver = fileURLToPath(new URL("./fixtures/live-object-store-child.mjs", import.meta.url));
    const loader = fileURLToPath(new URL("../../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
    const children: ReturnType<typeof launch>[] = [];
    function launch(request: RetentionRequestDto, cut: string) {
      const child = spawn(process.execPath, ["--import", loader, driver,
        new URL("./live-object-store.ts", import.meta.url).href, JSON.stringify(f.options), JSON.stringify(request), cut], {
        env: { PATH: process.env.PATH, HOME: f.root, TMPDIR: f.root, XDG_RUNTIME_DIR: f.root,
          XDG_CONFIG_HOME: f.root, XDG_STATE_HOME: f.root, H2A_ROOT: f.root }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = ""; let stderr = ""; const lines: string[] = [];
      child.stdout.on("data", chunk => {
        output += String(chunk); let end: number;
        while ((end = output.indexOf("\n")) !== -1) { lines.push(output.slice(0, end)); output = output.slice(end + 1); }
      });
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      const exited = once(child, "exit");
      return { child, exited, async message() {
        const deadline = Date.now() + 5_000;
        while (!lines.length) {
          if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) throw new Error(`missing child proof: ${stderr}`);
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        return JSON.parse(lines.shift()!);
      } };
    }
    try {
      const a = launch(f.request(), cut); children.push(a);
      expect(await a.message()).toEqual({ paused: true });
      const old = new Date(Date.now() - 120_000); utimesSync(store.acquisitionLockPath, old, old);
      const b = launch(f.request(f.base), "pin"); children.push(b);
      expect(await b.message()).toEqual({ paused: true });
      const before = inventory(store.gitDir);
      expect(a.child.kill("SIGCONT")).toBe(true);
      expect(await a.message()).toMatchObject({ done: true, writes: [], pending: expect.arrayContaining([{ request: f.request(), reason: "store_busy" }]) });
      expect(await a.exited).toEqual([0, null]);
      expect(inventory(store.gitDir)).toEqual(before);
      expect(readdirSync(store.acquisitionLockPath)).toHaveLength(1);
      const pin = () => f.git(`--git-dir=${store.gitDir}`, "rev-parse", "--verify", `refs/h2a/retained/${f.oid}`);
      if (cut === "receipt") expect(pin()).toBe(f.oid);
      else expect(pin).toThrow();
      expect(b.child.kill("SIGCONT")).toBe(true);
      expect(await b.message()).toMatchObject({ done: true }); expect(await b.exited).toEqual([0, null]);
      expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts.map(receipt => receipt.oid)).toEqual([f.base]);
      await store.retryPending();
      expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
      expect(await store.pending()).toEqual([]);
    } finally {
      await Promise.all(children.map(async ({ child, exited }) => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited;
      }));
    }
    }, 15_000);
  }

  it("excludes already retained history instead of streaming it per root", async () => {
    const f = fixture();
    f.run("checkout", "-q", "doomed");
    for (let i = 0; i < 30; i++) f.commit(`bulk-${i}`);
    const tip = f.run("rev-parse", "HEAD"); const mid = f.run("rev-parse", "HEAD~15");
    const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request(tip));
    const packs = join(store.gitDir, "objects", "pack");
    const packBytes = (dir: string) => readdirSync(dir).filter(name => name.endsWith(".pack"))
      .reduce((sum, name) => sum + readFileSync(join(dir, name)).length, 0);
    expect(packBytes(packs)).toBeGreaterThan(512);
    const before = readdirSync(packs).sort();
    // An ancestor whose history is already protected adds no full pack.
    await store.recordRequest(f.request(mid));
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
    expect(await store.pending()).toEqual([]);
    const added = readdirSync(packs).sort().filter(name => !before.includes(name) && name.endsWith(".pack"));
    const addedBytes = added.reduce((sum, name) => sum + readFileSync(join(packs, name)).length, 0);
    expect(addedBytes).toBeLessThan(512);
  });

  it("loads and reuses receipts without any fsck after acquisition", () => {
    const f = fixture();
    const driver = fileURLToPath(new URL("./fixtures/live-object-store-child.mjs", import.meta.url));
    const loader = fileURLToPath(new URL("../../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--import", loader, driver,
      new URL("./live-object-store.ts", import.meta.url).href, JSON.stringify(f.options), JSON.stringify(f.request()), "audit"], {
      env: { PATH: process.env.PATH, HOME: f.root, TMPDIR: f.root, XDG_RUNTIME_DIR: f.root,
        XDG_CONFIG_HOME: f.root, XDG_STATE_HOME: f.root, H2A_ROOT: f.root }, encoding: "utf8",
    });
    expect(JSON.parse(output.trim())).toMatchObject({ done: true, readFscks: 0, pending: [] });
  });

  it("quarantines a corrupt receipt without failing the pass", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request());
    const metadata = store.backupManifest().metadataDir;
    writeFileSync(join(metadata, "receipts", "corrupt.json"), "{invalid json");
    const orphan: RetentionReceiptDto = { scope, algorithm: "sha1", oid: f.base, receivedAt: 1,
      backupRef: "h2a-live-object:orphan:sha1:orphan" };
    writeFileSync(join(metadata, "receipts", `${f.base}.json`), JSON.stringify(orphan));
    const receipts = (await store.loadReceipts({ scope, algorithm: "sha1" })).receipts;
    expect(receipts.map(receipt => receipt.oid)).toEqual([f.oid]);
    expect(await store.pending()).toEqual([]);
    expect((await runRetentionPass({ scope, now: 123, roots: [{
      rev: f.oid, qualifiedOid: { algorithm: "sha1", oid: f.oid },
      sources: [{ signal: "active-window", refName: "refs/heads/doomed", activityAt: null, worktreeId: null, generation: 1 }],
    }] }, store)).state).toBe("complete");
  });

  it("treats a lock disappearing between readdir and stat as contention", () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    mkdirSync(store.acquisitionLockPath); mkdirSync(join(store.acquisitionLockPath, "observed"));
    const driver = fileURLToPath(new URL("./fixtures/live-object-store-child.mjs", import.meta.url));
    const loader = fileURLToPath(new URL("../../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--import", loader, driver,
      new URL("./live-object-store.ts", import.meta.url).href, JSON.stringify(f.options), JSON.stringify(f.request()), "vanish-lock"], {
      env: { PATH: process.env.PATH, HOME: f.root, TMPDIR: f.root, XDG_RUNTIME_DIR: f.root,
        XDG_CONFIG_HOME: f.root, XDG_STATE_HOME: f.root, H2A_ROOT: f.root }, encoding: "utf8",
    });
    expect(JSON.parse(output.trim())).toMatchObject({ done: true, vanished: true, pending: [{ reason: "store_busy" }] });
  });

  it("retries corrupt receipts and missing pins while preserving healthy receipts", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request()); await store.recordRequest(f.request(f.base));
    const metadata = store.backupManifest().metadataDir;
    writeFileSync(join(metadata, "receipts", `${f.oid}.json`), "invalid json");
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts.map(r => r.oid)).toEqual([f.base]);
    expect(await store.pending()).toMatchObject([{ request: { oid: f.oid } }]);
    await store.retryPending();
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
    f.git(`--git-dir=${store.gitDir}`, "update-ref", "-d", `refs/h2a/retained/${f.oid}`);
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts.map(r => r.oid)).toEqual([f.base]);
    await store.retryPending();
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
    expect(await store.pending()).toEqual([]);
  });

  for (const algorithm of ["sha1", "sha256"] as const) {
    it(`acquires a new root when retained exclusions exceed 1 MiB (${algorithm})`, async () => {
      const f = fixture(algorithm); const store = createLiveObjectStore(f.options);
      await store.recordRequest(f.request(f.base));
      // Packed aliases isolate enumeration volume from object/history volume.
      // All exclusions resolve to a real commit already in the private store.
      const count = algorithm === "sha1" ? 27_000 : 17_000;
      expect(Buffer.byteLength(`${f.base}\n`) * count).toBeGreaterThan(1024 * 1024);
      writeFileSync(join(store.gitDir, "packed-refs"), "# pack-refs with: sorted\n" +
        Array.from({ length: count }, (_, i) =>
          `${f.base} refs/h2a/retained/${i.toString(16).padStart(f.base.length, "0")}\n`).join(""));
      const before = inventory(f.repo);
      await store.recordRequest(f.request());
      expect((await store.loadReceipts({ scope, algorithm })).receipts.map(r => r.oid).sort())
        .toEqual([f.base, f.oid].sort());
      expect(await store.pending()).toEqual([]);
      expect(f.git(`--git-dir=${store.gitDir}`, "show", `${f.oid}:file.txt`)).toBe("protected history");
      expect(existsSync(store.acquisitionLockPath)).toBe(false);
      expect(inventory(f.repo)).toEqual(before);
    }, 30_000);
  }

  it("excludes a retained root even after source GC and acquires a new sibling", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    await store.recordRequest(f.request());
    f.run("branch", "-D", "doomed"); f.run("reflog", "expire", "--expire=now", "--all"); f.run("gc", "--prune=now");
    expect(() => f.run("cat-file", "-e", f.oid)).toThrow();
    const sibling = f.commit("new sibling"); const before = inventory(f.repo);
    await store.recordRequest(f.request(sibling));
    expect((await store.loadReceipts({ scope, algorithm: "sha1" })).receipts).toHaveLength(2);
    expect(inventory(f.repo)).toEqual(before);
    expect(f.git(`--git-dir=${store.gitDir}`, "show", `${sibling}:file.txt`)).toBe("new sibling");
    expect(existsSync(join(store.gitDir, "objects", "info", "alternates"))).toBe(false);
  });

  it("keeps the job-removal receipt check aligned with the neutral retention engine", async () => {
    const f = fixture(); const store = createLiveObjectStore(f.options);
    const { retainBeforeJobRemoval } = await import("../delegate.js");
    const engine = vi.spyOn(retentionEngine, "runRetentionPass");
    await store.recordRequest(f.request());
    const receipt = (await store.loadReceipts({ scope, algorithm: "sha1" })).receipts[0]!;
    const memory = (receipts: RetentionReceiptDto[]) => ({
      recordRequest: async () => ({ received: true as const }),
      recordReceipt: async () => ({ received: true as const }),
      loadReceipts: async () => ({ receipts }),
    });
    const engineState = async (port: { loadReceipts(o: unknown): Promise<{ receipts: RetentionReceiptDto[] }> }, oid: string, algorithm: "sha1" | "sha256") =>
      (await runRetentionPass({ scope, now: 123, roots: [{ rev: oid, qualifiedOid: { algorithm, oid },
        sources: [{ signal: "active-window" as const, refName: "refs/heads/doomed", activityAt: null, worktreeId: null, generation: 1 }] }] },
        port as never)).state;
    // Exact receipt satisfies both the gate and the engine.
    expect(await retainBeforeJobRemoval(f.request(), memory([receipt]), async () => {})).toEqual({ removed: true });
    expect(engine).toHaveBeenCalledTimes(1);
    engine.mockRestore();
    expect(await engineState(memory([receipt]), f.oid, "sha1")).toBe("complete");
    // Every engine dimension break refuses removal on both sides.
    for (const foreign of [{ ...scope, tenant: "other" }, { ...scope, clone: "elsewhere" }]) {
      const mutated = { ...receipt, scope: foreign };

      expect(await retainBeforeJobRemoval(f.request(), memory([mutated]), async () => {})).toEqual({ removed: false, reason: "retention_gap" });
      expect(await engineState(memory([mutated]), f.oid, "sha1")).toBe("gaps");
    }
    const wrongOid = { ...receipt, oid: f.base };
    expect(await retainBeforeJobRemoval(f.request(), memory([wrongOid]), async () => {})).toEqual({ removed: false, reason: "retention_gap" });
    expect(await engineState(memory([wrongOid]), f.oid, "sha1")).toBe("gaps");
    // Fail-closed delta: the gate additionally refuses worktree receipts.
    const worktree = { ...receipt, scope: { ...scope, worktree: "wt:foreign" } };
    expect(await retainBeforeJobRemoval(f.request(), memory([worktree]), async () => {})).toEqual({ removed: false, reason: "retention_gap" });
  });
});
