import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Durable addressing evidence only: never a presence or an admission source. */
export interface RecipientHint {
  readonly instance: string;
  readonly name?: string;
}

export function rememberRecipient(root: string, recipient: RecipientHint): void {
  const hint: RecipientHint = { instance: recipient.instance, ...(recipient.name ? { name: recipient.name } : {}) };
  const bytes = JSON.stringify(hint) + "\n";
  const dir = join(root, "recipient-hints");
  const file = join(dir, createHash("sha256").update(bytes).digest("hex") + ".json");
  try {
    if (readFileSync(file, "utf8") === bytes) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const fd = openSync(tmp, "wx");
  try {
    try { writeFileSync(fd, bytes, "utf8"); } finally { closeSync(fd); }
    renameSync(tmp, file);
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed or best-effort cleanup */ }
  }
}

/** Hints survive session close/GC and process restart; they can only explain a refusal. */
export function listRecipientHints(root: string): RecipientHint[] {
  const dir = join(root, "recipient-hints");
  let entries: string[];
  try { entries = readdirSync(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const hints: RecipientHint[] = [];
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue;
    try {
      const hint = JSON.parse(readFileSync(join(dir, entry), "utf8"));
      if (hint && typeof hint.instance === "string" &&
          (hint.name === undefined || typeof hint.name === "string")) hints.push(hint);
    } catch { /* incomplete, malformed or unreadable evidence is not a known recipient */ }
  }
  return hints;
}
