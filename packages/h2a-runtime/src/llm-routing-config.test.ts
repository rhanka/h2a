import { describe, expect, it } from "vitest";
import {
  describeLlmMeshRoutingConfig,
  parseLlmMeshRoutingConfig,
  preferredRoutingConfig,
  strategyRoutingConfig,
} from "./llm-routing-config.js";

describe("llm-mesh public routing configuration", () => {
  it("switches Codex ahead of Cloud Code without a consumer model table", () => {
    const config = preferredRoutingConfig(undefined, ["codex", "cloud-code"]);
    expect(config.policy?.strategy).toEqual({
      kind: "ordered",
      preferences: [
        { transportProviderId: "codex" },
        { transportProviderId: "cloud-code" },
      ],
    });
  });

  it("supports last-enrolled and round-robin as reversible host strategies", () => {
    const roundRobin = strategyRoutingConfig(undefined, "round-robin");
    expect(roundRobin.policy?.strategy).toEqual({ kind: "round-robin", scope: "new-affinity" });
    const restored = strategyRoutingConfig(roundRobin, "last-enrolled");
    expect(restored.policy?.strategy).toEqual({ kind: "last-enrolled" });
  });

  it("accepts validated per-model rules and named profiles as serialized mesh policy", () => {
    const config = parseLlmMeshRoutingConfig(JSON.stringify({
      policy: {
        strategy: { kind: "last-enrolled" },
        rules: [{
          match: { requestedModel: "claude-opus-5-xhigh" },
          preferences: [{ transportProviderId: "codex" }],
        }],
        fallbackMode: "retest-preferred",
        negativeCacheTtlMs: 300_000,
        maxAttempts: 3,
        preferSameTransport: true,
        stickyAccount: true,
        rotateEquivalentAccounts: false,
        allowEquivalentModels: true,
      },
    }));
    expect(describeLlmMeshRoutingConfig(config)).toMatchObject({
      strategy: { kind: "last-enrolled" },
      rules: [{ match: { requestedModel: "claude-opus-5-xhigh" } }],
    });
  });

  it("rejects unknown friendly transports", () => {
    expect(() => preferredRoutingConfig(undefined, ["invented"])).toThrow(
      /unsupported routing transport/,
    );
  });
});
