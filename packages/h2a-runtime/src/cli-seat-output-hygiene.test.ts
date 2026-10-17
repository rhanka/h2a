import { describe, expect, it } from "vitest";

import { SEAT_CLIS_5, makeSyntheticCanary } from "./cli-seat-fixtures.js";
import {
  assertReceiptClean,
  mcpChildEnv,
  redactSecretsFromText,
  sanitizeEnvJson,
} from "./cli-seat-materialization.js";

describe("cli-seat-output-hygiene", () => {
  it.each(SEAT_CLIS_5)("strips credential values from env.json material for %s", (cli) => {
    const canary = makeSyntheticCanary(cli);
    const { env, removed } = sanitizeEnvJson(
      { PATH: "/usr/bin", MISTRAL_API_KEY: canary, HOME: "/tmp/home" },
      [canary],
    );
    expect(JSON.stringify(env)).not.toContain(canary);
    expect(removed).toContain("MISTRAL_API_KEY");
    expect(env["PATH"]).toBe("/usr/bin");
  });

  it("redacts raw and base64 secret forms from PTY logs", () => {
    const canary = makeSyntheticCanary("vibe");
    const encoded = Buffer.from(canary, "utf8").toString("base64");
    const redacted = redactSecretsFromText(`ok ${canary} then ${encoded} done`, [canary]);
    expect(redacted).not.toContain(canary);
    expect(redacted).not.toContain(encoded);
    expect(redacted).toContain("[REDACTED]");
  });

  it("gives MCP children an allowlisted environment without credential descriptors", () => {
    const child = mcpChildEnv({
      PATH: "/usr/bin",
      MISTRAL_API_KEY: "synthetic-secret",
      SEAT_WRITER_APP_PRIVATE_KEY: "synthetic-writer",
      H2A_MCP_READY_NONCE: "nonce-01",
    });
    expect(child["PATH"]).toBe("/usr/bin");
    expect(child["H2A_MCP_READY_NONCE"]).toBe("nonce-01");
    expect("MISTRAL_API_KEY" in child).toBe(false);
    expect("SEAT_WRITER_APP_PRIVATE_KEY" in child).toBe(false);
  });

  it("keeps receipts metadata-only", () => {
    const canary = makeSyntheticCanary("agy");
    expect(() =>
      assertReceiptClean({ seatRef: "seat-synth-agy-01", note: canary }, [canary]),
    ).toThrow(/credential in receipt refused/);
    expect(() => assertReceiptClean({ seatRef: "seat-synth-agy-01", outcome: "ok" }, [canary])).not.toThrow();
  });
});
