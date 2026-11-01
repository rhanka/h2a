import { gzipSync } from "fflate";

// Native zlib implementations differ between Node builds, even at the same
// compression level. Pin the measurement engine and gzip timestamp so the
// committed record compares exact bytes across the supported Node matrix.
export const OFFLINE_GZIP = Object.freeze({ engine: "fflate@0.8.3", level: 6, mtime: 0 });

export function gzipOfflineResource(text) {
  return gzipSync(Buffer.from(text, "utf8"), { level: OFFLINE_GZIP.level, mtime: OFFLINE_GZIP.mtime });
}
