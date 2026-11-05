/**
 * Durable action fence tests (cell N2, lot 1 — red).
 *
 * The fence owns the native journal behind every later route: one-use
 * `(issuer, jti, operation)` / nonce consumption with atomic commit before
 * ACK, byte-identical dedupe, changed-identity conflict, restart replay,
 * single-winner denial races, corrupt-journal fail-closed and query-only
 * state after handoff. Source gaps stay fail-closed: no local fill.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  consumeAction,
  denyAction,
  markHandedOff,
  openContentFence,
  queryAction,
} from "./session-content-fence.js";

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir: string): void {
  rmSync(dir, { force: true, recursive: true });
}

describe("session-content fence durability", () => {
  it("commits a consume and replays it idempotently after reopen", async () => {
    const dir = freshDir("fence-replay-");
    try {
      const first = await openContentFence(dir);
      const commit = await consumeAction(first, {
        digest: "a".repeat(64),
        key: "fixture-issuer:fixture-jti-1:input",
      });
      expect(commit).toEqual({ ok: true, duplicate: false });

      const second = await openContentFence(dir);
      const replay = await consumeAction(second, {
        digest: "a".repeat(64),
        key: "fixture-issuer:fixture-jti-1:input",
      });
      expect(replay).toEqual({ ok: true, duplicate: true });
      expect(queryAction(second, "fixture-issuer:fixture-jti-1:input")).toBe("committed");
    } finally {
      cleanup(dir);
    }
  });

  it("refuses a changed digest under a consumed key without losing the commit", async () => {
    const dir = freshDir("fence-conflict-");
    try {
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "a".repeat(64), key: "fixture-issuer:fixture-jti-2:input" }),
      ).toEqual({ ok: true, duplicate: false });
      expect(
        await consumeAction(fence, { digest: "b".repeat(64), key: "fixture-issuer:fixture-jti-2:input" }),
      ).toEqual({ ok: false, code: "replay_refused" });

      const reopened = await openContentFence(dir);
      expect(
        await consumeAction(reopened, {
          digest: "a".repeat(64),
          key: "fixture-issuer:fixture-jti-2:input",
        }),
      ).toEqual({ ok: true, duplicate: true });
    } finally {
      cleanup(dir);
    }
  });

  it("admits a single winner between concurrent denial and consume", async () => {
    const dir = freshDir("fence-race-");
    try {
      const fence = await openContentFence(dir);
      const key = "fixture-issuer:fixture-jti-3:input";
      const [consume, deny] = await Promise.all([
        consumeAction(fence, { digest: "c".repeat(64), key }),
        denyAction(fence, { key }),
      ]);
      const winners = [consume, deny].filter((outcome) => outcome.ok);
      expect(winners).toHaveLength(1);
      if (consume.ok) {
        expect(deny).toEqual({ ok: false, code: "request_resolved" });
      } else {
        expect(consume).toEqual({ ok: false, code: "control_disabled" });
      }

      const reopened = await openContentFence(dir);
      expect(queryAction(reopened, key)).toBe(consume.ok ? "committed" : "denied");
    } finally {
      cleanup(dir);
    }
  });

  it("refuses with zero effect on a corrupt journal", async () => {
    const dir = freshDir("fence-corrupt-");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(dir, "fence-journal.jsonl"), "not-json{{{\n");
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "d".repeat(64), key: "fixture-issuer:fixture-jti-4:input" }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(await denyAction(fence, { key: "fixture-issuer:fixture-jti-4:input" })).toEqual({
        ok: false,
        code: "ledger_unavailable",
      });
      expect(queryAction(fence, "fixture-issuer:fixture-jti-4:input")).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("refuses with zero effect on a partially written journal line", async () => {
    const dir = freshDir("fence-partial-");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        join(dir, "fence-journal.jsonl"),
        '{"v":1,"key":"fixture-issuer:fixture-jti-5:input","digest":"',
      );
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "e".repeat(64), key: "fixture-issuer:fixture-jti-5:input" }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(queryAction(fence, "fixture-issuer:fixture-jti-5:input")).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("keeps handed-off actions query-only by original key", async () => {
    const dir = freshDir("fence-handoff-");
    try {
      const fence = await openContentFence(dir);
      const key = "fixture-issuer:fixture-jti-6:input";
      expect(await consumeAction(fence, { digest: "f".repeat(64), key })).toEqual({
        ok: true,
        duplicate: false,
      });
      await markHandedOff(fence);
      expect(await consumeAction(fence, { digest: "f".repeat(64), key })).toEqual({
        ok: false,
        code: "already_handed_off",
        queryOnly: true,
      });
      expect(
        await consumeAction(fence, { digest: "0".repeat(64), key: "fixture-issuer:fixture-jti-7:input" }),
      ).toEqual({ ok: false, code: "already_handed_off", queryOnly: true });
      expect(queryAction(fence, key)).toBe("committed");

      const reopened = await openContentFence(dir);
      expect(
        await consumeAction(reopened, { digest: "f".repeat(64), key }),
      ).toEqual({ ok: false, code: "already_handed_off", queryOnly: true });
      expect(queryAction(reopened, key)).toBe("committed");
    } finally {
      cleanup(dir);
    }
  });

  it("fails closed on a contradictory duplicate key at reopen", async () => {
    const dir = freshDir("fence-conflict-reopen-");
    try {
      const { writeFileSync } = await import("node:fs");
      const key = "fixture-issuer:fixture-jti-8:input";
      writeFileSync(
        join(dir, "fence-journal.jsonl"),
        `${JSON.stringify({ decision: "consumed", digest: "a".repeat(64), key, v: 1 })}\n${JSON.stringify({ decision: "denied", digest: "", key, v: 1 })}\n`,
      );
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "a".repeat(64), key }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(queryAction(fence, key)).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("fails closed when a record follows handoff at reopen", async () => {
    const dir = freshDir("fence-posthandoff-");
    try {
      const { writeFileSync } = await import("node:fs");
      const key = "fixture-issuer:fixture-jti-9:input";
      writeFileSync(
        join(dir, "fence-journal.jsonl"),
        `${JSON.stringify({ handoff: true, v: 1 })}\n${JSON.stringify({ decision: "consumed", digest: "a".repeat(64), key, v: 1 })}\n`,
      );
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "a".repeat(64), key }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(queryAction(fence, key)).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("fails closed on a denied record carrying a digest at reopen", async () => {
    const dir = freshDir("fence-denied-digest-");
    try {
      const { writeFileSync } = await import("node:fs");
      const key = "fixture-issuer:fixture-jti-10:input";
      writeFileSync(
        join(dir, "fence-journal.jsonl"),
        `${JSON.stringify({ decision: "denied", digest: "a".repeat(64), key, v: 1 })}\n`,
      );
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "a".repeat(64), key }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(queryAction(fence, key)).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("fails closed on records with unknown keys at reopen", async () => {
    const dir = freshDir("fence-unknown-keys-");
    try {
      const { writeFileSync } = await import("node:fs");
      const key = "fixture-issuer:fixture-jti-11:input";
      writeFileSync(
        join(dir, "fence-journal.jsonl"),
        `${JSON.stringify({ decision: "consumed", digest: "a".repeat(64), extra: true, key, v: 1 })}\n`,
      );
      const fence = await openContentFence(dir);
      expect(
        await consumeAction(fence, { digest: "a".repeat(64), key }),
      ).toEqual({ ok: false, code: "ledger_unavailable" });
      expect(queryAction(fence, key)).toBe("journal-unavailable");
    } finally {
      cleanup(dir);
    }
  });

  it("reports whether handoff took effect from markHandedOff", async () => {
    const dir = freshDir("fence-handoff-result-");
    try {
      const fence = await openContentFence(dir);
      await expect(markHandedOff(fence)).resolves.toBe(true);
      await expect(markHandedOff(fence)).resolves.toBe(true);
    } finally {
      cleanup(dir);
    }
    const corruptDir = freshDir("fence-handoff-unavailable-");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(corruptDir, "fence-journal.jsonl"), "not-json{{{\n");
      const fence = await openContentFence(corruptDir);
      await expect(markHandedOff(fence)).resolves.toBe(false);
    } finally {
      cleanup(corruptDir);
    }
  });

  it("refuses an empty key before any journal write", async () => {
    const dir = freshDir("fence-invalid-");
    try {
      const fence = await openContentFence(dir);
      expect(await consumeAction(fence, { digest: "a".repeat(64), key: "" })).toEqual({
        ok: false,
        code: "invalid_request",
      });
      expect(await denyAction(fence, { key: "" })).toEqual({ ok: false, code: "invalid_request" });
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(dir, "fence-journal.jsonl"))).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});
