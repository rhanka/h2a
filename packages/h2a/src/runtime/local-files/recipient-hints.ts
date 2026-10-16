import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, opendirSync, readSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
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

function entryFile(dir: string, entry: string): string | undefined {
  if (/^[a-f0-9]{64}\.json$/.test(entry)) return join(dir, entry); // pre-slot history
  if (/^(0|[1-9][0-9]{0,3})\.slot$/.test(entry) && Number(entry.split(".")[0]) < MAX_HINT_ENTRIES) {
    return join(dir, entry, "hint.json");
  }
  return undefined;
}

/** Best-effort, one bounded attempt; history failures never escape into presence. */
export function rememberRecipient(root: string, recipient: RecipientHint): void {
  let tmp: string | undefined;
  let reserved: string | undefined;
  try {
    const hint: RecipientHint = { instance: recipient.instance, ...(recipient.name ? { name: recipient.name } : {}) };
    const bytes = JSON.stringify(hint) + "\n";
    if (Buffer.byteLength(bytes, "utf8") > MAX_HINT_BYTES) return;
    const dir = join(root, "recipient-hints");
    const file = join(dir, createHash("sha256").update(bytes).digest("hex") + ".json");
    let repairLegacy = false;
    try {
      if (readHintBytes(file) === bytes) return;
      repairLegacy = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
    mkdirSync(dir, { recursive: true });
    const entries = hintEntries(dir);
    for (const entry of entries) {
      const existing = entryFile(dir, entry);
      if (!existing) continue;
      try { if (readHintBytes(existing) === bytes) return; } catch { /* unavailable evidence */ }
    }
    if (entries.length >= MAX_HINT_ENTRIES) return;
    // Reserve the first free slot, with ONE exclusive mkdir and no retry. Writers
    // sharing a stale snapshot contend for the same slot; only one can publish.
    // Legacy files and abandoned slots consume places too. A crashed writer can
    // lose one place, never leave a global lock that disables future history.
    const occupied = new Set(entries);
    let index = 0;
    while (occupied.has(`${index}.slot`)) index++;
    const slot = join(dir, `${index}.slot`);
    mkdirSync(slot);
    reserved = slot;
    tmp = join(slot, "hint.tmp");
    const fd = openSync(tmp, "wx");
    try { writeFileSync(fd, bytes, "utf8"); } finally { closeSync(fd); }
    renameSync(tmp, repairLegacy ? file : join(slot, "hint.json"));
    if (!repairLegacy) reserved = undefined;
  } catch {
    // Only the typed refusal detail may be lost. Never prevent session open,
    // heartbeat, close or reap, and never retry storage synchronously here.
  } finally {
    if (tmp !== undefined) {
      try { unlinkSync(tmp); } catch { /* renamed or best-effort cleanup */ }
    }
    if (reserved !== undefined) {
      try { rmdirSync(reserved); } catch { /* only remove our empty reservation */ }
    }
  }
}

/** Hints survive close/restart within the budget; unavailable evidence is ignored. */
export function listRecipientHints(root: string): RecipientHint[] {
  const dir = join(root, "recipient-hints");
  let entries: string[];
  try { entries = hintEntries(dir); } catch { return []; }
  const hints: RecipientHint[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const file = entryFile(dir, entry);
    if (!file) continue;
    try {
      const bytes = readHintBytes(file);
      if (bytes === undefined || seen.has(bytes)) continue;
      const hint = JSON.parse(bytes);
      if (hint && typeof hint.instance === "string" &&
          (hint.name === undefined || typeof hint.name === "string")) {
        hints.push(hint);
        seen.add(bytes);
      }
    } catch { /* incomplete, malformed or unreadable evidence is not a known recipient */ }
  }
  return hints;
}
