import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failState = { failWriteCall: 0, writeCalls: 0, readFileCalls: [] as string[] };

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeSync = (...args: [fd: number, ...rest: unknown[]]): number => {
    failState.writeCalls += 1;
    if (failState.failWriteCall > 0 && failState.writeCalls === failState.failWriteCall) {
      throw new Error("boom-write");
    }
    return (actual.writeSync as (...call: unknown[]) => number)(...args);
  };
  const readFileSync = (...args: [path: unknown, ...rest: unknown[]]): unknown => {
    failState.readFileCalls.push(String(args[0]));
    return (actual.readFileSync as (...call: unknown[]) => unknown)(...args);
  };
  return { ...actual, writeSync, readFileSync };
});

import {
  appendCrashLog,
  readCrashLog,
  readFileTailLines,
  resolveCrashLogPath,
} from "./crash-log.js";

describe("crash-log drop receipt", () => {
  let root = "";
  let log = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-crashdrops-"));
    log = resolveCrashLogPath("cli", { XDG_STATE_HOME: join(root, "state") });
    failState.failWriteCall = 0;
    failState.writeCalls = 0;
    failState.readFileCalls = [];
  });

  afterEach(() => {
    failState.failWriteCall = 0;
    failState.writeCalls = 0;
    failState.readFileCalls = [];
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps earlier drops when the replay write itself fails", async () => {
    // rev350r2 constat 5: clearing the receipt before writeAll loses the
    // earlier drops when that write fails. Two contention drops (pending=2),
    // then a failing success attempt, then a success: the replayed row must
    // still account all three drops.
    const { writeFileSync, rmSync: rmFile } = await import("node:fs");
    expect(appendCrashLog("cli", { event: "start" }, log)).toBe(true);
    for (let i = 0; i < 2; i++) {
      writeFileSync(`${log}.lock`, "99999999:live");
      expect(appendCrashLog("cli", { event: "refusal", reason: `contended-${i}` }, log)).toBe(false);
      rmFile(`${log}.lock`, { force: true });
    }
    // Next success attempt: lock-token write is call #1, the receipt+row
    // write is call #2 — fail exactly that one.
    failState.writeCalls = 0;
    failState.failWriteCall = 2;
    expect(appendCrashLog("cli", { event: "refusal", reason: "lost-write" }, log)).toBe(false);
    failState.failWriteCall = 0;
    expect(appendCrashLog("cli", { event: "refusal", reason: "after-failure" }, log)).toBe(true);
    const rows = readCrashLog("cli", log);
    const dropped = rows.filter((row) => row.event === "dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.detail).toContain("3 crash-log rows dropped");
    expect(rows.at(-1)).toMatchObject({ event: "refusal", reason: "after-failure" });
  });

  it("reads the tail without loading the whole file", async () => {
    // rev350r2 constat 4: the viewer tails a raw server log that may hold
    // megabytes — it must scan a bounded window from the end (positional
    // reads), never readFileSync the whole file.
    const { writeFileSync } = await import("node:fs");
    const raw = join(root, "big.log");
    const short = Array.from({ length: 20 }, (_, i) => `tail-${i}`);
    writeFileSync(raw, `${"H".repeat(1024 * 1024)}\n${short.join("\n")}\n`);
    failState.readFileCalls = [];
    expect(readFileTailLines(raw, 20)).toEqual(short);
    expect(failState.readFileCalls.filter((path) => path === raw)).toHaveLength(0);
  });
});
