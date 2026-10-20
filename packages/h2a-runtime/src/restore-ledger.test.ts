import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendRestoreLedgerEntry,
  printRestoreLedger,
  writeRestoreLedgerRecord,
  type RestoreLedgerEntry,
} from "./index.js";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function launched(session: string, window: string): RestoreLedgerEntry {
  return { session, outcome: "launched", window, at: "2026-10-20T00:00:00.000Z" };
}

function blocked(session: string, remedy: string): RestoreLedgerEntry {
  return { session, outcome: "blocked", reason: "missing-cli", remedy, at: "2026-10-20T00:00:00.000Z" };
}

describe("lot L1a RED: run-scoped restore ledger", () => {
  it("should persist the ledger only to the caller-supplied run-scoped record path", () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-l1a-ledger-"));
    scratchRoots.push(root);
    const recordPath = join(root, "run-1", "ledger.json");
    const entries = appendRestoreLedgerEntry([], launched("s1", "W1"));
    writeRestoreLedgerRecord(recordPath, entries);
    const stored = JSON.parse(readFileSync(recordPath, "utf8")) as { entries: RestoreLedgerEntry[] };
    expect(stored.entries).toEqual(entries);
    // No impl-chosen location: without an explicit path the ledger is never written.
    expect(() => writeRestoreLedgerRecord("", entries)).toThrow();
  });

  it("should print the ledger through the locale catalog", () => {
    const entries = [launched("s1", "W1"), blocked("s2", "h2a attach s2")];
    const en = printRestoreLedger(entries, "en");
    const fr = printRestoreLedger(entries, "fr");
    expect(en.length).toBe(2);
    expect(fr.length).toBe(2);
    // Same entries, different languages, no mixing: the French lines come
    // from the fr catalog, never a hardcoded copy of the English text.
    expect(fr[0]).not.toBe(en[0]);
    expect(fr[1]).not.toBe(en[1]);
    expect(fr.join("\n")).not.toContain(en[0]);
  });
});
