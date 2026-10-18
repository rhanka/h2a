import { describe, expect, it } from "vitest";

import { SEAT_CLIS_5, makeSyntheticCanary } from "./cli-seat-fixtures.js";
import { assertArgvClean, resolveSourceMode } from "./cli-seat-materialization.js";

describe("cli-seat-source-modes", () => {
  it.each(SEAT_CLIS_5)("resolves --from cli as the seat circuit for %s", (cli) => {
    const manifest = resolveSourceMode(cli, "cli", "lab-01");
    expect(manifest).toMatchObject({ cli, mode: "cli", circuit: "seat" });
  });

  it.each(SEAT_CLIS_5)("resolves --from token as the seat circuit for %s", (cli) => {
    const manifest = resolveSourceMode(cli, "token", "lab-01");
    expect(manifest).toMatchObject({ cli, mode: "token", circuit: "seat" });
  });

  it.each(SEAT_CLIS_5)("keeps --from oauth as the product enrollment, not the seat circuit (%s)", (cli) => {
    const manifest = resolveSourceMode(cli, "oauth", "lab-01");
    expect(manifest).toMatchObject({ cli, mode: "oauth", circuit: "product-oauth" });
  });

  it("refuses an empty or daily lab profile", () => {
    expect(() => resolveSourceMode("claude", "cli", "")).toThrow(/explicit lab profile/);
    expect(() => resolveSourceMode("claude", "cli", "default")).toThrow(/never the default/);
    expect(() => resolveSourceMode("claude", "cli", "daily")).toThrow(/never the default/);
  });

  it("refuses unknown CLI and unknown mode with static errors", () => {
    expect(() => resolveSourceMode("gemini", "cli", "lab-01")).toThrow(/five-seat circuit/);
    expect(() => resolveSourceMode("claude", "sso" as never, "lab-01")).toThrow(/unknown source mode/);
  });

  it.each(SEAT_CLIS_5)("statically refuses credential values in argv for %s", (cli) => {
    const canary = makeSyntheticCanary(cli);
    expect(() => assertArgvClean(["--prompt", "hello"], [canary])).not.toThrow();
    expect(() => assertArgvClean(["--token", canary], [canary])).toThrow(/credential in argv refused/);
    try {
      assertArgvClean([`prefix-${canary}-suffix`], [canary]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe("credential in argv refused");
      expect((error as Error).message).not.toContain(canary);
    }
  });
});
