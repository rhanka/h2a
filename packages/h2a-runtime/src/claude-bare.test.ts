import { afterEach, describe, expect, it } from "vitest";

import { bareChoiceFromOptions, resolveClaudeBare } from "./index.js";

const ORIGINAL = {
  base: process.env.ANTHROPIC_BASE_URL,
  token: process.env.ANTHROPIC_AUTH_TOKEN,
};

function restoreEnv(key: "ANTHROPIC_BASE_URL" | "ANTHROPIC_AUTH_TOKEN", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function underGateway(): void {
  process.env.ANTHROPIC_BASE_URL = "http://localhost:65535";
  process.env.ANTHROPIC_AUTH_TOKEN = "test-token";
}

afterEach(() => {
  restoreEnv("ANTHROPIC_BASE_URL", ORIGINAL.base);
  restoreEnv("ANTHROPIC_AUTH_TOKEN", ORIGINAL.token);
});

describe("bareChoiceFromOptions", () => {
  it("maps --bare to true and --no-bare (both spellings) to false", () => {
    expect(bareChoiceFromOptions({ bare: true })).toBe(true);
    // commander negation surfaces as bare:false, a separate flag as noBare:true
    expect(bareChoiceFromOptions({ bare: false })).toBe(false);
    expect(bareChoiceFromOptions({ noBare: true })).toBe(false);
  });

  it("returns undefined when neither flag is given (default applies)", () => {
    expect(bareChoiceFromOptions({})).toBeUndefined();
  });

  it("rejects passing both at once", () => {
    expect(() => bareChoiceFromOptions({ bare: true, noBare: true })).toThrow();
  });
});

describe("resolveClaudeBare", () => {
  it("DEFAULTS to no bare for Claude under the gateway (native tools kept)", () => {
    underGateway();
    // The return-condition: absent an explicit choice, keep the native tools.
    expect(resolveClaudeBare("claude")).toBe(false);
    expect(resolveClaudeBare("claude", undefined)).toBe(false);
  });

  it("honors an explicit opt-in and opt-out under the gateway", () => {
    underGateway();
    expect(resolveClaudeBare("claude", true)).toBe(true);
    expect(resolveClaudeBare("claude", false)).toBe(false);
  });

  it("is always false off the gateway, even with an explicit --bare", () => {
    restoreEnv("ANTHROPIC_BASE_URL", undefined);
    restoreEnv("ANTHROPIC_AUTH_TOKEN", undefined);
    expect(resolveClaudeBare("claude", true)).toBe(false);
  });

  it("is always false for a non-Claude profile", () => {
    underGateway();
    expect(resolveClaudeBare("codex", true)).toBe(false);
    expect(resolveClaudeBare("agy", true)).toBe(false);
  });
});
