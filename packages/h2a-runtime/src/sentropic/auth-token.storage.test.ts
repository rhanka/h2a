/**
 * Three storage properties the auth file must hold, asserted as the r2 revive
 * dossier staged them (revived from 44fc90179). LOCAL properties: they depend
 * on no upstream IdP fact and on no trust-anchor mechanism, which is why the
 * provenance guards are NOT here (Lot 0 follow-up).
 *
 * 1. A corrupt or unreadable auth file is silently treated as `{}` when written
 *    over, so the next login used to replace it and DELETE every other server's
 *    token (silent credential loss).
 * 2. A file that parses but is not a per-server map must be refused, not
 *    rewritten with the caller's map.
 * 3. A malformed `expiresAt` must be treated as expired — fail closed. A
 *    MISSING `expiresAt` stays fresh on purpose: whether a token may carry no
 *    expiry at all is gated on the undecided 39-auth validation profile, and
 *    flipping that written contract (auth-token.test.ts, expiry) belongs to
 *    that decision, not to a storage fix.
 *
 * PR #428 review round 2 added: the refusal of an unreadable file, no byte of a
 * damaged file in any error a caller may log, strict expiry parsing (an empty
 * or leniently parsed date is expired), and the writer lock seen from outside
 * (a live holder makes writers refuse, a dead one's lock is broken, the tmp
 * file is never shared).
 *
 * The concurrent-write lost-update properties live in their own probe file,
 * auth-token.lost-update.test.ts: they need a deterministic interposer on
 * node:fs, which would make every other test in this file run mocked.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import {
  AuthFileConcurrentWriteError,
  DamagedAuthFileError,
  authFilePath,
  isExpired,
  readAuth,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-auth-store-"));
}

/** Whatever a write left next to the auth file (a tmp, a lock): a finished write leaves nothing. */
function residue(dir: string): string[] {
  return readdirSync(dir).filter((name) => name !== "h2a-auth.json");
}

function thrown(run: () => void): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return undefined;
}

const tokA: SentropicAuthToken = {
  server: "https://a.example",
  issuer: "https://issuer-a.example",
  accessToken: "at-A",
};
const tokB: SentropicAuthToken = { ...tokA, server: "https://b.example", accessToken: "at-B" };

describe("a damaged auth file must never cost the tokens it still holds", () => {
  it("refuses to write over a file it cannot parse, instead of silently replacing it", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const before = readFileSync(authFilePath(dir), "utf8");

    // The file is damaged out of band — a truncated write, a disk-full event, an editor.
    writeFileSync(authFilePath(dir), "{ not json", "utf8");

    expect(() => writeAuth(tokB, dir)).toThrow(DamagedAuthFileError);

    // And the damaged content is still there to be recovered, not overwritten.
    expect(readFileSync(authFilePath(dir), "utf8")).toBe("{ not json");
    expect(before).toContain("at-A");
    expect(residue(dir)).toEqual([]);
  });

  it("refuses a file that parses but is not the expected shape", () => {
    const dir = freshDir();
    // Valid JSON, wrong root: an array where a per-server map is expected.
    const damaged = JSON.stringify([{ server: "https://a.example" }]);
    writeFileSync(authFilePath(dir), damaged, "utf8");

    expect(() => writeAuth(tokA, dir)).toThrow(DamagedAuthFileError);

    // Refused, not rewritten: the damaged bytes survive the refusal.
    expect(readFileSync(authFilePath(dir), "utf8")).toBe(damaged);
    expect(residue(dir)).toEqual([]);
  });

  it("refuses an auth file it cannot read (a directory in its place) and writes nothing", () => {
    const dir = freshDir();
    // EISDIR on read: deterministic, unlike a permission bit a root runner ignores.
    mkdirSync(authFilePath(dir));

    expect(() => writeAuth(tokA, dir)).toThrow(DamagedAuthFileError);

    expect(readdirSync(authFilePath(dir))).toEqual([]);
    expect(residue(dir)).toEqual([]);
  });

  it("never carries a byte of the damaged file into an error a caller may log", () => {
    const dir = freshDir();
    // V8's JSON.parse SyntaxError quotes the bytes around the failure. Damage the file right
    // at a token value — a lost opening quote, then a bare value — so a quoted fragment would
    // carry the `§` marker of the planted secret.
    for (const damaged of [
      '{"https://a.example":{"refreshToken":rt-§LEAK§-sentinel"}}',
      '{"https://a.example":{"refreshToken":rt-§LEAK§-sentinel}}',
    ]) {
      writeFileSync(authFilePath(dir), damaged, "utf8");

      const err = thrown(() => writeAuth(tokA, dir));

      expect(err).toBeInstanceOf(DamagedAuthFileError);
      // Everything a log line can render: the message, the stack, what console.error prints
      // (util.inspect, which includes any `cause`), and a deep inspect of every property.
      const rendered = [
        String(err),
        (err as Error).stack ?? "",
        inspect(err),
        inspect(err, { showHidden: true, depth: Number.POSITIVE_INFINITY }),
      ].join("\n");
      expect(rendered).not.toContain("§");
      expect(readFileSync(authFilePath(dir), "utf8")).toBe(damaged);
    }
  });
});

