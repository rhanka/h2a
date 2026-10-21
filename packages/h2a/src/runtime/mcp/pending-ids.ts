import { readFileSync } from "node:fs";

/**
 * Round-3 P2 (reviews pr382-r3) — read one durable pending-wake id file.
 *
 * Absent (`ENOENT`) reads as "no pending" (`[]`): a clean start stays
 * quiet. Anything else that prevents proving the content — a truncated or
 * corrupt JSON document, a non-array document, an unreadable path — THROWS:
 * the caller (the inbox-wake handler's `pendingUnreadable` branch) must
 * tell "nothing pending" apart from "pending state unknown" so a restart
 * retries the inbox from scratch instead of burying a deferred wake.
 * The writer (`save`) only ever persists string arrays, so a non-array
 * document is foreign/corrupt, never a valid empty store.
 */
export function readPendingIdsFile(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `inbox-wake: pending store unreadable at ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `inbox-wake: pending store corrupt at ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`inbox-wake: pending store corrupt at ${path} (not an id array)`);
  }
  return parsed.filter((id): id is string => typeof id === "string");
}
