/**
 * Deterministic lost-update checks for writeAuth, stabilized from the r2 revive
 * dossier probe ("Demandes rehydratees", defect 2) and widened by PR #428 review
 * round 2 (P1).
 *
 * Round 1 re-read the bytes it had merged from just before its rename. That is
 * compare-then-rename, not a compare-and-swap: a write landing AFTER the re-read,
 * right before the rename, or on a file still absent was lost. So another writer
 * is put at each point of writeAuth's read-modify-write window — after its merge
 * read, after its re-read, right before its rename — on an existing and on an
 * absent file, in both commit orders:
 *
 * - theirs first: the other writer commits inside our window, and its token must
 *   survive ours;
 * - ours first: the other writer READ inside our window and commits after we
 *   return, and our token, which writeAuth reported written, must survive it.
 *
 * The other writer behaves as a second writeAuth process: it takes
 * `<auth>.lock` with O_EXCL, and when that fails it retries once our writeAuth
 * has returned, as a waiting process would. It runs with the REAL fs,
 * synchronously, at the exact interposed point: no timing, no sleep.
 *
 * The first test keeps the round-1 probe: a writer that IGNORES the lock (an
 * older binary) landing right after our merge read is still caught, by the byte
 * re-read kept as second line.
 */

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({
  /** The auth file under test; empty disarms the interposer. */
  authPath: "",
  /** Reads of `authPath` since the interposer was armed. */
  reads: 0,
  afterAuthRead: undefined as ((n: number) => void) | undefined,
  beforeAuthRename: undefined as (() => void) | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (probe.authPath === "" || String(args[0]) !== probe.authPath) return actual.readFileSync(...args);
    const n = ++probe.reads;
    try {
      return actual.readFileSync(...args);
    } finally {
      // After the read, whether it returned bytes or threw ENOENT: what writeAuth sees is fixed.
      probe.afterAuthRead?.(n);
    }
  }) as typeof actual.readFileSync;
  const renameSync = ((...args: Parameters<typeof actual.renameSync>) => {
    if (probe.authPath !== "" && String(args[1]) === probe.authPath) {
      const hook = probe.beforeAuthRename;
      probe.beforeAuthRename = undefined;
      hook?.();
    }
    actual.renameSync(...args);
  }) as typeof actual.renameSync;
  return { ...actual, readFileSync, renameSync };
});

import {
  AuthFileConcurrentWriteError,
  authFilePath,
  readAuth,
  serverKey,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const tokA: SentropicAuthToken = { server: "https://a.example", issuer: "https://issuer-a.example", accessToken: "at-A" };
const tokB: SentropicAuthToken = { ...tokA, server: "https://b.example", accessToken: "at-B" };
const tokC: SentropicAuthToken = { ...tokA, server: "https://c.example", accessToken: "at-C" };

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-auth-race-"));
}

function thrown(run: () => void): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return undefined;
}

interface Hooks {
  afterAuthRead?: (n: number) => void;
  beforeAuthRename?: () => void;
}

/** Run `fn` with the interposer armed on `dir`'s auth file, always disarmed afterwards. */
function interposed(dir: string, hooks: Hooks, fn: () => void): void {
  probe.authPath = authFilePath(dir);
  probe.reads = 0;
  probe.afterAuthRead = hooks.afterAuthRead;
  probe.beforeAuthRename = hooks.beforeAuthRename;
  try {
    fn();
  } finally {
    probe.authPath = "";
    probe.afterAuthRead = undefined;
    probe.beforeAuthRename = undefined;
  }
}

/** A second writeAuth process under the `<auth>.lock` protocol, with the real fs. */
function otherWriter(dir: string, token: SentropicAuthToken) {
  const path = authFilePath(dir);
  const lock = `${path}.lock`;
  let base: Record<string, SentropicAuthToken> = {};
  let state: "idle" | "holding" | "committed" = "idle";
  return {
    get state() {
      return state;
    },
    /** O_EXCL on the lock, then the merge read; false while another writer holds the lock. */
    take(): boolean {
      try {
        realFs.closeSync(realFs.openSync(lock, "wx", 0o600));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
      }
      base = realFs.existsSync(path) ? (JSON.parse(realFs.readFileSync(path, "utf8")) as typeof base) : {};
      state = "holding";
      return true;
    },
    commit(): void {
      realFs.writeFileSync(path, JSON.stringify({ ...base, [serverKey(token.server)]: token }, null, 2) + "\n");
      realFs.rmSync(lock);
      state = "committed";
    },
  };
}

const WINDOW = ["after the merge read", "after the re-read", "right before the rename"] as const;
type WindowPoint = (typeof WINDOW)[number];
type Order = "theirs first" | "ours first";

function hooksAt(point: WindowPoint, arrive: () => void): Hooks {
  if (point === "right before the rename") return { beforeAuthRename: arrive };
  const at = point === "after the merge read" ? 1 : 2;
  return {
    afterAuthRead: (n) => {
      if (n === at) arrive();
    },
  };
}