describe("expiry fails closed", () => {
  it("treats an unparseable expiresAt as expired, not as fresh", () => {
    // A date that cannot be parsed means freshness is unknown; unknown must not read as
    // fresh. The existing suite covers past / future / absent, never malformed, so this
    // closes a real hole without touching a documented contract.
    expect(isExpired({ ...tokA, expiresAt: "not-a-date" })).toBe(true);
  });

  it("treats an empty expiresAt as expired, while a missing one stays fresh", () => {
    expect(isExpired({ ...tokA, expiresAt: "" })).toBe(true);
    // The documented no-expiry contract, unchanged.
    expect(isExpired(tokA)).toBe(false);
  });

  it("treats a date Date.parse only reads leniently as expired", () => {
    // V8 (Node 20, 22, 24) reads each of these as an instant in 2999: none is an RFC 3339
    // instant, so none can vouch for freshness.
    for (const lenient of [
      "garbage 2999",
      "Z 2999-01-01",
      "2999-01-01", // a date, not an instant
      "2999-01-01T00:00:00", // no offset: local time, machine-dependent
      "2999-01-01 00:00:00Z",
      "2999-01-01t00:00:00z",
      "2999-01-01T00:00:00+0200",
      "2999-01-01T24:00:00Z", // hour 24 rolls over into the next day
      "2999-02-30T00:00:00Z", // a calendar overflow rolls over into March
    ]) {
      expect(isExpired({ ...tokA, expiresAt: lenient }), lenient).toBe(true);
    }
  });

  it("reads a strict RFC 3339 instant, in UTC or with an offset", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(isExpired({ ...tokA, expiresAt: "2026-01-01T00:00:01Z" }, now)).toBe(false);
    expect(isExpired({ ...tokA, expiresAt: "2026-01-01T00:00:00.500Z" }, now)).toBe(false);
    expect(isExpired({ ...tokA, expiresAt: "2026-01-01T01:00:01+01:00" }, now)).toBe(false);
    expect(isExpired({ ...tokA, expiresAt: "2026-01-01T00:00:00Z" }, now)).toBe(true);
    expect(isExpired({ ...tokA, expiresAt: "2025-12-31T19:59:59-04:00" }, now)).toBe(true);
    expect(isExpired({ ...tokA, expiresAt: "2024-02-29T12:00:00Z" }, now)).toBe(true);
  });
});

describe("the writer lock", () => {
  it("makes a writer refuse, writing nothing, while another live writer holds it", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const before = readFileSync(authFilePath(dir));
    const lock = `${authFilePath(dir)}.lock`;
    writeFileSync(lock, "4242:another-live-writer", { flag: "wx", mode: 0o600 });

    const err = thrown(() => writeAuth(tokB, dir));

    expect(err).toBeInstanceOf(AuthFileConcurrentWriteError);
    expect((err as AuthFileConcurrentWriteError).reason).toBe("lock-busy");
    expect(readFileSync(authFilePath(dir)).equals(before)).toBe(true);
    // A live holder's lock is not ours to break or to release.
    expect(readFileSync(lock, "utf8")).toBe("4242:another-live-writer");
    expect(residue(dir)).toEqual(["h2a-auth.json.lock"]);
  }, 15_000);

  it("breaks a lock left by a dead writer and leaves no lock behind", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const lock = `${authFilePath(dir)}.lock`;
    writeFileSync(lock, "4242:dead-writer", { flag: "wx", mode: 0o600 });
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(lock, longAgo, longAgo);

    writeAuth(tokB, dir);

    expect(readAuth("https://a.example", dir)?.accessToken).toBe("at-A");
    expect(readAuth("https://b.example", dir)?.accessToken).toBe("at-B");
    expect(residue(dir)).toEqual([]);
  });

  it("never writes through another writer's temp file, even one sharing our pid", () => {
    // Two containers sharing $HOME both run as pid 1: a tmp named by pid alone is shared.
    const dir = freshDir();
    writeAuth(tokA, dir);
    const theirs = `${authFilePath(dir)}.tmp.${process.pid}`;
    writeFileSync(theirs, "their in-flight write", { mode: 0o600 });

    writeAuth(tokB, dir);

    expect(readFileSync(theirs, "utf8")).toBe("their in-flight write");
    expect(readAuth("https://b.example", dir)?.accessToken).toBe("at-B");
    expect(residue(dir)).toEqual([`h2a-auth.json.tmp.${process.pid}`]);
  });
});
