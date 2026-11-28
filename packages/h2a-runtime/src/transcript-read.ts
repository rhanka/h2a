/**
 * Bounded transcript readers for `restore` and the station panel.
 *
 * A conversation transcript grows to hundreds of megabytes. The restore plan
 * needs two facts from each one: the JSON of its first line, and the last
 * `custom-title` it records. Both used to load the whole file as one UTF-8
 * string, on the calling thread, once per plan. These readers return the same
 * values from bounded reads:
 *
 * - the first line is read by chunks until its newline;
 * - the last title is searched from the end of the file, on raw bytes, and
 *   only the matching line is decoded;
 * - a title is remembered for as long as the file keeps its size and mtime,
 *   and a transcript that only grew is searched in its new bytes alone, so a
 *   long-lived caller (the station) pays for a transcript once.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const FIRST_LINE_CHUNK_BYTES = 64 * 1024;
const TITLE_SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
const LINE_PROBE_CHUNK_BYTES = 64 * 1024;
const TITLE_NEEDLE = Buffer.from('"custom-title"', "utf8");
const NEWLINE = 0x0a;
const TITLE_CACHE_MAX_ENTRIES = 8192;
/** Bytes kept from the end of a scanned file to prove a later append. */
const TAIL_PROOF_BYTES = 64;

/** Read `[start, end)` of an open file; a short read returns what was read. */
function readRange(fd: number, start: number, end: number): Buffer {
  const length = Math.max(0, end - start);
  const out = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, out, done, length - done, start + done);
    if (n <= 0) break;
    done += n;
  }
  return done === length ? out : out.subarray(0, done);
}

/**
 * First line of a file, without its newline. Reads chunk by chunk and stops
 * at the first newline: the cost follows the line, never the file.
 * Returns undefined when the file cannot be read.
 */
export function readFirstLine(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const parts: Buffer[] = [];
    let position = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(FIRST_LINE_CHUNK_BYTES);
      const n = readSync(fd, chunk, 0, chunk.length, position);
      if (n <= 0) break;
      const filled = chunk.subarray(0, n);
      const newline = filled.indexOf(NEWLINE);
      if (newline !== -1) {
        parts.push(filled.subarray(0, newline));
        break;
      }
      parts.push(filled);
      position += n;
    }
    return Buffer.concat(parts).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** The whole line holding byte `at`, with the offset of its first byte. */
function readLineAround(
  fd: number,
  size: number,
  at: number,
): { lineStart: number; text: string } {
  let lineStart = 0;
  let cursor = at;
  while (cursor > 0) {
    const from = Math.max(0, cursor - LINE_PROBE_CHUNK_BYTES);
    const chunk = readRange(fd, from, cursor);
    const newline = chunk.lastIndexOf(NEWLINE);
    if (newline !== -1) {
      lineStart = from + newline + 1;
      break;
    }
    if (chunk.length === 0) break;
    cursor = from;
  }
  let lineEnd = size;
  cursor = at;
  while (cursor < size) {
    const to = Math.min(size, cursor + LINE_PROBE_CHUNK_BYTES);
    const chunk = readRange(fd, cursor, to);
    const newline = chunk.indexOf(NEWLINE);
    if (newline !== -1) {
      lineEnd = cursor + newline;
      break;
    }
    if (chunk.length === 0) break;
    cursor = to;
  }
  return { lineStart, text: readRange(fd, lineStart, lineEnd).toString("utf8") };
}

function titleOfLine(line: string): string | undefined {
  try {
    const obj = JSON.parse(line) as { type?: string; customTitle?: unknown };
    if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
      return obj.customTitle;
    }
  } catch {
    /* a malformed line never hides an earlier valid title */
  }
  return undefined;
}

/**
 * Last valid title whose marker starts at or after `floor`; `null` when that
 * range holds none (the caller then keeps what it knew about the bytes before).
 */
