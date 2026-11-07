/**
 * Deterministic lost-update check for writeAuth, stabilized from the r2 revive
 * dossier probe ("Demandes rehydratees", defect 2). A second writer completes
 * its write between writeAuth's read and its commit; the property is that its
 * token survives and ours lands too — the pre-fix read-modify-rename commit
 * silently dropped whatever landed in that window.
 *
 * The earlier "race" form of this property (write the concurrent file BEFORE
 * writeAuth reads it) cannot observe the loss: writeAuth then reads the new
 * content and merges it by construction. The interposer below lands the
 * concurrent write exactly between writeAuth's read returning the pre-change
 * bytes and its rename — no timing, no flakiness, no real sleep.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
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

import { authFilePath, readAuth, writeAuth, type SentropicAuthToken } from "./auth-token.js";

const tokA: SentropicAuthToken = { server: "https://a.example", issuer: "https://issuer-a.example", accessToken: "at-A" };
const tokB: SentropicAuthToken = { ...tokA, server: "https://b.example", accessToken: "at-B" };
const tokC: SentropicAuthToken = { ...tokA, server: "https://c.example", accessToken: "at-C" };

describe("a write landing between read and commit", () => {
  it("is not lost", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2a-auth-race-"));
    writeAuth(tokA, dir);
    // Another process completes its own writeAuth(C) while ours is between read and rename.
    betweenReadAndCommit = () => {
      writeFileSync(authFilePath(dir), JSON.stringify({ "https://a.example": tokA, "https://c.example": tokC }), "utf8");
    };
    writeAuth(tokB, dir);
    expect(readAuth("https://b.example", dir)?.accessToken).toBe("at-B");
    expect(readAuth("https://c.example", dir)?.accessToken).toBe("at-C");
  });
});
