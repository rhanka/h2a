import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertServerBound,
  authFilePath,
  isExpired,
  readAuth,
  serverKey,
  writeAuth,
  type SentropicAuthToken,
} from "./auth-token.js";

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "h2a-auth-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  /* tmp dirs are left to the OS; each test uses its own */
});

const tokA: SentropicAuthToken = {
  server: "https://sentropic.example",
  issuer: "https://39.auth",
  accessToken: "at-A",
  refreshToken: "rt-A",
  subject: "user-1",
};

describe("auth-token file model", () => {
  it("round-trips a token in a 0600 file, keyed per server", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    expect(readAuth("https://sentropic.example", dir)).toEqual(tokA);
    const mode = statSync(authFilePath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("normalizes server URLs (trailing slash / path) to the same namespace", () => {
    expect(serverKey("https://sentropic.example/")).toBe(serverKey("https://sentropic.example"));
    const dir = freshDir();
    writeAuth(tokA, dir);
    expect(readAuth("https://sentropic.example/", dir)).toEqual(tokA);
  });

  it("NEVER returns a token for a different server (anti-exfil namespace)", () => {
    const dir = freshDir();
    writeAuth(tokA, dir);
    expect(readAuth("https://evil.example", dir)).toBeUndefined();
  });

  it("two servers coexist without cross-use", () => {
    const dir = freshDir();
    const tokB: SentropicAuthToken = { ...tokA, server: "https://other.example", accessToken: "at-B" };
    writeAuth(tokA, dir);
    writeAuth(tokB, dir);
    expect(readAuth("https://sentropic.example", dir)?.accessToken).toBe("at-A");
    expect(readAuth("https://other.example", dir)?.accessToken).toBe("at-B");
  });
});

describe("server binding guard", () => {
  it("assertServerBound throws when a token is used against the wrong server", () => {
    expect(() => assertServerBound(tokA, "https://evil.example")).toThrow(/refusing to use it/);
    expect(() => assertServerBound(tokA, "https://sentropic.example/")).not.toThrow();
  });
});

describe("expiry", () => {
  it("treats a past expiresAt as expired, a future one as fresh, and no expiry as fresh", () => {
    expect(isExpired({ ...tokA, expiresAt: "2000-01-01T00:00:00Z" })).toBe(true);
    expect(isExpired({ ...tokA, expiresAt: "2999-01-01T00:00:00Z" })).toBe(false);
    expect(isExpired(tokA)).toBe(false);
  });
});