function scanLastCustomTitle(fd: number, size: number, floor = 0): string | null {
  // Chunks are taken from the end of the file. Inside a chunk the candidates
  // are collected with the forward byte search (the fast one) and tried last
  // to first. `limit` is exclusive: a candidate must START before it.
  let limit = size;
  while (limit > floor) {
    const start = Math.max(floor, limit - TITLE_SCAN_CHUNK_BYTES);
    // The overlap lets a needle straddle the chunk boundary.
    const chunk = readRange(fd, start, Math.min(size, limit + TITLE_NEEDLE.length - 1));
    const candidates: number[] = [];
    for (
      let index = chunk.indexOf(TITLE_NEEDLE);
      index !== -1 && start + index < limit;
      index = chunk.indexOf(TITLE_NEEDLE, index + 1)
    ) {
      candidates.push(start + index);
    }
    let next = start;
    while (candidates.length > 0) {
      const at = candidates.pop()!;
      const line = readLineAround(fd, size, at);
      const title = titleOfLine(line.text);
      if (title !== undefined) return title;
      // A quoted or malformed mention: every candidate of that line is spent.
      while (candidates.length > 0 && candidates[candidates.length - 1]! >= line.lineStart) {
        candidates.pop();
      }
      next = Math.min(next, line.lineStart);
    }
    limit = next;
  }
  return null;
}

/** Offset just after the last newline of the file (its size when it ends on one). */
function lastLineStart(fd: number, size: number): number {
  let cursor = size;
  while (cursor > 0) {
    const from = Math.max(0, cursor - LINE_PROBE_CHUNK_BYTES);
    const chunk = readRange(fd, from, cursor);
    const newline = chunk.lastIndexOf(NEWLINE);
    if (newline !== -1) return from + newline + 1;
    if (chunk.length === 0) break;
    cursor = from;
  }
  return 0;
}

type TitleCacheEntry = {
  size: number;
  mtimeMs: number;
  title: string | undefined;
  /** Last bytes of the file as scanned: unchanged ⇒ the file only grew. */
  tail: Buffer;
  /** Start of the last, possibly unfinished, line of the file as scanned. */
  openLineStart: number;
};
const titleCache = new Map<string, TitleCacheEntry>();

/**
 * Last `customTitle` recorded in a transcript file (the last valid
 * `{"type":"custom-title",…}` line wins). Undefined when the file is absent,
 * unreadable or never titled.
 *
 * The answer is cached per file. Same size and mtime: served as is. Larger
 * file whose former end is byte-identical (an append, the way transcripts
 * grow): only the appended bytes are searched, and the former answer stands
 * when they hold no title. Anything else: the file is searched again.
 */
export function readLastCustomTitle(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const stat = fstatSync(fd);
    const cached = titleCache.get(file);
    if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.title;
    }
    let title: string | undefined;
    const appended =
      cached !== undefined &&
      stat.size > cached.size &&
      cached.tail.length > 0 &&
      readRange(fd, cached.size - cached.tail.length, cached.size).equals(cached.tail);
    if (cached !== undefined && appended) {
      // Resume at the line that was still open at the former end: a title
      // caught half-written then is complete now.
      const fresh = scanLastCustomTitle(fd, stat.size, cached.openLineStart);
      title = fresh === null ? cached.title : fresh;
    } else {
      title = scanLastCustomTitle(fd, stat.size) ?? undefined;
    }
    if (titleCache.size >= TITLE_CACHE_MAX_ENTRIES) titleCache.clear();
    titleCache.set(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      title,
      tail: readRange(fd, Math.max(0, stat.size - TAIL_PROOF_BYTES), stat.size),
      openLineStart: lastLineStart(fd, stat.size),
    });
    return title;
  } catch {
    return undefined; // no transcript / unreadable
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Test seam: forget every cached title. */
export function clearCustomTitleCacheForTests(): void {
  titleCache.clear();
}
