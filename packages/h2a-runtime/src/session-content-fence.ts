/** Explicit host-owned directory only. No global configuration or implicit owner-state path.
 * Synchronous fsync fence: uncertain consumption is never retried automatically.
 * Denials have a separate durable path so exhausted/corrupt proof storage cannot starve exclusion.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { parseStrictJson, canonicalJson } from "./session-content-json.js";
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function refuse(): never { throw new Error("content_fence_refused"); }
interface Denial { revision: number; denied: boolean }
export class ContentFence {
  private failed = false;
  constructor(private readonly directory: string) {
    const st = lstatSync(directory);
    if (!isAbsolute(directory) || !st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0
      || (process.getuid && st.uid !== process.getuid())) refuse();
    for (const name of ["denials.json", "proofs.jsonl"]) {
      try { const fd = openSync(join(directory, name), "wx", 0o600); try { writeFileSync(fd, name === "denials.json" ? "{}" : ""); fsyncSync(fd); } finally { closeSync(fd); } }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    }
    this.syncDirectory();
  }
  private syncDirectory(): void { const fd = openSync(this.directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private read(name: string, max: number): string {
    const fd = openSync(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > max || (st.mode & 0o077) !== 0
        || (process.getuid && st.uid !== process.getuid())) refuse();
      return readFileSync(fd, "utf8");
    } finally { closeSync(fd); }
  }
  private denials(): Record<string, Denial> {
    const state = parseStrictJson(this.read("denials.json", 4 * 1024 * 1024), 4 * 1024 * 1024) as Record<string, Denial>;
    if (!state || typeof state !== "object" || Array.isArray(state)) refuse();
    for (const [key, value] of Object.entries(state)) if (!/^[a-f0-9]{64}$/.test(key) || !value
      || Object.keys(value).sort().join() !== "denied,revision" || typeof value.denied !== "boolean"
      || !Number.isSafeInteger(value.revision) || value.revision < 1) refuse();
    return state;
  }
  revision(scope: string): number { if (this.failed) refuse(); return this.denials()[hash(scope)]?.revision ?? 0; }
  denied(scope: string): boolean { return this.failed || (this.denials()[hash(scope)]?.denied ?? false); }
  private locked<T>(action: () => T): T {
    const path = join(this.directory, ".fence-lock");
    const fd = openSync(path, "wx", 0o600);
    try { return action(); }
    finally { closeSync(fd); unlinkSync(path); }
  }
  private change(scope: string, denied: boolean): number {
    try { return this.locked(() => {
      const state = this.denials(), key = hash(scope), revision = (state[key]?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) refuse();
      state[key] = { revision, denied };
      const path = join(this.directory, ".denial-" + randomUUID());
      const fd = openSync(path, "wx", 0o600);
      try { writeFileSync(fd, canonicalJson(state)); fsyncSync(fd); } finally { closeSync(fd); }
      try { renameSync(path, join(this.directory, "denials.json")); this.syncDirectory(); }
      finally { try { unlinkSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
      return revision;
    }); } catch (e) { this.failed = true; throw e; }
  }
  deny(scope: string): number { return this.change(scope, true); }
  /** Clearing never activates capture; a fresh policy confirmation/ACK is still required. */
  clear(scope: string): number { return this.change(scope, false); }
  consume(scope: string, expectedRevision: number, challengeId: string, proofDigest: string): void {
    if (this.failed) refuse();
    this.locked(() => {
      const denial = this.denials()[hash(scope)];
      if ((denial?.revision ?? 0) !== expectedRevision || denial?.denied || !/^[a-f0-9]{64}$/.test(proofDigest)) refuse();
      const raw = this.read("proofs.jsonl", 8 * 1024 * 1024), challenge = hash(challengeId);
      if (raw && !raw.endsWith("\n")) refuse();
      for (const line of raw.split("\n").filter(Boolean)) {
        const row = parseStrictJson(line) as Record<string, unknown>;
        if (!row || Object.keys(row).sort().join() !== "challenge,proof" || typeof row.challenge !== "string"
          || typeof row.proof !== "string" || !/^[a-f0-9]{64}$/.test(row.challenge) || !/^[a-f0-9]{64}$/.test(row.proof)
          || row.challenge === challenge || row.proof === proofDigest) refuse();
      }
      const line = canonicalJson({ challenge, proof: proofDigest }) + "\n";
      if (Buffer.byteLength(raw) + Buffer.byteLength(line) > 8 * 1024 * 1024) refuse();
      const fd = openSync(join(this.directory, "proofs.jsonl"), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      try { appendFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
    });
  }
}
