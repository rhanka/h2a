import { it, expect } from "vitest";
import { NATIVE_TERMINAL_PROTOCOL_VERSION, requireNativeContentCapability } from "./protocol.js";
it("should reject legacy and incompatible content hosts without changing native transport version", () => {
  expect(NATIVE_TERMINAL_PROTOCOL_VERSION).toBe(1);
  for (const content of [undefined, true, "h2a.session-content/1", "h2a.session-content/3"]) {
    expect(() => requireNativeContentCapability({content})).toThrow("unsupported_source");
  }
  requireNativeContentCapability({content:"h2a.session-content/2"});
});
