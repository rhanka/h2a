import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Durable addressing evidence only: never a presence or an admission source. */
export interface RecipientHint {
  readonly instance: string;
  readonly name?: string;
}

// Diagnostic history has a finite storage/scan budget, not a liveness guarantee.
// At capacity we forgo new detail; existing evidence remains valid without a TTL.
const MAX_HINT_ENTRIES = 1024;
const MAX_HINT_BYTES = 16 * 1024;

function readHintBytes(file: string): string | undefined {
  // Non-blocking open also keeps an accidentally replaced FIFO from stalling MCP.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_HINT_BYTES) return undefined;
    // Bound the read even if another writer grows the file after fstat.
    const buffer = Buffer.alloc(MAX_HINT_BYTES + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    return size > MAX_HINT_BYTES ? undefined : buffer.toString("utf8", 0, size);
  } finally { closeSync(fd); }
}

function hintEntries(dir: string): string[] {
  const handle = opendirSync(dir);
  try {
    const entries: string[] = [];
    while (entries.length < MAX_HINT_ENTRIES) {
      const entry = handle.readSync();
      if (!entry) break;
      entries.push(entry.name);
    }
    return entries;
  } finally { handle.closeSync(); }
}

/** Best-effort, one bounded attempt; history failures never escape into presence. */
export function rememberRecipient(root: string, recipient: RecipientHint): void {
  let tmp: string | undefined;
  try {
    const hint: RecipientHint = { instance: recipient.instance, ...(recipient.name ? { name: recipient.name } : {}) };
    const bytes = JSON.stringify(hint) + "\n";
    if (Buffer.byteLength(bytes, "utf8") > MAX_HINT_BYTES) return;
    const dir = join(root, "recipient-hints");
    const file = join(dir, createHash("sha256").update(bytes).digest("hex") + ".json");
    try {
      if (readHintBytes(file) === bytes) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
    mkdirSync(dir, { recursive: true });
    if (hintEntries(dir).length >= MAX_HINT_ENTRIES) return;
    tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
    const fd = openSync(tmp, "wx");
    try { writeFileSync(fd, bytes, "utf8"); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } catch {
    // Only the typed refusal detail may be lost. Never prevent session open,
    // heartbeat, close or reap, and never retry storage synchronously here.
  } finally {
    if (tmp !== undefined) {
      try { unlinkSync(tmp); } catch { /* renamed or best-effort cleanup */ }
    }
  }
}

/** Hints survive close/restart within the budget; unavailable evidence is ignored. */
export function listRecipientHints(root: string): RecipientHint[] {
  const dir = join(root, "recipient-hints");
  let entries: string[];
  try { entries = hintEntries(dir); } catch { return []; }
  const hints: RecipientHint[] = [];
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
    try {
      const bytes = readHintBytes(join(dir, entry));
      if (bytes === undefined) continue;
      const hint = JSON.parse(bytes);
      if (hint && typeof hint.instance === "string" &&
          (hint.name === undefined || typeof hint.name === "string")) hints.push(hint);
    } catch { /* incomplete, malformed or unreadable evidence is not a known recipient */ }
  }
  return hints;
}
