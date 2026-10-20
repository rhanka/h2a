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
import { summarizeRestoreLedger } from "./restore.js";

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

describe("lot L1b RED: in-place ledger outcomes (attach/defer, never inject)", () => {
  const AT = "2026-10-20T00:00:00.000Z";

  it("should print one observed already-active ledger outcome per active primary", () => {
    const entries: RestoreLedgerEntry[] = [
      { session: "a", outcome: "already-active", at: AT },
    ];
    const en = printRestoreLedger(entries, "en");
    const fr = printRestoreLedger(entries, "fr");
    expect(en).toHaveLength(1);
    expect(en[0]).toContain("Already active");
    expect(fr[0]).toContain("Déjà active");
    expect(en[0]).not.toContain("Blocked");
  });

  it("should print a deferred outcome with its reason instead of a blocked line", () => {
    const entries: RestoreLedgerEntry[] = [
      { session: "b", outcome: "deferred", reason: "needs-adapter", at: AT },
    ];
    const en = printRestoreLedger(entries, "en");
    const fr = printRestoreLedger(entries, "fr");
    expect(en).toHaveLength(1);
    expect(en[0]).toContain("Deferred");
    expect(en[0]).toContain("needs-adapter");
    expect(fr[0]).toContain("Reportée");
    expect(en[0]).not.toContain("Blocked");
  });

  it("should count already-active and deferred outcomes in the observed summary", () => {
    const entries: RestoreLedgerEntry[] = [
      { session: "a", outcome: "already-active", at: AT },
      { session: "b", outcome: "deferred", reason: "needs-adapter", at: AT },
      { session: "c", outcome: "blocked", reason: "occupied-human", at: AT },
    ];
    expect(summarizeRestoreLedger(entries)).toEqual({
      launched: 0,
      blocked: 1,
      skipped: 0,
      failed: 0,
      "already-active": 1,
      deferred: 1,
    });
  });
});

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

  it("should count observed restore outcomes instead of planned tabs", () => {
    // The D2 ledger drives the totals: observed outcomes, never the plan.
    const entries: RestoreLedgerEntry[] = [
      { session: "a", outcome: "launched", window: "W1", at: "2026-10-20T00:00:00.000Z" },
      { session: "b", outcome: "blocked", reason: "occupied-human", at: "2026-10-20T00:00:00.000Z" },
      { session: "c", outcome: "launched", window: "W1", at: "2026-10-20T00:00:00.000Z" },
    ];
    expect(summarizeRestoreLedger(entries)).toEqual({
      launched: 2,
      blocked: 1,
      skipped: 0,
      failed: 0,
      "already-active": 0,
      deferred: 0,
    });
    expect(summarizeRestoreLedger([])).toEqual({
      launched: 0,
      blocked: 0,
      skipped: 0,
      failed: 0,
      "already-active": 0,
      deferred: 0,
    });
  });
});
