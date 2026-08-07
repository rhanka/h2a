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
}>;

export class TerminalReplayBuffer {
  readonly #maxBytes: number;
  readonly #chunks: BufferedChunk[] = [];
  #bytes = 0;
  #latestSeq = 0;

  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    this.#maxBytes = maxBytes;
  }

  append(data: string): TerminalOutputChunk {
    if (data.length === 0) {
      throw new RangeError("terminal output chunks must not be empty");
    }
    const chunk = Object.freeze({ seq: ++this.#latestSeq, data });
    const entry = Object.freeze({
      chunk,
      bytes: Buffer.byteLength(data, "utf8"),
    });
    this.#chunks.push(entry);
    this.#bytes += entry.bytes;

    while (this.#bytes > this.#maxBytes && this.#chunks.length > 0) {
      const evicted = this.#chunks.shift();
      if (evicted) this.#bytes -= evicted.bytes;
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
    const oldestAvailable = this.#chunks[0]?.chunk.seq ?? this.#latestSeq + 1;
    const gap =
      afterSeq < oldestAvailable - 1
        ? Object.freeze({ fromSeq: afterSeq + 1, toSeq: oldestAvailable - 1 })
        : null;
    return Object.freeze({
      chunks: this.#chunks
        .map(({ chunk }) => chunk)
        .filter(({ seq }) => seq > afterSeq),
      gap,
      latestSeq: this.#latestSeq,
    });
  }
}
