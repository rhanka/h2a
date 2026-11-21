/**
 * LH-07 per-channel monotonic output credit ledger.
 *
 * Scoped per (connection, linkGeneration, direction, ch) for data channels
 * (ch = 1 catalogue, ch >= 2 terminal output). Enforces exact sent-record
 * frontiers, monotonic limits, and the protocol window cap (<= 8 records and
 * <= 131072 bytes beyond acknowledged).
 */

import type { CreditRecord } from "./types.js";

export const MAX_CREDIT_WINDOW_RECORDS = 8 as const;
export const MAX_CREDIT_WINDOW_BYTES = 131072 as const;

export interface CreditAvailability {
  readonly records: number;
  readonly bytes: number;
}

export interface CreditLimits {
  readonly maxWindowRecords: number;
  readonly maxWindowBytes: number;
}

export type CreditUpdateResult =
  | { readonly ok: true; readonly gained: boolean; readonly available: CreditAvailability }
  | { readonly ok: false; readonly code: string };

interface ChannelLedger {
  sentSeq: number;
  sentBytes: number;
  receivedThroughSeq: number;
  receivedThroughBytes: number;
  sendLimitSeq: number;
  sendLimitBytes: number;
  boundaries: Map<number, number>;
}

function isSafeNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

export class TrunkCreditManager {
  readonly #maxWindowRecords: number;
  readonly #maxWindowBytes: number;
  readonly #channels = new Map<number, ChannelLedger>();

  constructor(limits: CreditLimits = { maxWindowRecords: MAX_CREDIT_WINDOW_RECORDS, maxWindowBytes: MAX_CREDIT_WINDOW_BYTES }) {
    this.#maxWindowRecords = Math.min(
      MAX_CREDIT_WINDOW_RECORDS,
      Math.max(1, Number.isSafeInteger(limits.maxWindowRecords) ? limits.maxWindowRecords : MAX_CREDIT_WINDOW_RECORDS)
    );
    this.#maxWindowBytes = Math.min(
      MAX_CREDIT_WINDOW_BYTES,
      Math.max(1, Number.isSafeInteger(limits.maxWindowBytes) ? limits.maxWindowBytes : MAX_CREDIT_WINDOW_BYTES)
    );
  }

  openChannel(ch: number): void {
    if (!Number.isSafeInteger(ch) || ch < 1) {
      throw new RangeError(`invalid data channel: ${ch}`);
    }
    this.#channels.set(ch, {
      sentSeq: 0,
      sentBytes: 0,
      receivedThroughSeq: 0,
      receivedThroughBytes: 0,
      sendLimitSeq: 0,
      sendLimitBytes: 0,
      boundaries: new Map([[0, 0]])
    });
  }

  closeChannel(ch: number): void {
    this.#channels.delete(ch);
  }

  hasChannel(ch: number): boolean {
    return this.#channels.has(ch);
  }

  availableOutput(ch: number): CreditAvailability {
    const ledger = this.#channels.get(ch);
    if (!ledger) return { records: 0, bytes: 0 };
    return {
      records: Math.max(0, ledger.sendLimitSeq - ledger.sentSeq),
      bytes: Math.max(0, ledger.sendLimitBytes - ledger.sentBytes)
    };
  }

  canSendOutput(ch: number, rawBytes: number): boolean {
    const ledger = this.#channels.get(ch);
    if (!ledger) return false;
    if (!isSafeNonNegInt(rawBytes)) return false;
    return ledger.sentSeq + 1 <= ledger.sendLimitSeq && ledger.sentBytes + rawBytes <= ledger.sendLimitBytes;
  }

  recordSentOutput(ch: number, rawBytes: number): boolean {
    const ledger = this.#channels.get(ch);
    if (!ledger) return false;
    if (!isSafeNonNegInt(rawBytes)) return false;
    if (ledger.sentSeq + 1 > ledger.sendLimitSeq || ledger.sentBytes + rawBytes > ledger.sendLimitBytes) {
      return false;
    }
    ledger.sentSeq += 1;
    ledger.sentBytes += rawBytes;
    ledger.boundaries.set(ledger.sentSeq, ledger.sentBytes);
    return true;
  }

  onCredit(record: CreditRecord): CreditUpdateResult {
    const ledger = this.#channels.get(record.ch);
    if (!ledger) {
      return { ok: false, code: "unknown-credit-channel" };
    }
    const { receivedThroughSeq, receivedThroughBytes, sendLimitSeq, sendLimitBytes } = record;
    if (
      !isSafeNonNegInt(receivedThroughSeq) ||
      !isSafeNonNegInt(receivedThroughBytes) ||
      !isSafeNonNegInt(sendLimitSeq) ||
      !isSafeNonNegInt(sendLimitBytes)
    ) {
      return { ok: false, code: "invalid-credit-values" };
    }
    if (receivedThroughSeq > sendLimitSeq || receivedThroughBytes > sendLimitBytes) {
      return { ok: false, code: "invalid-credit-order" };
    }
    if (
      receivedThroughSeq < ledger.receivedThroughSeq ||
      receivedThroughBytes < ledger.receivedThroughBytes ||
      sendLimitSeq < ledger.sendLimitSeq ||
      sendLimitBytes < ledger.sendLimitBytes
    ) {
      return { ok: false, code: "regressive-credit" };
    }
    // Ack must denote an exact sent boundary (seq, cumulativeBytes).
    if (receivedThroughSeq > ledger.sentSeq) {
      return { ok: false, code: "credit-off-frontier" };
    }
    const expectedBytesAtSeq = ledger.boundaries.get(receivedThroughSeq);
    if (expectedBytesAtSeq === undefined || expectedBytesAtSeq !== receivedThroughBytes) {
      return { ok: false, code: "credit-off-frontier" };
    }
    // Enforce negotiated window ceiling (<= 8 records and <= 131072 bytes beyond acked).
    if (
      sendLimitSeq - receivedThroughSeq > this.#maxWindowRecords ||
      sendLimitBytes - receivedThroughBytes > this.#maxWindowBytes
    ) {
      return { ok: false, code: "credit-window-exceeded" };
    }

    const gained = sendLimitSeq > ledger.sendLimitSeq || sendLimitBytes > ledger.sendLimitBytes;
    ledger.receivedThroughSeq = receivedThroughSeq;
    ledger.receivedThroughBytes = receivedThroughBytes;
    ledger.sendLimitSeq = sendLimitSeq;
    ledger.sendLimitBytes = sendLimitBytes;

    // Prune older boundaries strictly below receivedThroughSeq (retain receivedThroughSeq for idempotent duplicates).
    for (const seq of ledger.boundaries.keys()) {
      if (seq < receivedThroughSeq) {
        ledger.boundaries.delete(seq);
      }
    }

    return {
      ok: true,
      gained,
      available: this.availableOutput(record.ch)
    };
  }

  reset(): void {
    this.#channels.clear();
  }
}
