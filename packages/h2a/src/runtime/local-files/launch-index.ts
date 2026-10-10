/**
 * Reversible point indexes for the append-only launch logs. Offsets reference
 * the ORIGINAL records: no registration, binding, alias or audit is rewritten.
 * Old writers remain compatible: bytes after the indexed prefix are replayed.
 * Replacing a log or observing a truncation invalidates its index; corruption falls back to
 * the original reader. Immutable bucket generations and tail replay give a
 * complete snapshot even when another writer publishes a newer manifest.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, statSync, writeFileSync, type Stats
} from "node:fs";
import { join } from "node:path";
import { withLockSync } from "./locks.js";
import { getActiveMcpTrace } from "../mcp/phase-trace.js";

export type LaunchLogKind = "instances" | "bindings" | "aliases" | "keys";
type Row = Record<string, unknown>;
type Bucket = Record<string, number[]>;
type Manifest = {
  version: 1; kind: LaunchLogKind; generation: string;
  aliasOwner?: true;
  dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number;
  buckets: Record<string, { file: string; hash: string }>;
};
const digest = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
const directory = (file: string): string => `${file}.launch-index-v1`;
const manifestPath = (file: string): string => join(directory(file), "current.json");
export const launchLookupKey = (...parts: unknown[]): string => JSON.stringify(parts);

function parseManifest(raw: string): Manifest {
  const envelope = JSON.parse(raw) as { data: Manifest; hash: string };
  if (!envelope.data || digest(JSON.stringify(envelope.data)) !== envelope.hash)
    throw new Error("corrupt launch manifest");
  return envelope.data;
}

function keys(kind: LaunchLogKind, row: Row): string[] {
  switch (kind) {
    case "instances": return [launchLookupKey(row.id)];
    case "bindings": return [launchLookupKey(row.host, row.providerSessionId)];
    case "keys": return [launchLookupKey(row.instance)];
    case "aliases": return [
      launchLookupKey("instance", row.instance),
      launchLookupKey("pair", row.instance, row.legacyInstance),
      launchLookupKey("owner", row.legacyInstance),
      ...(row.adoptedKeyring ? [launchLookupKey("adopted", row.legacyInstance)] : [])
    ];
  }
}

function decode(kind: LaunchLogKind, line: string): Row | undefined {
  if (!line.trim()) return undefined;
  let row: unknown;
  try { row = JSON.parse(line); }
  catch (error) { if (kind === "instances" || kind === "keys") throw error; return undefined; }
  // Do not silently index away a valid JSON primitive that the authoritative
  // reader might reject. Refuse the derived view and retain its original policy.
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid launch row shape");
  return row as Row;
}

function prefixValid(manifest: Manifest, kind: LaunchLogKind, st: Stats): boolean {
  return manifest.version === 1 && manifest.kind === kind &&
    manifest.dev === st.dev && manifest.ino === st.ino &&
    Number.isSafeInteger(manifest.size) && manifest.size >= 0 && st.size >= manifest.size &&
    // Same-size rewrites (including a truncate/regrow) are not appends.
    (st.size > manifest.size || st.mtimeMs === manifest.mtimeMs && st.ctimeMs === manifest.ctimeMs);
}

function readRange(fd: number, start: number, end: number): Buffer {
  const buffer = Buffer.alloc(end - start);
  let read = 0;
  while (read < buffer.length) {
    const n = readSync(fd, buffer, read, buffer.length - read, start + read);
    if (!n) throw new Error("launch log changed during read");
    read += n;
  }
  return buffer;
}

function scan(buffer: Buffer, start: number, kind: LaunchLogKind): Array<{ row: Row; offset: number }> {
  const rows: Array<{ row: Row; offset: number }> = [];
  let begin = 0;
  for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10, begin)) {
    const row = decode(kind, buffer.subarray(begin, end).toString("utf8"));
    if (row) rows.push({ row, offset: start + begin });
    begin = end + 1;
  }
  return rows;
}

function readRow(fd: number, offset: number, end: number, kind: LaunchLogKind): Row | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= end) throw new Error("invalid launch offset");
  const chunks: Buffer[] = [];
  for (let pos = offset; pos < end;) {
    const chunk = readRange(fd, pos, Math.min(pos + 4096, end));
    const lf = chunk.indexOf(10);
    chunks.push(lf === -1 ? chunk : chunk.subarray(0, lf));
    if (lf !== -1) return decode(kind, Buffer.concat(chunks).toString("utf8"));
    pos += chunk.length;
  }
  throw new Error("incomplete indexed launch row");
}

function readBucket(file: string, manifest: Manifest, shard: string): Bucket {
  const entry = manifest.buckets[shard];
  if (!entry) return Object.create(null) as Bucket;
  if (!/^[0-9a-f-]+\.json$/.test(entry.file)) throw new Error("invalid launch bucket path");
  const text = readFileSync(join(directory(file), entry.file), "utf8");
  if (digest(text) !== entry.hash) throw new Error("corrupt launch bucket");
  return JSON.parse(text) as Bucket;
}

/** undefined means no valid index: callers retain their original read policy. */
export function lookupLaunchRows<T>(file: string, kind: LaunchLogKind, key: string): T[] | undefined {
  const trace = getActiveMcpTrace();
  const read = (): T[] | undefined => {
    let fd: number | undefined;
    try {
      {
        const raw = readFileSync(manifestPath(file), "utf8");
        const manifest = parseManifest(raw);
        fd = openSync(file, "r");
        const st = fstatSync(fd);
        if (!prefixValid(manifest, kind, st)) return undefined;
        if (kind === "aliases" && JSON.parse(key)[0] === "owner" && !manifest.aliasOwner) return undefined;
        const bucket = readBucket(file, manifest, digest(key).slice(0, 2));
        const offsets = bucket[key] ?? [];
        if (!Array.isArray(offsets)) throw new Error("invalid launch offsets");
        const result = new Map<number, Row>();
        // Binding routing is last-wins; registration is first-wins. Repeated
        // rows for one conversation/agent must not recreate the historical
        // scan, even when reading an older index containing every offset.
        const selected = kind === "bindings" ? offsets.slice(-1) : kind === "instances" ? offsets.slice(0, 1) : offsets;
        for (const offset of selected) {
          if (offset >= manifest.size) throw new Error("offset outside indexed prefix");
          const row = readRow(fd, offset, st.size, kind);
          if (!row || !keys(kind, row).includes(key)) throw new Error("launch offset/key mismatch");
          result.set(offset, row);
        }
        // A partial trailing append is not published yet. Replay only complete
        // lines, and retain the original log's source order / first-last policy.
        const tail = readRange(fd, manifest.size, st.size);
        if (tail.length && tail.at(-1) !== 10) return undefined;
        for (const { row, offset } of scan(tail, manifest.size, kind)) {
          if (!keys(kind, row).includes(key)) continue;
          if (kind === "instances" && result.size > 0) continue;
          if (kind === "bindings") result.clear();
          if (kind === "aliases" && JSON.parse(key)[0] === "owner" && result.size > 0) {
            const previous = result.values().next().value!;
            if (!((row.at as string) < (previous.at as string))) continue;
            result.clear();
          }
          result.set(offset, row);
        }
        closeSync(fd); fd = undefined;
        // Bucket generations are immutable and retained. A newer manifest
        // cannot invalidate this view: we replayed every complete row through
        // st.size from the same original fd. Retrying unrelated publications
        // caused bursts to exhaust the retries and fall back to a full scan.
        const current = statSync(file);
        if (current.dev !== st.dev || current.ino !== st.ino || current.size < st.size ||
          current.size === st.size && (current.mtimeMs !== st.mtimeMs || current.ctimeMs !== st.ctimeMs)) return undefined;
        return [...result.entries()].sort(([a], [b]) => a - b).map(([, row]) => row as T);
      }
    } catch { /* derived data unavailable: original log is authoritative */ }
    finally { if (fd !== undefined) closeSync(fd); }
    return undefined;
  };
  return trace ? trace.span(`${kind}_lookup`, read) : read();
}

