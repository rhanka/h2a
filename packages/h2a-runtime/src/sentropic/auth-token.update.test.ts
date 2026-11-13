/**
 * The per-server read-modify-write the sentropic publish client needs on top of the token
 * store: `removeAuth` (logout) and `updateAuth` (refresh-token rotation as a compare-and-set
 * on ONE server's entry). Both must keep the store's fail-closed rules: a damaged file is
 * refused and left untouched, another server's token is never lost, and a write landing in
 * the merge window survives.
 *
 * The concurrent-write case uses the same deterministic interposer as
 * auth-token.lost-update.test.ts (a node:fs mock), so it lives in its own file: every test
 * here runs with that mock installed, and the mock is a pass-through until a hook is armed.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

let betweenReadAndCommit: (() => void) | undefined;
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const out = actual.readFileSync(...args);
      const hook = betweenReadAndCommit;
      betweenReadAndCommit = undefined;
      if (hook) hook();
      return out;
    },
  };
});

import {
  AuthFileConcurrentWriteError,
  DamagedAuthFileError,
  authFilePath,
  readAuth,
  removeAuth,
  updateAuth,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-auth-update-"));
}

const tokA: SentropicAuthToken = {
  server: "https://a.example",
  issuer: "https://issuer-a.example",
  accessToken: "at-A1",
  refreshToken: "rt-A1",
  expiresAt: "2999-01-01T00:00:00.000Z",
  subject: "user-a",
};
const tokB: SentropicAuthToken = { ...tokA, server: "https://b.example", accessToken: "at-B", refreshToken: "rt-B" };
const tokC: SentropicAuthToken = { ...tokA, server: "https://c.example", accessToken: "at-C", refreshToken: "rt-C" };

describe("removeAuth", () => {
  it("removes one server's token and keeps every other server's token", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    writeAuth(tokB, dir);
    expect(removeAuth("https://a.example/", dir)).toBe(true);
    expect(readAuth("https://a.example", dir)).toBeUndefined();
    expect(readAuth("https://b.example", dir)).toEqual(tokB);
    expect(statSync(authFilePath(dir)).mode & 0o777).toBe(0o600);
  });

  it("writes nothing when the server holds no token", () => {
    const dir = freshDir();
    expect(removeAuth("https://a.example", dir)).toBe(false);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("refuses to rewrite a damaged auth file and leaves its bytes untouched", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    writeFileSync(authFilePath(dir), "{ not json", "utf8");
    expect(() => removeAuth("https://a.example", dir)).toThrow(DamagedAuthFileError);
    expect(readFileSync(authFilePath(dir), "utf8")).toBe("{ not json");
  });
});

describe("updateAuth", () => {
  it("hands the mutator only the token bound to the requested server", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    writeAuth(tokB, dir);
    const seen: Array<SentropicAuthToken | undefined> = [];
    updateAuth("https://b.example", (current) => {
      seen.push(current);
      return current;
    }, dir);
    expect(seen.at(-1)).toEqual(tokB);
    updateAuth("https://evil.example", (current) => {
      seen.push(current);
      return current;
    }, dir);
    expect(seen.at(-1)).toBeUndefined();
  });

  it("never hands the mutator an entry whose own server differs from its namespace (tampered file)", () => {
    const dir = freshDir();
    // A file edited by hand (or by another tool) files a token for evil under a's namespace.
    writeFileSync(authFilePath(dir), JSON.stringify({ "https://a.example": { ...tokA, server: "https://evil.example" } }), "utf8");
    const seen: Array<SentropicAuthToken | undefined> = [];
    updateAuth("https://a.example", (current) => {
      seen.push(current);
      return current;
    }, dir);
    expect(seen).toEqual([undefined]);
  });

  it("replaces the rotated pair atomically and never keeps the old refresh token", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    writeAuth(tokB, dir);
    const rotated = { ...tokA, accessToken: "at-A2", refreshToken: "rt-A2" };
    const stored = updateAuth("https://a.example", (current) =>
      current?.refreshToken === "rt-A1" ? rotated : current, dir);
    expect(stored).toEqual(rotated);
    expect(readAuth("https://a.example", dir)).toEqual(rotated);
    expect(readFileSync(authFilePath(dir), "utf8")).not.toContain("rt-A1");
    expect(readAuth("https://b.example", dir)).toEqual(tokB);
  });

  it("keeps a pair another writer already rotated (compare-and-set on the refresh token)", () => {
    const dir = freshDir();
    const theirs = { ...tokA, accessToken: "at-A3", refreshToken: "rt-A3" };
    writeAuth(theirs, dir);
    const ours = { ...tokA, accessToken: "at-A2", refreshToken: "rt-A2" };
    const stored = updateAuth("https://a.example", (current) =>
      current?.refreshToken === "rt-A1" ? ours : current, dir);
    expect(stored).toEqual(theirs);
    expect(readAuth("https://a.example", dir)).toEqual(theirs);
  });

  it("does not lose another server's write landing between its read and its commit", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    betweenReadAndCommit = () => {
      writeFileSync(authFilePath(dir), JSON.stringify({ "https://a.example": tokA, "https://c.example": tokC }), "utf8");
    };
    updateAuth("https://a.example", () => undefined, dir);
    expect(readAuth("https://a.example", dir)).toBeUndefined();
    expect(readAuth("https://c.example", dir)).toEqual(tokC);
  });

  it("refuses to store a token bound to another server under this server", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    expect(() => updateAuth("https://a.example", () => tokB, dir)).toThrow(/refusing to use it/);
    expect(readAuth("https://a.example", dir)).toEqual(tokA);
  });
});

describe("updateAuth under the writer lock", () => {
  it("refuses while another live writer holds the lock, writing nothing and leaving its lock", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    const before = readFileSync(authFilePath(dir), "utf8");
    const lock = `${authFilePath(dir)}.lock`;
    writeFileSync(lock, "4242:another-live-writer", { flag: "wx", mode: 0o600 });
    let caught: unknown;
    try {
      removeAuth("https://a.example", dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthFileConcurrentWriteError);
    expect((caught as AuthFileConcurrentWriteError).reason).toBe("lock-busy");
    expect(readFileSync(authFilePath(dir), "utf8")).toBe(before);
    expect(readFileSync(lock, "utf8")).toBe("4242:another-live-writer");
  });

  it("leaves neither a lock nor a temp file behind", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    writeAuth(tokB, dir);
    updateAuth("https://a.example", (current) => current && { ...current, accessToken: "at-A9" }, dir);
    removeAuth("https://b.example", dir);
    expect(readdirSync(dir)).toEqual(["h2a-auth.json"]);
    expect(readAuth("https://a.example", dir)?.accessToken).toBe("at-A9");
  });
});
