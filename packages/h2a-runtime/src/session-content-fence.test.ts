import { mkdtempSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ContentFence } from "./session-content-fence.js";
describe("durable native content fence", () => {
  it("should retain denial and consumed proofs across native restarts", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      let f = new ContentFence(root);
      const revision = f.revision("scope");
      f.consume("scope", revision, "challenge", "a".repeat(64));
      f = new ContentFence(root);
      expect(() => f.consume("scope", revision, "challenge", "a".repeat(64))).toThrow();
      f.deny("scope");
      f = new ContentFence(root);
      expect(f.denied("scope")).toBe(true);
      expect(() => f.consume("scope", revision, "other", "b".repeat(64))).toThrow();
      const cleared = f.clear("scope");
      expect(f.denied("scope")).toBe(false);
      expect(() => f.consume("scope", revision, "other", "b".repeat(64))).toThrow();
      f.consume("scope", cleared, "other", "b".repeat(64));
      expect(readFileSync(join(root, "proofs.jsonl"), "utf8")).not.toContain(':"challenge"');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("should let exclusion win against stale async acceptance and independent fence instances", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      const a = new ContentFence(root), b = new ContentFence(root);
      const old = a.revision("scope"); b.deny("scope");
      expect(() => a.consume("scope", old, "pending", "a".repeat(64))).toThrow();
      expect(a.denied("scope")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("should refuse corrupt or uncertain proof journals while keeping durable denial available", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      const f = new ContentFence(root);
      appendFileSync(join(root, "proofs.jsonl"), '{"partial":');
      expect(() => f.consume("scope", 0, "pending", "a".repeat(64))).toThrow();
      f.deny("scope");
      expect(new ContentFence(root).denied("scope")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