/**
 * Build/refresh only derived files. Publication is atomic; previous bucket
 * generations remain available for in-flight readers and rollback. A repeated
 * command on unchanged logs is a no-op. Must not be called under registry or
 * identity locks: the initial scan belongs to explicit maintenance.
 */
export function buildLaunchIndex(file: string, kind: LaunchLogKind, incremental = false): void {
  mkdirSync(directory(file), { recursive: true, mode: 0o700 });
  withLockSync(join(directory(file), ".lock"), () => {
    const fd = openSync(file, "r");
    try {
      const st = fstatSync(fd);
      let previous: Manifest | undefined;
      try {
        const candidate = parseManifest(readFileSync(manifestPath(file), "utf8"));
        if (prefixValid(candidate, kind, st)) previous = candidate;
      } catch { /* first build / invalidated derived data */ }
      if (kind === "aliases" && !previous?.aliasOwner) previous = undefined;
      if (!incremental && previous) {
        try { for (const shard of Object.keys(previous.buckets)) readBucket(file, previous, shard); }
        catch { previous = undefined; }
      }
      if (previous?.size === st.size) return;
      // The append path never initiates a full scan under the caller's lock.
      if (incremental && (!previous || st.size - previous.size > 1024 * 1024)) return;
      const start = previous?.size ?? 0;
      const tail = readRange(fd, start, st.size);
      const size = start + tail.lastIndexOf(10) + 1;
      if (previous && size === previous.size) return; // unchanged partial trailing row
      const rows = scan(tail.subarray(0, size - start), start, kind);
      const changed = new Map<string, Bucket>();
      for (const { row, offset } of rows) for (const key of keys(kind, row)) {
        const shard = digest(key).slice(0, 2);
        let bucket = changed.get(shard);
        if (!bucket) {
          bucket = previous ? readBucket(file, previous, shard) : Object.create(null) as Bucket;
          changed.set(shard, bucket);
        }
        if (kind === "bindings") bucket[key] = [offset];
        else if (kind === "instances") bucket[key] ??= [offset];
        else if (kind === "aliases" && JSON.parse(key)[0] === "owner") {
          const prior = bucket[key]?.[0];
          if (prior === undefined || (row.at as string) < (readRow(fd, prior, st.size, kind)!.at as string))
            bucket[key] = [offset];
        }
        else (bucket[key] ??= []).push(offset);
      }
      const current = statSync(file);
      if (current.dev !== st.dev || current.ino !== st.ino || current.size < st.size ||
        current.size === st.size && (current.mtimeMs !== st.mtimeMs || current.ctimeMs !== st.ctimeMs))
        throw new Error("launch log replaced during indexing; retry maintenance");
      const generation = randomUUID();
      const manifest: Manifest = { version: 1, kind, generation,
        ...(kind === "aliases" ? { aliasOwner: true as const } : {}),
        dev: st.dev, ino: st.ino, size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs,
        buckets: { ...previous?.buckets } };
      for (const [shard, bucket] of changed) {
        const text = JSON.stringify(bucket);
        const name = `${generation}-${shard}.json`;
        writeFileSync(join(directory(file), name), text, { mode: 0o600 });
        manifest.buckets[shard] = { file: name, hash: digest(text) };
      }
      const temp = join(directory(file), `${generation}.tmp`);
      writeFileSync(temp, JSON.stringify({ data: manifest, hash: digest(JSON.stringify(manifest)) }), { mode: 0o600 });
      renameSync(temp, manifestPath(file));
    } finally { closeSync(fd); }
  }, incremental ? { timeoutMs: 0, reclaimStale: false } : {});
}

/** Append audit first. A crash/failed index update is recovered by tail replay. */
export function appendLaunchRow(file: string, kind: LaunchLogKind, row: unknown): void {
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  if (existsSync(manifestPath(file))) {
    try { buildLaunchIndex(file, kind, true); }
    catch { /* index failure must not roll back an already published audit row */ }
  }
}
