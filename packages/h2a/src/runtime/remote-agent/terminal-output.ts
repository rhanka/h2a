/**
 * LH-08 terminal output coalescing, single-chunk UTF-8 byte segmentation,
 * and shared per-incarnation range boundary index.
 */

import { TERMINAL_OUTPUT_COALESCE_BYTES, type TermOut } from "./types.js";

export const TERMINAL_OUTPUT_COALESCE_MS = 16 as const;
export const TERMINAL_OUTPUT_POLL_INTERVAL_MS = 16 as const;
export const TERMINAL_OUTPUT_MAX_RANGES = 65_536 as const;

export interface NativeOutputChunk {
  readonly seq: number;
  readonly data: string;
}

export interface NativeReplayGap {
  readonly fromSeq: number;
  readonly toSeq: number;
}

export interface CoalescedRange {
  readonly firstSeq: number;
  readonly lastSeq: number;
}

export interface TermOutProposal {
  readonly record: Omit<TermOut, "v" | "ch" | "s">;
  readonly rawBytes: number;
  readonly isSegmented: boolean;
  readonly isFinalSegment: boolean;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly seg?: number;
}

function incarnationKey(sid: string, generation: string, incarnation: string): string {
  return `${sid}\0${generation}\0${incarnation}`;
}

/**
 * Shared in-memory index of frozen `[firstSeq, lastSeq]` boundaries per
 * `(sid, generation, incarnation)`. Stores only integer bounds (no payload
 * copy), capped at 65 536 entries per incarnation.
 */
export class CoalescedRangeIndex {
  readonly #byIncarnation = new Map<string, Map<number, CoalescedRange>>();

  getRangeStartingAt(
    sid: string,
    generation: string,
    incarnation: string,
    firstSeq: number
  ): CoalescedRange | undefined {
    return this.#byIncarnation.get(incarnationKey(sid, generation, incarnation))?.get(firstSeq);
  }

  recordRange(
    sid: string,
    generation: string,
    incarnation: string,
    range: CoalescedRange
  ): CoalescedRange {
    if (!Number.isSafeInteger(range.firstSeq) || !Number.isSafeInteger(range.lastSeq) || range.firstSeq < 1 || range.lastSeq < range.firstSeq) {
      throw new RangeError(`invalid coalesced range [${range.firstSeq}..${range.lastSeq}]`);
    }
    const key = incarnationKey(sid, generation, incarnation);
    let map = this.#byIncarnation.get(key);
    if (!map) {
      map = new Map();
      this.#byIncarnation.set(key, map);
    }
    const existing = map.get(range.firstSeq);
    if (existing) {
      return existing;
    }
    if (map.size >= TERMINAL_OUTPUT_MAX_RANGES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    const frozen: CoalescedRange = Object.freeze({ firstSeq: range.firstSeq, lastSeq: range.lastSeq });
    map.set(range.firstSeq, frozen);
    return frozen;
  }

  pruneBefore(
    sid: string,
    generation: string,
    incarnation: string,
    minSeq: number
  ): void {
    const key = incarnationKey(sid, generation, incarnation);
    const map = this.#byIncarnation.get(key);
    if (!map) return;
    for (const [firstSeq, range] of map.entries()) {
      if (range.lastSeq < minSeq) {
        map.delete(firstSeq);
      }
    }
    if (map.size === 0) {
      this.#byIncarnation.delete(key);
    }
  }

  deleteIncarnation(
    sid: string,
    generation: string,
    incarnation: string
  ): void {
    this.#byIncarnation.delete(incarnationKey(sid, generation, incarnation));
  }

  sizeForIncarnation(
    sid: string,
    generation: string,
    incarnation: string
  ): number {
    return this.#byIncarnation.get(incarnationKey(sid, generation, incarnation))?.size ?? 0;
  }

  clear(): void {
    this.#byIncarnation.clear();
  }
}

/**
 * Segment a single oversized native chunk along exact UTF-8 byte offsets
 * (`0, maxBytes, 2*maxBytes, ...`), converting the string to UTF-8 bytes once.
 */
export function segmentSingleChunk(
  chunk: NativeOutputChunk,
  sid: string,
  incarnation: string,
  startSeg = 0,
  maxBytes: number = TERMINAL_OUTPUT_COALESCE_BYTES
): TermOutProposal[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }
  const utf8 = Buffer.from(chunk.data, "utf8");
  const totalSegments = Math.max(1, Math.ceil(utf8.byteLength / maxBytes));
  const proposals: TermOutProposal[] = [];
  for (let seg = startSeg; seg < totalSegments; seg++) {
    const start = seg * maxBytes;
    const end = Math.min(utf8.byteLength, start + maxBytes);
    const slice = utf8.subarray(start, end);
    const isFinalSegment = seg === totalSegments - 1;
    proposals.push({
      record: {
        t: "term.out",
        sid,
        incarnation,
        firstSeq: chunk.seq,
        lastSeq: chunk.seq,
        seg,
        segLast: isFinalSegment,
        dataB64: slice.toString("base64")
      },
      rawBytes: slice.byteLength,
      isSegmented: true,
      isFinalSegment,
      firstSeq: chunk.seq,
      lastSeq: chunk.seq,
      seg
    });
  }
  return proposals;
}

