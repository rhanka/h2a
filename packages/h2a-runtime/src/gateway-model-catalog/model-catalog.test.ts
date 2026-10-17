import { describe, expect, it } from "vitest";

import {
  GATEWAY_MODEL_ALIASES,
  GATEWAY_MODEL_IDS,
  resolveGatewayModelAlias,
} from "./model-catalog.js";

// H0 (#662 adoption): the h2a embedded gateway catalog mirrors the published
// llm-mesh 0.26.0 / llm-gateway 0.20.0 model surface (Gemini 4 Argon high,
// Muse Spark, Muse Wonder + Wonder Full) with readable aliases.
describe("gateway model catalog (H0 #662)", () => {
  it("exposes the #662 model ids (argon, spark, wonder, wonder-full)", () => {
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon");
    expect(GATEWAY_MODEL_IDS).toContain("muse-spark-1.3");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-1.0");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-full-1.0");
  });

  it("resolves readable aliases to canonical ids", () => {
    expect(resolveGatewayModelAlias("gemini-4-argon")).toBe("gemini-4-argon");
    expect(resolveGatewayModelAlias("argon-high")).toBe("gemini-4-argon");
    expect(resolveGatewayModelAlias("muse-spark")).toBe("muse-spark-1.3");
    expect(resolveGatewayModelAlias("spark")).toBe("muse-spark-1.3");
    expect(resolveGatewayModelAlias("muse-wonder")).toBe("muse-wonder-1.0");
    expect(resolveGatewayModelAlias("wonder")).toBe("muse-wonder-1.0");
    expect(resolveGatewayModelAlias("muse-wonder-full")).toBe(
      "muse-wonder-full-1.0",
    );
    expect(resolveGatewayModelAlias("wonder-full")).toBe(
      "muse-wonder-full-1.0",
    );
  });

  it("leaves unknown models unresolved (exact-model default, no silent mapping)", () => {
    expect(resolveGatewayModelAlias("claude-opus-4-8")).toBeUndefined();
    expect(resolveGatewayModelAlias("gpt-5.6-terra")).toBeUndefined();
    expect(resolveGatewayModelAlias("nope")).toBeUndefined();
  });

  it("keeps the exact wonder-full spelling (no invented contributor id)", () => {
    expect(GATEWAY_MODEL_ALIASES["wonder-full"]).toBe("muse-wonder-full-1.0");
    expect(GATEWAY_MODEL_IDS).not.toContain("muse-wonder-full-1.1");
  });
});
