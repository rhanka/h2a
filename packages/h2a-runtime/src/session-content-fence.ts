/**
 * Durable native action fence (cell N2).
 *
 * The fence is the native gate behind every later route: one-use action /
 * nonce consumption with atomic file commit before any ACK, byte-identical
 * dedupe, changed-identity conflict, restart replay, single-winner denial
 * races and query-only state after handoff.
 *
 * Fail-closed throughout: a corrupt or partially written journal line makes
 * the whole fence unavailable (`ledger_unavailable`, zero effect) instead of
 * trusting a prefix. Journal bytes are local durability only — they never
 * substitute for a source-gap slot and no local fill is performed.
 */

import { appendFile, mkdir, open, readFile } from "node:fs/promises";

export const FENCE_JOURNAL_NAME = "fence-journal.jsonl" as const;

export interface ConsumeArgs {
  key: string;
  digest: string;
}

export type ConsumeOutcome =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "authority_refused"
        | "ledger_unavailable"
        | "replay_refused"
        | "control_disabled"
        | "already_handed_off";
      queryOnly?: true;
    };

export type DenyOutcome =
  | { ok: true }
  | {
      ok: false;
      code: "invalid_request" | "ledger_unavailable" | "request_resolved" | "already_handed_off";
    };

export type ActionQueryStatus = "committed" | "denied" | "unknown" | "journal-unavailable";

type StoredDecision = "consumed" | "denied";

interface JournalRecord {
  v: 1;
  key: string;
  digest: string;
  decision: StoredDecision;
}

interface HandoffRecord {
  v: 1;
  handoff: true;
}

function isRecord(value: unknown): value is JournalRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return false;
  if (
    record["v"] !== 1 ||
    typeof record["key"] !== "string" ||
    (record["key"] as string).length === 0 ||
    typeof record["digest"] !== "string" ||
    (record["decision"] !== "consumed" && record["decision"] !== "denied")
  ) {
    return false;
  }
  // Denial floors carry no payload digest; consumes always bind one.
  if (record["decision"] === "consumed" && (record["digest"] as string).length === 0) {
    return false;
  }
  if (record["decision"] === "denied" && (record["digest"] as string).length !== 0) {
    return false;
  }
  return true;
}

function isHandoff(value: unknown): value is HandoffRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return false;
  return record["v"] === 1 && record["handoff"] === true;
}

function isUsableKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0;
}

function isUsableDigest(digest: unknown): digest is string {
  return typeof digest === "string" && digest.length > 0;
}

export class ContentFence {
  private available: boolean;
  private handedOff: boolean;
  private readonly journalPath: string;
  private readonly records: Map<string, { digest: string; decision: StoredDecision }>;
  private tail: Promise<void>;

  private constructor(
    journalPath: string,
    available: boolean,
    handedOff: boolean,
    records: Map<string, { digest: string; decision: StoredDecision }>,
  ) {
    this.journalPath = journalPath;
    this.available = available;
    this.handedOff = handedOff;
    this.records = records;
    this.tail = Promise.resolve();
  }

