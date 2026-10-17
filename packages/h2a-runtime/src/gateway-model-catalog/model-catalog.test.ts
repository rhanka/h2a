import { LAUNCH_ALIAS_ROUTE_MAPPINGS, modelProfiles } from "@sentropic/llm-mesh";
import { describe, expect, it } from "vitest";

import {
  claudeGatewaySlot,
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

// Parity with the adopted llm-mesh tuple: canonical routing knowledge stays
// in llm-mesh, so every embedded id must exist there, resolve by itself, and
// every Muse secondary leg must track the mesh canonical route.
describe("gateway model catalog parity with llm-mesh 0.26.0", () => {
  const meshIds = new Set(
    (modelProfiles as ReadonlyArray<{ modelId: string }>).map((p) => p.modelId),
  );
  const routes = LAUNCH_ALIAS_ROUTE_MAPPINGS as unknown as Record<
    string,
    Array<{ providerId: string; model: string; effort: string }>
  >;

  it("exposes only model ids carried by the installed mesh catalog", () => {
    for (const id of GATEWAY_MODEL_IDS) {
      expect(meshIds.has(id)).toBe(true);
    }
  });

  it("round-trips every catalog id through alias resolution", () => {
    for (const id of GATEWAY_MODEL_IDS) {
      expect(resolveGatewayModelAlias(id)).toBe(id);
    }
  });

  it("resolves the contributor tier instead of leaving it undefined", () => {
    expect(resolveGatewayModelAlias("muse-spark-1.3-contributor")).toBe(
      "muse-spark-1.3-contributor",
    );
  });

  it("keeps every Muse secondary leg on the mesh canonical route", () => {
    const pairs: Array<[family: string, meshKey: string]> = [
      ["opus-5.5/base", "claude-opus-5-5"],
      ["opus-5.5/medium", "claude-opus-5-5-medium"],
      ["opus-5.5/high", "claude-opus-5-5-high"],
      ["opus-5.5/xhigh", "claude-opus-5-5-xhigh"],
      ["opus-5.5/max", "claude-opus-5-5-max"],
      ["opus-5.5/low", "claude-opus-5-5-low"],
      ["sonnet-5.5/high", "claude-sonnet-5-5-high"],
      ["sonnet-5.5/xhigh", "claude-sonnet-5-5-xhigh"],
      ["sonnet-5.5/max", "claude-sonnet-5-5-max"],
      ["sonnet-5.5/medium", "claude-sonnet-5-5-medium"],
      ["sonnet-5.5/low", "claude-sonnet-5-5-low"],
      ["fable-5.1/base", "claude-fable-5-1"],
      ["fable-5.1/medium", "claude-fable-5-1-medium"],
      ["fable-5.1/high", "claude-fable-5-1-high"],
      ["fable-5.1/xhigh", "claude-fable-5-1-xhigh"],
      ["fable-5.1/max", "claude-fable-5-1-max"],
      ["fable-5.1/low", "claude-fable-5-1-low"],
    ];
    for (const [family, meshKey] of pairs) {
      const museLeg = routes[meshKey]?.find((t) => t.providerId === "muse");
      expect(museLeg).toBeDefined();
      expect(claudeGatewaySlot(family)?.muse).toBe(museLeg?.model);
      expect(claudeGatewaySlot(family)?.museEffort).toBe(museLeg?.effort);
    }
  });
});
