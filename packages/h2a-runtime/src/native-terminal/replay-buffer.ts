export type TerminalOutputChunk = Readonly<{
  seq: number;
  data: string;
}>;

export type TerminalReplayGap = Readonly<{
  fromSeq: number;
  toSeq: number;
}>;

export type TerminalReplay = Readonly<{
  chunks: ReadonlyArray<TerminalOutputChunk>;
  gap: TerminalReplayGap | null;
  latestSeq: number;
}>;

type BufferedChunk = Readonly<{
  chunk: TerminalOutputChunk;
  bytes: number;
  wireBytes: number;
}>;

export const NATIVE_TERMINAL_MAX_REPLAY_CHUNKS_PER_SESSION = 65_536;
// Leaves 8 MiB of the 32 MiB protocol frame for the response envelope and
// bounded identities, while charging the actual JSON-escaped chunk encoding.
export const NATIVE_TERMINAL_MAX_REPLAY_WIRE_BYTES_PER_SESSION =
  24 * 1024 * 1024;

export class TerminalReplayBuffer {
  readonly #maxBytes: number;
  readonly #maxChunks: number;
  readonly #maxWireBytes: number;
  readonly #chunks: BufferedChunk[] = [];
  #head = 0;
  #bytes = 0;
  #wireBytes = 0;
  #latestSeq = 0;

  constructor(
    maxBytes: number,
    limits: { maxChunks?: number; maxWireBytes?: number } = {},
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    const maxChunks =
      limits.maxChunks ?? NATIVE_TERMINAL_MAX_REPLAY_CHUNKS_PER_SESSION;
    const maxWireBytes =
      limits.maxWireBytes ??
      NATIVE_TERMINAL_MAX_REPLAY_WIRE_BYTES_PER_SESSION;
    if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0) {
      throw new RangeError("maxChunks must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxWireBytes) || maxWireBytes <= 0) {
      throw new RangeError("maxWireBytes must be a positive safe integer");
    }
    this.#maxBytes = maxBytes;
    this.#maxChunks = maxChunks;
    this.#maxWireBytes = maxWireBytes;
  }

  get latestSeq(): number {
    return this.#latestSeq;
  }

  append(data: string): TerminalOutputChunk {
    if (data.length === 0) {
      throw new RangeError("terminal output chunks must not be empty");
    }
    const chunk = Object.freeze({ seq: ++this.#latestSeq, data });
    const entry = Object.freeze({
      chunk,
      bytes: Buffer.byteLength(data, "utf8"),
      // One byte reserves either the array comma or a conservative bracket.
      wireBytes: Buffer.byteLength(JSON.stringify(chunk), "utf8") + 1,
    });
    this.#chunks.push(entry);
    this.#bytes += entry.bytes;
    this.#wireBytes += entry.wireBytes;

    while (
      (this.#bytes > this.#maxBytes ||
        this.#wireBytes > this.#maxWireBytes ||
        this.#chunks.length - this.#head > this.#maxChunks) &&
      this.#head < this.#chunks.length
    ) {
      const evicted = this.#chunks[this.#head++];
      if (evicted) {
        this.#bytes -= evicted.bytes;
        this.#wireBytes -= evicted.wireBytes;
      }
    }
    if (this.#head >= 1_024 && this.#head * 2 >= this.#chunks.length) {
      this.#chunks.splice(0, this.#head);
      this.#head = 0;
    }
    return chunk;
  }

  readAfter(afterSeq: number): TerminalReplay {
    if (
      !Number.isSafeInteger(afterSeq) ||
      afterSeq < 0 ||
      afterSeq > this.#latestSeq
    ) {
      throw new RangeError("afterSeq must identify this buffer's history");
    }
    const oldestAvailable =
      this.#chunks[this.#head]?.chunk.seq ?? this.#latestSeq + 1;
    const gap =
      afterSeq < oldestAvailable - 1
        ? Object.freeze({ fromSeq: afterSeq + 1, toSeq: oldestAvailable - 1 })
        : null;
    return Object.freeze({
      chunks: this.#chunks
        .slice(this.#head)
        .filter(({ chunk }) => chunk.seq > afterSeq)
        .map(({ chunk }) => chunk),
      gap,
      latestSeq: this.#latestSeq,
    });
  }
}