/** writeAuth(B) with the other writer arriving at `point`; the servers missing at the end. */
function lostAt(point: WindowPoint, order: Order, existing: boolean): string[] {
  const dir = freshDir();
  if (existing) writeAuth(tokA, dir);
  const other = otherWriter(dir, tokC);
  let arrived = false;
  interposed(
    dir,
    hooksAt(point, () => {
      arrived = true;
      if (other.take() && order === "theirs first") other.commit();
    }),
    () => writeAuth(tokB, dir),
  );
  expect(arrived, `the other writer reached "${point}"`).toBe(true);
  // A writer that waited on our lock goes now, once we have released it.
  if (other.state === "idle") expect(other.take(), "our writeAuth released its lock").toBe(true);
  if (other.state === "holding") other.commit();
  const expected = existing ? [tokA, tokB, tokC] : [tokB, tokC];
  return expected.filter((t) => readAuth(t.server, dir)?.accessToken !== t.accessToken).map((t) => t.server);
}

function lossesAcrossTheWindow(order: Order, existing: boolean): Record<WindowPoint, string[]> {
  return Object.fromEntries(WINDOW.map((point) => [point, lostAt(point, order, existing)])) as Record<WindowPoint, string[]>;
}

const NOTHING_LOST = Object.fromEntries(WINDOW.map((point) => [point, []]));

describe("a write landing between read and commit", () => {
  it("is not lost", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    // A writer that ignores the lock completes its own writeAuth(C) right after our merge read.
    interposed(
      dir,
      {
        afterAuthRead: (n) => {
          if (n !== 1) return;
          realFs.writeFileSync(authFilePath(dir), JSON.stringify({ "https://a.example": tokA, "https://c.example": tokC }), "utf8");
        },
      },
      () => writeAuth(tokB, dir),
    );
    expect(readAuth("https://b.example", dir)?.accessToken).toBe("at-B");
    expect(readAuth("https://c.example", dir)?.accessToken).toBe("at-C");
  });
});

describe("another writer anywhere in writeAuth's read-modify-write window", () => {
  it("that commits first keeps its token, on an existing file", () => {
    expect(lossesAcrossTheWindow("theirs first", true)).toEqual(NOTHING_LOST);
  });

  it("that commits first keeps its token, on an absent file", () => {
    expect(lossesAcrossTheWindow("theirs first", false)).toEqual(NOTHING_LOST);
  });

  it("that read inside it and commits after us cannot drop ours, on an existing file", () => {
    expect(lossesAcrossTheWindow("ours first", true)).toEqual(NOTHING_LOST);
  });

  it("that read inside it and commits after us cannot drop ours, on an absent file", () => {
    expect(lossesAcrossTheWindow("ours first", false)).toEqual(NOTHING_LOST);
  });
});

describe("the writer lock", () => {
  it("refuses to commit once its lock was taken over, and leaves the new holder's lock alone", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const lock = `${authFilePath(dir)}.lock`;
    const other = otherWriter(dir, tokC);
    let tookOver = false;
    // Our writer stalls past the stale threshold right after its merge read (a suspended
    // process): another writer breaks the lock as stale, takes it, and reads the file.
    let err: unknown;
    interposed(
      dir,
      {
        afterAuthRead: (n) => {
          if (n !== 1) return;
          realFs.rmSync(lock, { force: true });
          tookOver = other.take();
        },
      },
      () => {
        err = thrown(() => writeAuth(tokB, dir));
      },
    );
    expect(tookOver).toBe(true);
    expect(err).toBeInstanceOf(AuthFileConcurrentWriteError);
    expect((err as AuthFileConcurrentWriteError).reason).toBe("lock-lost");
    // Not released by the writer that lost it: the new holder still holds it.
    expect(realFs.existsSync(lock)).toBe(true);
    other.commit();
    expect(readAuth("https://a.example", dir)?.accessToken).toBe("at-A");
    expect(readAuth("https://c.example", dir)?.accessToken).toBe("at-C");
    // Refused, and its caller was told: nothing reported written was dropped.
    expect(readAuth("https://b.example", dir)).toBeUndefined();
    expect(readdirSync(dir)).toEqual(["h2a-auth.json"]);
  });

  it("refuses after bounded retries when a writer ignoring it rewrites the file inside every attempt", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    let rewrites = 0;
    let err: unknown;
    interposed(
      dir,
      {
        // Reads alternate merge read (odd) / re-read (even): rewrite after every merge read,
        // so every re-read sees bytes it did not merge from.
        afterAuthRead: (n) => {
          if (n % 2 !== 1) return;
          rewrites += 1;
          const server = `https://c${rewrites}.example`;
          realFs.writeFileSync(authFilePath(dir), JSON.stringify({ [tokA.server]: tokA, [server]: { ...tokC, server } }, null, 2));
        },
      },
      () => {
        err = thrown(() => writeAuth(tokB, dir));
      },
    );
    expect(err).toBeInstanceOf(AuthFileConcurrentWriteError);
    expect((err as AuthFileConcurrentWriteError).reason).toBe("kept-changing");
    // The refusal loses nothing: the last writer's bytes are intact, ours never renamed in.
    expect(readAuth(`https://c${rewrites}.example`, dir)?.accessToken).toBe("at-C");
    expect(readAuth("https://b.example", dir)).toBeUndefined();
    expect(readdirSync(dir)).toEqual(["h2a-auth.json"]);
  });
});
