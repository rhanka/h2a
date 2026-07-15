import { describe, expect, it } from "vitest";

import {
  LAUNCH_OPTION_PREFIX,
  buildLaunchContext,
  formatLaunchContext,
  launchContextOptions,
  parseLaunchContext,
  redactSecrets,
} from "./launch-context.js";

describe("buildLaunchContext", () => {
  it("marks the gateway on and surfaces a LOCAL base url", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x", label: "a2a-cli" },
      { ANTHROPIC_BASE_URL: "http://localhost:3002" } as NodeJS.ProcessEnv,
    );
    expect(ctx.gateway).toBe("on");
    expect(ctx.gatewayBaseUrl).toBe("http://localhost:3002");
    expect(ctx.modelMap).toBe("catalog-default");
    expect(ctx.label).toBe("a2a-cli");
  });

  it("marks the gateway off and omits the base url when unset", () => {
    const ctx = buildLaunchContext({ profile: "codex", cwd: "/y" }, {} as NodeJS.ProcessEnv);
    expect(ctx.gateway).toBe("off");
    expect(ctx.gatewayBaseUrl).toBeUndefined();
  });

  it("does NOT surface a non-local (remote) base url", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x" },
      { ANTHROPIC_BASE_URL: "https://gw.example.com" } as NodeJS.ProcessEnv,
    );
    expect(ctx.gateway).toBe("on");
    expect(ctx.gatewayBaseUrl).toBeUndefined();
  });

  it("summarizes the env model map as a flag, never its content", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x" },
      { OPENAI_MODEL_MAP: '{"claude-opus-4-8":"gpt-5.6-terra"}' } as NodeJS.ProcessEnv,
    );
    expect(ctx.modelMap).toBe("env:OPENAI_MODEL_MAP");
    // the mapping content must not leak into any stored value
    for (const [, v] of launchContextOptions(ctx)) expect(v).not.toContain("gpt-5.6-terra");
  });

  it("keeps the resume conversation id but never the whole argv", () => {
    const ctx = buildLaunchContext(
      { profile: "codex", cwd: "/x", resumeArgs: ["resume", "019f4f2c-abc"] },
      {} as NodeJS.ProcessEnv,
    );
    expect(ctx.resume).toBe("019f4f2c-abc");
  });
});

describe("secret safety", () => {
  it("redactSecrets scrubs tokens/JWT/bearer/long ids", () => {
    expect(redactSecrets("Bearer abcdef.ghijkl.mnopqr")).toContain("«redacted»");
    expect(redactSecrets("sk-ANTHROPIC1234567890")).toContain("«redacted»");
    expect(redactSecrets("eyJhbGciOiJIUzI1NiJ9zzzzzzzzzz")).toContain("«redacted»");
  });

  it("a token-bearing h2a command is redacted before storage", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x", h2aCommand: "h2a mcp-serve --token sk-ABCDEFGH12345678" },
      {} as NodeJS.ProcessEnv,
    );
    expect(ctx.h2a).not.toContain("sk-ABCDEFGH12345678");
    expect(ctx.h2a).toContain("«redacted»");
  });

  it("no stored option value carries an ANTHROPIC auth token (never read)", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x" },
      {
        ANTHROPIC_BASE_URL: "http://localhost:3002",
        ANTHROPIC_AUTH_TOKEN: "sk-secret-should-never-appear",
        ANTHROPIC_API_KEY: "sk-also-never",
      } as NodeJS.ProcessEnv,
    );
    for (const [, v] of launchContextOptions(ctx)) {
      expect(v).not.toContain("sk-secret-should-never-appear");
      expect(v).not.toContain("sk-also-never");
    }
  });
});

describe("options round-trip", () => {
  it("launchContextOptions → parseLaunchContext preserves the context", () => {
    const ctx = buildLaunchContext(
      { profile: "claude", cwd: "/x", label: "a2a-cli", resumeArgs: ["--resume", "id-1"], h2aCommand: "h2a mcp-serve --wake local-tmux" },
      { ANTHROPIC_BASE_URL: "http://localhost:3002" } as NodeJS.ProcessEnv,
    );
    const store = new Map(launchContextOptions(ctx));
    expect([...store.keys()].every((k) => k.startsWith(LAUNCH_OPTION_PREFIX))).toBe(true);
    const back = parseLaunchContext((k) => store.get(k));
    expect(back).toEqual(ctx);
  });

  it("parseLaunchContext returns undefined when no context is recorded", () => {
    expect(parseLaunchContext(() => undefined)).toBeUndefined();
  });
});

describe("formatLaunchContext", () => {
  it("renders gateway/model/h2a lines and hides absent fields", () => {
    const out = formatLaunchContext(
      buildLaunchContext(
        { profile: "claude", cwd: "/x", h2aCommand: "h2a mcp-serve" },
        { ANTHROPIC_BASE_URL: "http://localhost:3002" } as NodeJS.ProcessEnv,
      ),
    );
    expect(out).toContain("profile: claude");
    expect(out).toContain("gateway: on (ANTHROPIC_BASE_URL=http://localhost:3002)");
    expect(out).toContain("model-map: catalog-default");
    expect(out).toContain("h2a: h2a mcp-serve");
    expect(out).not.toContain("resume:");
  });
});
