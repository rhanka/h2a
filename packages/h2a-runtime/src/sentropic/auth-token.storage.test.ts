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
 * The concurrent-write lost-update property lives in its own probe file,
 * auth-token.lost-update.test.ts: it needs a deterministic interposer on
 * node:fs, which would make every other test in this file run mocked.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { authFilePath, isExpired, writeAuth, type SentropicAuthToken } from "./auth-token.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-auth-store-"));
}

const tokA: SentropicAuthToken = {
  server: "https://a.example",
  issuer: "https://issuer-a.example",
  accessToken: "at-A",
};

describe("a damaged auth file must never cost the tokens it still holds", () => {
  it("refuses to write over a file it cannot parse, instead of silently replacing it", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const before = readFileSync(authFilePath(dir), "utf8");

    // The file is damaged out of band — a truncated write, a disk-full event, an editor.
    writeFileSync(authFilePath(dir), "{ not json", "utf8");

    const tokB: SentropicAuthToken = { ...tokA, server: "https://b.example", accessToken: "at-B" };
    expect(() => writeAuth(tokB, dir)).toThrow();

    // And the damaged content is still there to be recovered, not overwritten.
    expect(readFileSync(authFilePath(dir), "utf8")).toBe("{ not json");
    expect(before).toContain("at-A");
  });

  it("refuses a file that parses but is not the expected shape", () => {
    const dir = freshDir();
    // Valid JSON, wrong root: an array where a per-server map is expected.
    const damaged = JSON.stringify([{ server: "https://a.example" }]);
    writeFileSync(authFilePath(dir), damaged, "utf8");

    expect(() => writeAuth(tokA, dir)).toThrow();

    // Refused, not rewritten: the damaged bytes survive the refusal.
    expect(readFileSync(authFilePath(dir), "utf8")).toBe(damaged);
  });
});

describe("expiry fails closed", () => {
  it("treats an unparseable expiresAt as expired, not as fresh", () => {
    // A date that cannot be parsed means freshness is unknown; unknown must not read as
    // fresh. The existing suite covers past / future / absent, never malformed, so this
    // closes a real hole without touching a documented contract.
    expect(isExpired({ ...tokA, expiresAt: "not-a-date" })).toBe(true);
  });
});
