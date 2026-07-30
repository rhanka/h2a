import { describe, expect, it } from "vitest";

import { getDefaultGatewayMode } from "./config.js";

/**
 * Owner request 2026-07-30 (01KYSTGGF57MET8WETDDV6G1W4): the default launch
 * posture must be gateway-OFF, and CONFIGURABLE rather than another constant.
 *
 * Measured the day before: the local gateway serves five GPT ids and no
 * `claude-*` id (it carries claude ALIASES, but not `claude-opus-5`), so a claude
 * session launched in "auto" dies on `400 unsupported model` — ten agents were
 * lost that way in one afternoon, and their startup CPU was first mistaken for
 * work.
 *
 * SCOPE OF THIS TEST, stated rather than implied: it pins the WIRED fallback,
 * which is the value that ships and the one that was wrong. The configured
 * branch reads config.json through the module's own reader, which cannot be
 * substituted from here without mocking a function the module calls internally —
 * so it is covered by the owner UAT on a real flagless launch, not by this file.
 */
describe("default gateway posture", () => {
  it("falls back to DIRECT, never to auto", () => {
    // No config.json exists on a fresh machine; this is what a launch inherits.
    expect(getDefaultGatewayMode()).toBe("direct");
  });
});
