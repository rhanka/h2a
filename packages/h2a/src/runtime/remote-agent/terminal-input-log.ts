/**
 * LH-09a persistent input deduplication log.
 *
 * Stores per-incarnation JSONL under `<root>/remote-control/input-log/` (0700 dir, 0600 files).
 * Enforces R11 bounded retention:
 * - Active epoch: at most 512 unacknowledged entries + 256 most recent acknowledged entries.
 * - Ended epochs: acknowledged entries pruned; at most 4 most recent ended epochs retained (FIFO).
 * - Total retained entries per (sid, incarnation) never exceed 2 816.
 * - Compaction rewrites under `withLockSync` when file lines > 2 * keptEntries + 64.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from "node:fs";
import { join } from "node:path";

import { withLockSync } from "../local-files/locks.js";

export const INPUT_LOG_MAX_UNACKED = 512 as const;
export const INPUT_LOG_MAX_RECENT_ACKED = 256 as const;
export const INPUT_LOG_MAX_ENDED_EPOCHS = 4 as const;
export const INPUT_LOG_COMPACT_SLACK_LINES = 64 as const;

export type InputLogEntryResult = "applied" | "refused" | "uncertain";

export interface InputLogEntry {
  readonly inSeq: number;
  readonly result: InputLogEntryResult;
  readonly reason?: string;
}

export type EpochEndReason = "taken-back" | "idle-released" | "lost-link" | "released";

export type EpochStatus =
  | {
      readonly status: "active";
      readonly nextInSeq: number;
      readonly maxAckedInSeq: number;
      readonly prunedThroughInSeq: number;
    }
  | { readonly status: "ended"; readonly reason: EpochEndReason; readonly maxInSeq: number }
  | { readonly status: "evicted" }
  | { readonly status: "unknown" };

export type ClassifyInSeqResult =
  | { readonly kind: "pruned" }
  | { readonly kind: "present"; readonly entry: InputLogEntry }
  | { readonly kind: "hole" }
  | { readonly kind: "next" }
  | { readonly kind: "ahead" };

export interface ReplayAfterResult {
  readonly entries: readonly InputLogEntry[];
  readonly syncedThroughInSeq: number;
  readonly evicted: boolean;
  readonly endReason?: EpochEndReason;
}

export interface TerminalInputLog {
  filePath(): string;
  highestOpenedEpoch(): number;
  evictedThroughEpoch(): number;
  activeUnackedCount(): number;
  keptEntryCount(): number;
  endedEpochCount(): number;
  beginEpoch(epoch: number): void;
  endEpoch(epoch: number, reason: EpochEndReason): void;
  epochStatus(epoch: number): EpochStatus;
  classify(epoch: number, inSeq: number): ClassifyInSeqResult;
  reserve(epoch: number, inSeq: number): void;
  settle(epoch: number, inSeq: number, result: InputLogEntryResult, reason?: string): void;
  recordRefusal(epoch: number, inSeq: number, reason: string): void;
  skip(epoch: number, inSeq: number): void;
  advanceAck(epoch: number, through: number): void;
  replayAfter(epoch: number, lastAckedInSeq: number): ReplayAfterResult;
  drop(): void;
}

interface ActiveEpochState {
  readonly epoch: number;
  nextInSeq: number;
  maxAckedInSeq: number;
  prunedThroughInSeq: number;
  readonly entries: Map<number, InputLogEntry>;
}

interface EndedEpochState {
  readonly epoch: number;
  readonly reason: EpochEndReason;
  readonly maxInSeq: number;
  maxAckedInSeq: number;
  readonly entries: Map<number, InputLogEntry>;
}

const VALID_END_REASONS = new Set<string>(["taken-back", "idle-released", "lost-link", "released"]);

function isSafePosInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}

function isSafeNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function hash32(partA: string, partB: string): string {
  return createHash("sha256").update(`${partA}\n${partB}`).digest("hex").slice(0, 32);
}

export function inputLogDir(root: string): string {
  return join(root, "remote-control", "input-log");
}

export function inputLogFilePath(
  root: string,
  scope: string,
  sid: string,
  generation: string,
  incarnation: string
): string {
  const a = hash32(scope, sid);
  const b = hash32(generation, incarnation);
  return join(inputLogDir(root), `${a}.${b}.jsonl`);
}

export function purgeStaleIncarnationLogs(
  root: string,
  scope: string,
  sid: string,
  generation: string,
  incarnation: string
): void {
  const dir = inputLogDir(root);
  if (!existsSync(dir)) return;
  const a = hash32(scope, sid);
  const currentName = `${a}.${hash32(generation, incarnation)}.jsonl`;
  const prefix = `${a}.`;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(prefix) && entry.endsWith(".jsonl") && entry !== currentName) {
        try {
          rmSync(join(dir, entry), { force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }
  } catch {
    // ignore
  }
}

function ensureLogDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // mode already requested on creation
  }
}

function appendJsonLine(dir: string, file: string, payload: Record<string, unknown>, sync: boolean): void {
  ensureLogDir(dir);
  const line = `${JSON.stringify(payload)}\n`;
  if (sync) {
    const fd = openSync(file, "a", 0o600);
    try {
      writeSync(fd, line, undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(file, 0o600);
    } catch {
      // mode already set on creation
    }
  } else {
    appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // ignore
    }
  }
}

function serializeInLine(epoch: number, entry: InputLogEntry): Record<string, unknown> {
  return {
    k: "in",
    epoch,
    inSeq: entry.inSeq,
    r: entry.result,
    ...(entry.reason !== undefined ? { why: entry.reason } : {})
  };
}

export function openTerminalInputLog(
  root: string,
  scope: string,
  sid: string,
  generation: string,
  incarnation: string
): TerminalInputLog {
  const dir = inputLogDir(root);
  const file = inputLogFilePath(root, scope, sid, generation, incarnation);

  let highestOpenedEpoch = 0;
  let evictedThroughEpoch = 0;
  let lineCount = 0;
  let activeEpoch: ActiveEpochState | null = null;
  const endedEpochs: EndedEpochState[] = [];

  function findEnded(epoch: number): EndedEpochState | undefined {
    return endedEpochs.find((e) => e.epoch === epoch);
  }

  function evictOverflowEndedEpochs(persistEvict: boolean): void {
    while (endedEpochs.length > INPUT_LOG_MAX_ENDED_EPOCHS) {
      const oldest = endedEpochs.shift()!;
      if (oldest.epoch > evictedThroughEpoch) {
        evictedThroughEpoch = oldest.epoch;
        if (persistEvict) {
          appendJsonLine(dir, file, { k: "evict", through: evictedThroughEpoch }, false);
          lineCount += 1;
        }
      }
    }
  }

  function totalKeptEntries(): number {
    let count = activeEpoch ? activeEpoch.entries.size : 0;
    for (const ended of endedEpochs) {
      count += ended.entries.size;
    }
    return count;
  }

  function compactIfNeeded(): void {
    if (lineCount <= 2 * totalKeptEntries() + INPUT_LOG_COMPACT_SLACK_LINES) {
      return;
    }
    ensureLogDir(dir);
    withLockSync(`${file}.lock`, () => {
      const lines: string[] = [];
      if (evictedThroughEpoch > 0) {
        lines.push(JSON.stringify({ k: "evict", through: evictedThroughEpoch }));
      }
      for (const ended of endedEpochs) {
        lines.push(JSON.stringify({ k: "open", epoch: ended.epoch }));
        const sortedSeqs = [...ended.entries.keys()].sort((a, b) => a - b);
        for (const seq of sortedSeqs) {
          lines.push(JSON.stringify(serializeInLine(ended.epoch, ended.entries.get(seq)!)));
        }
        if (ended.maxAckedInSeq > 0) {
          lines.push(JSON.stringify({ k: "ack", epoch: ended.epoch, through: ended.maxAckedInSeq }));
        }
        lines.push(
          JSON.stringify({
            k: "end",
            epoch: ended.epoch,
            why: ended.reason,
            maxInSeq: ended.maxInSeq
          })
        );
      }
      if (activeEpoch) {
        lines.push(JSON.stringify({ k: "open", epoch: activeEpoch.epoch }));
        const sortedSeqs = [...activeEpoch.entries.keys()].sort((a, b) => a - b);
        for (const seq of sortedSeqs) {
          lines.push(JSON.stringify(serializeInLine(activeEpoch.epoch, activeEpoch.entries.get(seq)!)));
        }
        if (activeEpoch.maxAckedInSeq > 0) {
          lines.push(JSON.stringify({ k: "ack", epoch: activeEpoch.epoch, through: activeEpoch.maxAckedInSeq }));
        }
      }
      const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
      const tmp = join(dir, `.compact.${process.pid}.${randomUUID()}.tmp`);
      try {
        const fd = openSync(tmp, "w", 0o600);
        try {
          writeSync(fd, body, undefined, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        chmodSync(tmp, 0o600);
        renameSync(tmp, file);
        lineCount = lines.length;
      } catch (err) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          // ignore
        }
        throw err;
      }
    });
  }

  // Load existing log file if present (never create file/dir on open).
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    const rawLines = raw.split("\n");
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }
    const parsedEpochs = new Map<
      number,
      {
        opened: boolean;
        ended: boolean;
        endReason?: EpochEndReason;
        maxInSeq?: number;
        maxSeenInSeq: number;
        maxAckedInSeq: number;
        entries: Map<number, InputLogEntry>;
      }
    >();

    const getEpochAcc = (epoch: number) => {
      let acc = parsedEpochs.get(epoch);
      if (!acc) {
        acc = {
          opened: false,
          ended: false,
          maxSeenInSeq: 0,
          maxAckedInSeq: 0,
          entries: new Map()
        };
        parsedEpochs.set(epoch, acc);
      }
      return acc;
    };

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i]!;
      if (rawLine.trim().length === 0) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(rawLine);
      } catch {
        // Ignore truncated last line.
        if (i === rawLines.length - 1) break;
        continue;
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
      lineCount += 1;
      const rec = obj as Record<string, unknown>;
      const k = rec["k"];
      if (k === "open" && isSafePosInt(rec["epoch"])) {
        const epoch = rec["epoch"];
        if (epoch > highestOpenedEpoch) highestOpenedEpoch = epoch;
        const acc = getEpochAcc(epoch);
        acc.opened = true;
      } else if (
        k === "in" &&
        isSafePosInt(rec["epoch"]) &&
        isSafePosInt(rec["inSeq"]) &&
        (rec["r"] === "uncertain" || rec["r"] === "applied" || rec["r"] === "refused")
      ) {
        const epoch = rec["epoch"];
        const inSeq = rec["inSeq"];
        const r = rec["r"];
        const why = typeof rec["why"] === "string" && rec["why"].length > 0 ? rec["why"] : undefined;
        if (epoch > highestOpenedEpoch) highestOpenedEpoch = epoch;
        const acc = getEpochAcc(epoch);
        acc.entries.set(inSeq, { inSeq, result: r, ...(why !== undefined ? { reason: why } : {}) });
        if (inSeq > acc.maxSeenInSeq) acc.maxSeenInSeq = inSeq;
      } else if (k === "ack" && isSafePosInt(rec["epoch"]) && isSafeNonNegInt(rec["through"])) {
        const acc = getEpochAcc(rec["epoch"]);
        if (rec["through"] > acc.maxAckedInSeq) acc.maxAckedInSeq = rec["through"];
      } else if (
        k === "end" &&
        isSafePosInt(rec["epoch"]) &&
        typeof rec["why"] === "string" &&
        VALID_END_REASONS.has(rec["why"]) &&
        isSafeNonNegInt(rec["maxInSeq"])
      ) {
        const epoch = rec["epoch"];
        if (epoch > highestOpenedEpoch) highestOpenedEpoch = epoch;
        const acc = getEpochAcc(epoch);
        acc.ended = true;
        acc.endReason = rec["why"] as EpochEndReason;
        acc.maxInSeq = rec["maxInSeq"];
      } else if (k === "evict" && isSafePosInt(rec["through"])) {
        if (rec["through"] > evictedThroughEpoch) evictedThroughEpoch = rec["through"];
        if (rec["through"] > highestOpenedEpoch) highestOpenedEpoch = rec["through"];
      }
    }

    const sortedEpochNums = [...parsedEpochs.keys()].sort((a, b) => a - b);
    for (const epoch of sortedEpochNums) {
      if (epoch <= evictedThroughEpoch) continue;
      const acc = parsedEpochs.get(epoch)!;
      if (!acc.opened && !acc.ended && acc.entries.size === 0) continue;
      let endReason: EpochEndReason;
      let maxInSeq: number;
      if (acc.ended) {
        endReason = acc.endReason!;
        maxInSeq = acc.maxInSeq!;
      } else {
        // An open epoch on startup is closed as lost-link with maxInSeq = greatest inSeq read for it.
        endReason = "lost-link";
        maxInSeq = acc.maxSeenInSeq;
        appendJsonLine(dir, file, { k: "end", epoch, why: endReason, maxInSeq }, true);
        lineCount += 1;
      }
      const clampedAck = Math.min(acc.maxAckedInSeq, maxInSeq);
      for (const seq of [...acc.entries.keys()]) {
        if (seq <= clampedAck) acc.entries.delete(seq);
      }
      endedEpochs.push({
        epoch,
        reason: endReason,
        maxInSeq,
        maxAckedInSeq: clampedAck,
        entries: acc.entries
      });
    }
    evictOverflowEndedEpochs(false);
  }

  return {
    filePath: () => file,
    highestOpenedEpoch: () => highestOpenedEpoch,
    evictedThroughEpoch: () => evictedThroughEpoch,
    activeUnackedCount: () => {
      if (!activeEpoch) return 0;
      let count = 0;
      for (const seq of activeEpoch.entries.keys()) {
        if (seq > activeEpoch.maxAckedInSeq) count += 1;
      }
      return count;
    },
    keptEntryCount: () => totalKeptEntries(),
    endedEpochCount: () => endedEpochs.length,

    beginEpoch(epoch: number): void {
      if (!isSafePosInt(epoch)) {
        throw new RangeError("epoch must be a positive safe integer");
      }
      if (activeEpoch) {
        this.endEpoch(activeEpoch.epoch, "released");
      }
      if (epoch > highestOpenedEpoch) {
        highestOpenedEpoch = epoch;
      }
      activeEpoch = {
        epoch,
        nextInSeq: 1,
        maxAckedInSeq: 0,
        prunedThroughInSeq: 0,
        entries: new Map()
      };
      appendJsonLine(dir, file, { k: "open", epoch }, true);
      lineCount += 1;
    },

    endEpoch(epoch: number, reason: EpochEndReason): void {
      if (!activeEpoch || activeEpoch.epoch !== epoch) return;
      const maxInSeq = activeEpoch.nextInSeq - 1;
      appendJsonLine(dir, file, { k: "end", epoch, why: reason, maxInSeq }, true);
      lineCount += 1;

      for (const seq of [...activeEpoch.entries.keys()]) {
        if (seq <= activeEpoch.maxAckedInSeq) {
          activeEpoch.entries.delete(seq);
        }
      }
      endedEpochs.push({
        epoch,
        reason,
        maxInSeq,
        maxAckedInSeq: activeEpoch.maxAckedInSeq,
        entries: activeEpoch.entries
      });
      activeEpoch = null;
      evictOverflowEndedEpochs(true);
      compactIfNeeded();
    },

    epochStatus(epoch: number): EpochStatus {
      if (!isSafePosInt(epoch)) return { status: "unknown" };
      if (activeEpoch && activeEpoch.epoch === epoch) {
        return {
          status: "active",
          nextInSeq: activeEpoch.nextInSeq,
          maxAckedInSeq: activeEpoch.maxAckedInSeq,
          prunedThroughInSeq: activeEpoch.prunedThroughInSeq
        };
      }
      const ended = findEnded(epoch);
      if (ended) {
        return { status: "ended", reason: ended.reason, maxInSeq: ended.maxInSeq };
      }
      if (evictedThroughEpoch > 0 && epoch <= evictedThroughEpoch) {
        return { status: "evicted" };
      }
      return { status: "unknown" };
    },

    classify(epoch: number, inSeq: number): ClassifyInSeqResult {
      if (!activeEpoch || activeEpoch.epoch !== epoch) {
        const ended = findEnded(epoch);
        if (ended) {
          const existing = ended.entries.get(inSeq);
          if (existing) return { kind: "present", entry: existing };
          return { kind: "pruned" };
        }
        return { kind: "ahead" };
      }
      if (inSeq <= activeEpoch.prunedThroughInSeq) {
        return { kind: "pruned" };
      }
      const existing = activeEpoch.entries.get(inSeq);
      if (existing) {
        return { kind: "present", entry: existing };
      }
      if (inSeq < activeEpoch.nextInSeq) {
        return { kind: "hole" };
      }
      if (inSeq === activeEpoch.nextInSeq) {
        return { kind: "next" };
      }
      return { kind: "ahead" };
    },

    reserve(epoch: number, inSeq: number): void {
      if (!activeEpoch || activeEpoch.epoch !== epoch || inSeq !== activeEpoch.nextInSeq) {
        throw new Error(`cannot reserve inSeq=${inSeq} for epoch=${epoch}`);
      }
      const entry: InputLogEntry = { inSeq, result: "uncertain" };
      activeEpoch.entries.set(inSeq, entry);
      activeEpoch.nextInSeq = inSeq + 1;
      appendJsonLine(dir, file, serializeInLine(epoch, entry), true);
      lineCount += 1;
    },

    settle(epoch: number, inSeq: number, result: InputLogEntryResult, reason?: string): void {
      if (!activeEpoch || activeEpoch.epoch !== epoch) return;
      const entry: InputLogEntry = {
        inSeq,
        result,
        ...(reason !== undefined ? { reason } : {})
      };
      activeEpoch.entries.set(inSeq, entry);
      appendJsonLine(dir, file, serializeInLine(epoch, entry), false);
      lineCount += 1;
      compactIfNeeded();
    },

    recordRefusal(epoch: number, inSeq: number, reason: string): void {
      if (!activeEpoch || activeEpoch.epoch !== epoch || inSeq !== activeEpoch.nextInSeq) {
        throw new Error(`cannot record refusal inSeq=${inSeq} for epoch=${epoch}`);
      }
      const entry: InputLogEntry = { inSeq, result: "refused", reason };
      activeEpoch.entries.set(inSeq, entry);
      activeEpoch.nextInSeq = inSeq + 1;
      appendJsonLine(dir, file, serializeInLine(epoch, entry), false);
      lineCount += 1;
      compactIfNeeded();
    },

    skip(epoch: number, inSeq: number): void {
      if (!activeEpoch || activeEpoch.epoch !== epoch || inSeq !== activeEpoch.nextInSeq) {
        throw new Error(`cannot skip inSeq=${inSeq} for epoch=${epoch}`);
      }
      activeEpoch.nextInSeq = inSeq + 1;
    },

    advanceAck(epoch: number, through: number): void {
      if (!isSafeNonNegInt(through)) return;
      if (activeEpoch && activeEpoch.epoch === epoch) {
        const clamped = Math.min(through, activeEpoch.nextInSeq - 1);
        if (clamped <= activeEpoch.maxAckedInSeq) return;
        activeEpoch.maxAckedInSeq = clamped;
        activeEpoch.prunedThroughInSeq = Math.max(0, clamped - INPUT_LOG_MAX_RECENT_ACKED);
        for (const seq of [...activeEpoch.entries.keys()]) {
          if (seq <= activeEpoch.prunedThroughInSeq) {
            activeEpoch.entries.delete(seq);
          }
        }
        appendJsonLine(dir, file, { k: "ack", epoch, through: clamped }, false);
        lineCount += 1;
        compactIfNeeded();
        return;
      }
      const ended = findEnded(epoch);
      if (ended) {
        const clamped = Math.min(through, ended.maxInSeq);
        if (clamped <= ended.maxAckedInSeq) return;
        ended.maxAckedInSeq = clamped;
        for (const seq of [...ended.entries.keys()]) {
          if (seq <= ended.maxAckedInSeq) {
            ended.entries.delete(seq);
          }
        }
        appendJsonLine(dir, file, { k: "ack", epoch, through: clamped }, false);
        lineCount += 1;
        compactIfNeeded();
      }
    },

    replayAfter(epoch: number, lastAckedInSeq: number): ReplayAfterResult {
      if (activeEpoch && activeEpoch.epoch === epoch) {
        const clampedAck = Math.min(lastAckedInSeq, activeEpoch.nextInSeq - 1);
        this.advanceAck(epoch, clampedAck);
        const entries = [...activeEpoch.entries.values()]
          .filter((e) => e.inSeq > clampedAck)
          .sort((a, b) => a.inSeq - b.inSeq);
        const syncedThroughInSeq = entries.length > 0 ? entries[entries.length - 1]!.inSeq : clampedAck;
        return { entries, syncedThroughInSeq, evicted: false };
      }
      const ended = findEnded(epoch);
      if (ended) {
        const clampedAck = Math.min(lastAckedInSeq, ended.maxInSeq);
        this.advanceAck(epoch, clampedAck);
        const entries = [...ended.entries.values()]
          .filter((e) => e.inSeq > clampedAck)
          .sort((a, b) => a.inSeq - b.inSeq);
        const syncedThroughInSeq = entries.length > 0 ? entries[entries.length - 1]!.inSeq : clampedAck;
        return { entries, syncedThroughInSeq, evicted: false, endReason: ended.reason };
      }
      if (evictedThroughEpoch > 0 && isSafePosInt(epoch) && epoch <= evictedThroughEpoch) {
        return { entries: [], syncedThroughInSeq: lastAckedInSeq, evicted: true, endReason: "released" };
      }
      throw new Error(`replayAfter called for unknown epoch=${epoch}`);
    },

    drop(): void {
      activeEpoch = null;
      endedEpochs.length = 0;
      lineCount = 0;
      try {
        rmSync(file, { force: true });
      } catch {
        // ignore
      }
      try {
        rmSync(`${file}.lock`, { force: true });
      } catch {
        // ignore
      }
    }
  };
}