  static async open(dir: string): Promise<ContentFence> {
    const journalPath = `${dir}/${FENCE_JOURNAL_NAME}`;
    let raw: string;
    try {
      raw = await readFile(journalPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new ContentFence(journalPath, true, false, new Map());
      }
      return new ContentFence(journalPath, false, false, new Map());
    }
    const records = new Map<string, { digest: string; decision: StoredDecision }>();
    let handedOff = false;
    const lines = raw.split("\n");
    for (const line of lines) {
      if (line === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return new ContentFence(journalPath, false, false, new Map());
      }
      if (isHandoff(value)) {
        if (handedOff) {
          return new ContentFence(journalPath, false, false, new Map());
        }
        handedOff = true;
        continue;
      }
      if (!isRecord(value)) {
        return new ContentFence(journalPath, false, false, new Map());
      }
      if (handedOff || records.has(value.key)) {
        return new ContentFence(journalPath, false, false, new Map());
      }
      records.set(value.key, { decision: value.decision, digest: value.digest });
    }
    return new ContentFence(journalPath, true, handedOff, records);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async appendLine(line: string): Promise<boolean> {
    try {
      const handle = await open(this.journalPath, "a");
      try {
        await handle.appendFile(line, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    } catch {
      return false;
    }
  }

  consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
    return this.enqueue(async () => {
      if (!isUsableKey(args.key) || !isUsableDigest(args.digest)) {
        return { code: "invalid_request", ok: false } as const;
      }
      if (!this.available) return { code: "ledger_unavailable", ok: false } as const;
      if (this.handedOff) {
        return { code: "already_handed_off", ok: false, queryOnly: true } as const;
      }
      const known = this.records.get(args.key);
      if (known !== undefined) {
        if (known.decision === "denied") {
          return { code: "control_disabled", ok: false } as const;
        }
        if (known.digest === args.digest) {
          return { duplicate: true, ok: true } as const;
        }
        return { code: "replay_refused", ok: false } as const;
      }
      const persisted = await this.appendLine(
        `${JSON.stringify({ decision: "consumed", digest: args.digest, key: args.key, v: 1 })}\n`,
      );
      if (!persisted) {
        this.available = false;
        return { code: "ledger_unavailable", ok: false } as const;
      }
      this.records.set(args.key, { decision: "consumed", digest: args.digest });
      return { duplicate: false, ok: true } as const;
    });
  }

  deny(key: string): Promise<DenyOutcome> {
    return this.enqueue(async () => {
      if (!isUsableKey(key)) return { code: "invalid_request", ok: false } as const;
      if (!this.available) return { code: "ledger_unavailable", ok: false } as const;
      if (this.handedOff) return { code: "already_handed_off", ok: false } as const;
      const known = this.records.get(key);
      if (known !== undefined) {
        if (known.decision === "consumed") {
          return { code: "request_resolved", ok: false } as const;
        }
        return { ok: true } as const;
      }
      const persisted = await this.appendLine(
        `${JSON.stringify({ decision: "denied", digest: "", key, v: 1 })}\n`,
      );
      if (!persisted) {
        this.available = false;
        return { code: "ledger_unavailable", ok: false } as const;
      }
      this.records.set(key, { decision: "denied", digest: "" });
      return { ok: true } as const;
    });
  }

  markHandedOff(): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.available) return false;
      if (this.handedOff) return true;
      const persisted = await this.appendLine(`${JSON.stringify({ handoff: true, v: 1 })}\n`);
      if (!persisted) {
        this.available = false;
        return false;
      }
      this.handedOff = true;
      return true;
    });
  }

  query(key: string): ActionQueryStatus {
    if (!this.available) return "journal-unavailable";
    const known = this.records.get(key);
    if (known === undefined) return "unknown";
    return known.decision === "consumed" ? "committed" : "denied";
  }
}

/** Open (or create) the durable fence rooted at `dir`. Never touches owner state. */
export async function openContentFence(dir: string): Promise<ContentFence> {
  await mkdir(dir, { recursive: true });
  return ContentFence.open(dir);
}

/** Atomically consume one action/nonce key; byte-identical retries dedupe. */
export function consumeAction(fence: ContentFence, args: ConsumeArgs): Promise<ConsumeOutcome> {
  return fence.consume(args);
}

/** Record a denial floor; loses to an already-committed consume. */
export function denyAction(fence: ContentFence, args: { key: string }): Promise<DenyOutcome> {
  return fence.deny(args.key);
}

/** Fence all future consumes into query-only after handoff; resolves true when handoff holds. */
export function markHandedOff(fence: ContentFence): Promise<boolean> {
  return fence.markHandedOff();
}

/** Durable commit/denial lookup; never mints authority. */
export function queryAction(fence: ContentFence, key: string): ActionQueryStatus {
  return fence.query(key);
}