export interface TerminalOutputAssemblerOptions {
  readonly sid: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly afterSeq: number;
  readonly afterSeqBytes: number;
  readonly rangeIndex: CoalescedRangeIndex;
  readonly maxChunkBytes?: number;
  readonly coalesceMs?: number;
}

interface BufferedChunk {
  readonly seq: number;
  readonly data: string;
  readonly rawBytes: number;
  readonly arrivedAtMs: number;
}

export class TerminalOutputAssembler {
  readonly #sid: string;
  readonly #generation: string;
  readonly #incarnation: string;
  readonly #rangeIndex: CoalescedRangeIndex;
  readonly #maxChunkBytes: number;
  readonly #coalesceMs: number;

  #pendingChunks: BufferedChunk[] = [];
  #lastQueuedSeq: number;
  #lastSentSeq: number;
  #nextReadAfterSeq: number;
  #pendingAfterSeqBytes: number;
  #activeSegmented: {
    readonly seq: number;
    readonly proposals: readonly TermOutProposal[];
    nextIndex: number;
  } | null = null;
  #pausedSegmented: { readonly seq: number; readonly nextIndex: number } | null = null;

  constructor(options: TerminalOutputAssemblerOptions) {
    this.#sid = options.sid;
    this.#generation = options.generation;
    this.#incarnation = options.incarnation;
    this.#rangeIndex = options.rangeIndex;
    this.#maxChunkBytes = options.maxChunkBytes ?? TERMINAL_OUTPUT_COALESCE_BYTES;
    this.#coalesceMs = options.coalesceMs ?? TERMINAL_OUTPUT_COALESCE_MS;
    this.#lastQueuedSeq = options.afterSeq;
    this.#lastSentSeq = options.afterSeq;
    this.#nextReadAfterSeq = options.afterSeq;
    this.#pendingAfterSeqBytes = options.afterSeqBytes;
  }

  get nextReadAfterSeq(): number {
    return this.#nextReadAfterSeq;
  }

  get lastSentSeq(): number {
    return this.#lastSentSeq;
  }

  hasPendingData(): boolean {
    return this.#activeSegmented !== null || this.#pendingChunks.length > 0;
  }

  pendingDelayMs(nowMs: number): number | null {
    if (this.#activeSegmented !== null || this.#pendingChunks.length === 0) {
      return null;
    }
    const first = this.#pendingChunks[0]!;
    if (first.rawBytes > this.#maxChunkBytes) {
      return 0;
    }
    const frozen = this.#rangeIndex.getRangeStartingAt(
      this.#sid,
      this.#generation,
      this.#incarnation,
      first.seq
    );
    if (frozen && this.#hasAllChunksUpTo(frozen.lastSeq)) {
      return 0;
    }
    if (this.#wouldHitBatchBoundary()) {
      return 0;
    }
    const elapsed = Math.max(0, nowMs - first.arrivedAtMs);
    return Math.max(0, this.#coalesceMs - elapsed);
  }

  validateResumeFirstChunk(chunk: NativeOutputChunk | undefined): boolean {
    if (this.#pendingAfterSeqBytes === 0) return true;
    if (!chunk || chunk.seq !== this.#lastSentSeq + 1) return false;
    const rawBytes = Buffer.byteLength(chunk.data, "utf8");
    return rawBytes > this.#maxChunkBytes && this.#pendingAfterSeqBytes < rawBytes;
  }

  pushChunks(chunks: readonly NativeOutputChunk[], nowMs: number): void {
    for (const chunk of chunks) {
      if (chunk.seq <= this.#lastQueuedSeq) continue;
      this.#pendingChunks.push({
        seq: chunk.seq,
        data: chunk.data,
        rawBytes: Buffer.byteLength(chunk.data, "utf8"),
        arrivedAtMs: nowMs
      });
      this.#lastQueuedSeq = chunk.seq;
    }
  }

  peekNextProposal(options: {
    readonly nowMs: number;
    readonly flushTail?: boolean;
  }): TermOutProposal | null {
    if (this.#activeSegmented !== null) {
      return this.#activeSegmented.proposals[this.#activeSegmented.nextIndex] ?? null;
    }
    if (this.#pendingChunks.length === 0) {
      return null;
    }

    const first = this.#pendingChunks[0]!;
    if (first.rawBytes > this.#maxChunkBytes) {
      const startSeg =
        this.#pausedSegmented && this.#pausedSegmented.seq === first.seq
          ? this.#pausedSegmented.nextIndex
          : 0;
      const proposals = segmentSingleChunk(
        first,
        this.#sid,
        this.#incarnation,
        0,
        this.#maxChunkBytes
      );
      this.#activeSegmented = {
        seq: first.seq,
        proposals,
        nextIndex: Math.min(startSeg, proposals.length - 1)
      };
      return this.#activeSegmented.proposals[this.#activeSegmented.nextIndex] ?? null;
    }

    // Reuse an already-frozen range boundary when all its chunks are available.
    const frozen = this.#rangeIndex.getRangeStartingAt(
      this.#sid,
      this.#generation,
      this.#incarnation,
      first.seq
    );
    if (frozen) {
      const collected = this.#collectContiguousUpTo(frozen.lastSeq);
      if (collected !== null) {
        return this.#buildCoalescedProposal(collected);
      }
      if (!options.flushTail) {
        return null;
      }
    }

    const batch: BufferedChunk[] = [];
    let totalBytes = 0;
    let hitBoundary = false;

    for (let i = 0; i < this.#pendingChunks.length; i++) {
      const candidate = this.#pendingChunks[i]!;
      if (candidate.rawBytes > this.#maxChunkBytes) {
        hitBoundary = true;
        break;
      }
      if (i > 0) {
        const prev = batch[batch.length - 1]!;
        if (candidate.seq !== prev.seq + 1) {
          hitBoundary = true;
          break;
        }
        if (
          this.#rangeIndex.getRangeStartingAt(
            this.#sid,
            this.#generation,
            this.#incarnation,
            candidate.seq
          ) !== undefined
        ) {
          hitBoundary = true;
          break;
        }
      }
      if (totalBytes + candidate.rawBytes > this.#maxChunkBytes) {
        hitBoundary = true;
        break;
      }
      batch.push(candidate);
      totalBytes += candidate.rawBytes;
    }

    if (batch.length === 0) return null;
    const elapsed = Math.max(0, options.nowMs - first.arrivedAtMs);
    if (!hitBoundary && !options.flushTail && elapsed < this.#coalesceMs) {
      return null;
    }
    return this.#buildCoalescedProposal(batch);
  }

  consumeNextProposal(proposal: TermOutProposal): void {
    this.#pendingAfterSeqBytes = 0;
    if (proposal.isSegmented) {
      this.#pausedSegmented = null;
      if (this.#pendingChunks[0]?.seq === proposal.firstSeq) {
        this.#pendingChunks.shift();
      }
      if (this.#activeSegmented && this.#activeSegmented.seq === proposal.firstSeq) {
        this.#activeSegmented.nextIndex += 1;
        if (proposal.isFinalSegment || this.#activeSegmented.nextIndex >= this.#activeSegmented.proposals.length) {
          this.#activeSegmented = null;
          this.#lastSentSeq = proposal.lastSeq;
          this.#nextReadAfterSeq = proposal.lastSeq;
        }
      } else if (proposal.isFinalSegment) {
        this.#lastSentSeq = proposal.lastSeq;
        this.#nextReadAfterSeq = proposal.lastSeq;
      }
      return;
    }

    this.#rangeIndex.recordRange(this.#sid, this.#generation, this.#incarnation, {
      firstSeq: proposal.firstSeq,
      lastSeq: proposal.lastSeq
    });
    while (this.#pendingChunks.length > 0 && this.#pendingChunks[0]!.seq <= proposal.lastSeq) {
      this.#pendingChunks.shift();
    }
    this.#lastSentSeq = proposal.lastSeq;
    this.#nextReadAfterSeq = proposal.lastSeq;
  }

  releaseBufferForCreditPause(): void {
    if (this.#activeSegmented !== null) {
      this.#pausedSegmented = {
        seq: this.#activeSegmented.seq,
        nextIndex: this.#activeSegmented.nextIndex
      };
      this.#activeSegmented = null;
    }
    this.#pendingChunks = [];
    this.#lastQueuedSeq = this.#lastSentSeq;
    this.#nextReadAfterSeq = this.#lastSentSeq;
  }

  resetForGap(toSeq: number): void {
    this.#pendingChunks = [];
    this.#activeSegmented = null;
    this.#pausedSegmented = null;
    this.#pendingAfterSeqBytes = 0;
    this.#lastQueuedSeq = toSeq;
    this.#lastSentSeq = toSeq;
    this.#nextReadAfterSeq = toSeq;
  }

  #hasAllChunksUpTo(targetSeq: number): boolean {
    if (this.#pendingChunks.length === 0) return false;
    let expected = this.#pendingChunks[0]!.seq;
    for (const c of this.#pendingChunks) {
      if (c.seq !== expected) return false;
      if (c.seq === targetSeq) return true;
      expected += 1;
    }
    return false;
  }

  #collectContiguousUpTo(targetSeq: number): BufferedChunk[] | null {
    const out: BufferedChunk[] = [];
    let expected = this.#pendingChunks[0]!.seq;
    for (const c of this.#pendingChunks) {
      if (c.seq !== expected) return null;
      out.push(c);
      if (c.seq === targetSeq) return out;
      expected += 1;
    }
    return null;
  }

  #wouldHitBatchBoundary(): boolean {
    if (this.#pendingChunks.length <= 1) return false;
    let totalBytes = 0;
    for (let i = 0; i < this.#pendingChunks.length; i++) {
      const c = this.#pendingChunks[i]!;
      if (c.rawBytes > this.#maxChunkBytes) return true;
      if (i > 0) {
        if (c.seq !== this.#pendingChunks[i - 1]!.seq + 1) return true;
        if (
          this.#rangeIndex.getRangeStartingAt(
            this.#sid,
            this.#generation,
            this.#incarnation,
            c.seq
          ) !== undefined
        ) {
          return true;
        }
      }
      if (totalBytes + c.rawBytes > this.#maxChunkBytes) return true;
      totalBytes += c.rawBytes;
    }
    return false;
  }

  #buildCoalescedProposal(chunks: readonly BufferedChunk[]): TermOutProposal {
    const first = chunks[0]!;
    const last = chunks[chunks.length - 1]!;
    const text = chunks.length === 1 ? first.data : chunks.map((c) => c.data).join("");
    const buf = Buffer.from(text, "utf8");
    return {
      record: {
        t: "term.out",
        sid: this.#sid,
        incarnation: this.#incarnation,
        firstSeq: first.seq,
        lastSeq: last.seq,
        dataB64: buf.toString("base64")
      },
      rawBytes: buf.byteLength,
      isSegmented: false,
      isFinalSegment: true,
      firstSeq: first.seq,
      lastSeq: last.seq
    };
  }
}
