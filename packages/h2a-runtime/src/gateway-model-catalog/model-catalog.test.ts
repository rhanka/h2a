import {
  LAUNCH_ALIAS_ROUTE_MAPPINGS,
  modelProfiles,
} from "@sentropic/cluster-mesh/llm-mesh";
import { describe, expect, it } from "vitest";

import {
  claudeGatewaySlot,
  GATEWAY_MODEL_ALIASES,
  GATEWAY_MODEL_IDS,
  MODEL_LAUNCH_AVAILABILITY,
  resolveGatewayModelAlias,
} from "./model-catalog.js";

// H0 (#662 adoption): the h2a embedded gateway catalog mirrors the published
// llm-mesh 0.38.4 / llm-gateway 0.23.2 model surface (Gemini 4 Argon, Neon,
// Hydrogen, Carbon, Codex GPT-6.2 Astra / GPT-6.1 Terra, Muse Spark, Wonder +
// Wonder Full) with readable aliases.
describe("gateway model catalog (H0 #662)", () => {
  it("exposes the 0.38.4 model ids (argon, neon, hydrogen, carbon, astra, terra, fable-5.1, fable-5.2, spark, wonder, ember, wonder-full)", () => {
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon-low");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon-medium");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon-high");
    expect(GATEWAY_MODEL_IDS).not.toContain("gemini-4-argon");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-neon-low");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-neon-medium");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-neon-high");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-neon-xhigh");
    expect(GATEWAY_MODEL_IDS).not.toContain("gemini-4-neon");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-hydrogen-low");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-hydrogen-medium");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-hydrogen-high");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-hydrogen-xhigh");
    expect(GATEWAY_MODEL_IDS).not.toContain("gemini-4-hydrogen");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-carbon");
    expect(GATEWAY_MODEL_IDS).toContain("gpt-6.2-astra");
    expect(GATEWAY_MODEL_IDS).toContain("gpt-6.1-terra");
    expect(GATEWAY_MODEL_IDS).toContain("claude-fable-5-1");
    expect(GATEWAY_MODEL_IDS).toContain("claude-fable-5-2");
    expect(GATEWAY_MODEL_IDS).toContain("muse-spark-1.3");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-1.0");
    expect(GATEWAY_MODEL_IDS).toContain("muse-ember-1.0");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-full-1.0");
  });

  it("resolves readable aliases to canonical ids and never returns bare argon, neon, or hydrogen", () => {
    expect(resolveGatewayModelAlias("gemini-4-argon")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("gemini-4-argon-low")).toBe("gemini-4-argon-low");
    expect(resolveGatewayModelAlias("gemini-4-argon-medium")).toBe("gemini-4-argon-medium");
    expect(resolveGatewayModelAlias("gemini-4-argon-high")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("argon")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("argon-low")).toBe("gemini-4-argon-low");
    expect(resolveGatewayModelAlias("argon-medium")).toBe("gemini-4-argon-medium");
    expect(resolveGatewayModelAlias("argon-high")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("gemini-argon")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("gemini-argon-low")).toBe("gemini-4-argon-low");
    expect(resolveGatewayModelAlias("gemini-argon-medium")).toBe("gemini-4-argon-medium");
    expect(resolveGatewayModelAlias("gemini-argon-high")).toBe("gemini-4-argon-high");
    expect(resolveGatewayModelAlias("gemini-4-neon")).toBe("gemini-4-neon-high");
    expect(resolveGatewayModelAlias("gemini-4-neon-low")).toBe("gemini-4-neon-low");
    expect(resolveGatewayModelAlias("gemini-4-neon-medium")).toBe("gemini-4-neon-medium");
    expect(resolveGatewayModelAlias("gemini-4-neon-high")).toBe("gemini-4-neon-high");
    expect(resolveGatewayModelAlias("gemini-4-neon-xhigh")).toBe("gemini-4-neon-xhigh");
    expect(resolveGatewayModelAlias("neon")).toBe("gemini-4-neon-high");
    expect(resolveGatewayModelAlias("neon-xhigh")).toBe("gemini-4-neon-xhigh");
    expect(resolveGatewayModelAlias("gemini-neon-medium")).toBe("gemini-4-neon-medium");
    expect(resolveGatewayModelAlias("gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
    expect(resolveGatewayModelAlias("gemini-4-hydrogen-low")).toBe("gemini-4-hydrogen-low");
    expect(resolveGatewayModelAlias("gemini-4-hydrogen-medium")).toBe("gemini-4-hydrogen-medium");
    expect(resolveGatewayModelAlias("gemini-4-hydrogen-high")).toBe("gemini-4-hydrogen-high");
    expect(resolveGatewayModelAlias("gemini-4-hydrogen-xhigh")).toBe("gemini-4-hydrogen-xhigh");
    expect(resolveGatewayModelAlias("hydrogen")).toBe("gemini-4-hydrogen-high");
    expect(resolveGatewayModelAlias("hydrogen-xhigh")).toBe("gemini-4-hydrogen-xhigh");
    expect(resolveGatewayModelAlias("gemini-hydrogen-low")).toBe("gemini-4-hydrogen-low");
    expect(resolveGatewayModelAlias("gemini-4-carbon")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("carbon")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("carbon-high")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("gemini-carbon")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("gpt-6.2-astra")).toBe("gpt-6.2-astra");
    expect(resolveGatewayModelAlias("gpt-6.1-terra")).toBe("gpt-6.1-terra");
    expect(resolveGatewayModelAlias("claude-fable-5-1")).toBe("claude-fable-5-1");
    expect(resolveGatewayModelAlias("fable-5.1")).toBe("claude-fable-5-1");
    expect(resolveGatewayModelAlias("fable-5-1")).toBe("claude-fable-5-1");
    expect(resolveGatewayModelAlias("claude-fable-5-2")).toBe("claude-fable-5-2");
    expect(resolveGatewayModelAlias("fable-5.2")).toBe("claude-fable-5-2");
    expect(resolveGatewayModelAlias("fable-5-2")).toBe("claude-fable-5-2");
    expect(resolveGatewayModelAlias("fable")).toBe("claude-fable-5-2");
    expect(resolveGatewayModelAlias("muse-spark")).toBe("muse-spark-1.3");
    expect(resolveGatewayModelAlias("muse-ember")).toBe("muse-ember-1.0");
    expect(resolveGatewayModelAlias("muse-ember-1.0")).toBe("muse-ember-1.0");
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

  it("ignores Object.prototype keys (no prototype pollution)", () => {
    expect(resolveGatewayModelAlias("constructor")).toBeUndefined();
    expect(resolveGatewayModelAlias("__proto__")).toBeUndefined();
    expect(resolveGatewayModelAlias("CONSTRUCTOR")).toBeUndefined();
    expect(claudeGatewaySlot("constructor")).toBeUndefined();
    expect(claudeGatewaySlot("__proto__")).toBeUndefined();
    expect(claudeGatewaySlot("CONSTRUCTOR")).toBeUndefined();
  });

  it("keeps the exact wonder-full spelling (no invented contributor id)", () => {
    expect(GATEWAY_MODEL_ALIASES["wonder-full"]).toBe("muse-wonder-full-1.0");
    expect(GATEWAY_MODEL_IDS).not.toContain("muse-wonder-full-1.1");
  });
});

// Parity with the adopted llm-mesh 0.38 tuple: canonical routing knowledge
// stays in llm-mesh, so every embedded id (or its base profile id for
// effort-suffixed gemini-4-argon-{low,medium,high}) must exist in
// modelProfiles, resolve by itself, and every Muse secondary leg must track
// the mesh canonical route.
describe("gateway model catalog parity with llm-mesh 0.38", () => {
  const meshIds = new Set(
    (modelProfiles as ReadonlyArray<{ modelId: string }>).map((p) => p.modelId),
  );
  const routes = LAUNCH_ALIAS_ROUTE_MAPPINGS as unknown as Record<
    string,
    Array<{ providerId: string; model: string; effort: string }>
  >;

  it("exposes only model ids carried by the installed mesh 0.38.4 catalog (including neon, hydrogen, astra, terra, carbon, argon, and muse-ember-1.0)", () => {
    expect(meshIds.has("gemini-4-carbon")).toBe(true);
    expect(meshIds.has("gemini-4-argon")).toBe(true);
    expect(meshIds.has("gemini-4-neon")).toBe(true);
    expect(meshIds.has("gemini-4-hydrogen")).toBe(true);
    expect(meshIds.has("gpt-6.2-astra")).toBe(true);
    expect(meshIds.has("gpt-6.1-terra")).toBe(true);
    expect(meshIds.has("claude-fable-5-2")).toBe(true);
    expect(meshIds.has("muse-ember-1.0")).toBe(true);
    for (const id of GATEWAY_MODEL_IDS) {
      expect(MODEL_LAUNCH_AVAILABILITY[id]).toEqual({ gatewayRoute: true });
      const baseId = id
        .replace(/^gemini-4-argon-(?:low|medium|high)$/, "gemini-4-argon")
        .replace(/^gemini-4-neon-(?:low|medium|high|xhigh)$/, "gemini-4-neon")
        .replace(/^gemini-4-hydrogen-(?:low|medium|high|xhigh)$/, "gemini-4-hydrogen");
      expect(meshIds.has(baseId)).toBe(true);
    }
  });

  it("enables gateway routing for muse-ember-1.0 in llm-mesh 0.38", () => {
    expect(MODEL_LAUNCH_AVAILABILITY["muse-ember-1.0"]).toEqual({
      gatewayRoute: true,
    });
    expect(meshIds.has("muse-ember-1.0")).toBe(true);
    expect(
      Object.entries(MODEL_LAUNCH_AVAILABILITY)
        .filter(([, availability]) => !availability.gatewayRoute)
        .map(([id]) => id),
    ).toEqual([]);
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

  it("keeps every cloud and Muse leg aligned with llm-mesh 0.38.4 canonical routes", () => {
    const pairs: Array<[family: string, meshKey: string]> = [
      ["opus-5.5/base", "claude-opus-5-5"],
      ["opus-5.5/medium", "claude-opus-5-5-medium"],
      ["opus-5.5/high", "claude-opus-5-5-high"],
      ["opus-5.5/xhigh", "claude-opus-5-5-xhigh"],
      ["opus-5.5/max", "claude-opus-5-5-max"],
      ["opus-5.5/low", "claude-opus-5-5-low"],
      ["sonnet-5.5/base", "claude-sonnet-5-5"],
      ["sonnet-5.5/high", "claude-sonnet-5-5-high"],
      ["sonnet-5.5/xhigh", "claude-sonnet-5-5-xhigh"],
      ["sonnet-5.5/max", "claude-sonnet-5-5-max"],
      ["sonnet-5.5/medium", "claude-sonnet-5-5-medium"],
      ["sonnet-5.5/low", "claude-sonnet-5-5-low"],
      ["haiku-5.5/base", "claude-haiku-5-5"],
      ["haiku-5.5/high", "claude-haiku-5-5-high"],
      ["haiku-5.5/xhigh", "claude-haiku-5-5-xhigh"],
      ["haiku-5.5/max", "claude-haiku-5-5-max"],
      ["haiku-5.5/medium", "claude-haiku-5-5-medium"],
      ["haiku-5.5/low", "claude-haiku-5-5-low"],
      ["fable-5.1/base", "claude-fable-5-1"],
      ["fable-5.1/medium", "claude-fable-5-1-medium"],
      ["fable-5.1/high", "claude-fable-5-1-high"],
      ["fable-5.1/xhigh", "claude-fable-5-1-xhigh"],
      ["fable-5.1/max", "claude-fable-5-1-max"],
      ["fable-5.1/low", "claude-fable-5-1-low"],
    ];
    for (const [family, meshKey] of pairs) {
      const slot = claudeGatewaySlot(family);
      const museLeg = routes[meshKey]?.find((t) => t.providerId === "muse");
      const cloudLeg = routes[meshKey]?.find((t) => t.providerId === "gemini");
      expect(museLeg, meshKey).toBeDefined();
      expect(cloudLeg, meshKey).toBeDefined();
      expect(slot?.muse, family).toBe(museLeg?.model);
      expect(slot?.museEffort, family).toBe(museLeg?.effort);
      const slotCloudBase = slot?.cloud.replace(/-(?:low|medium|high|xhigh)$/, "");
      expect(slotCloudBase, family).toBe(cloudLeg?.model);
      expect(slot?.cloudEffort, family).toBe(cloudLeg?.effort);
    }

    const fable52Secondary: Array<
      [family: string, meshKey: string, museEffort: "high" | "max" | "medium", cloudEffort: "medium" | "high" | "low"]
    > = [
      ["fable-5.2/medium", "claude-fable-5-2-medium", "high", "medium"],
      ["fable-5.2/max", "claude-fable-5-2-max", "max", "high"],
      ["fable-5.2/low", "claude-fable-5-2-low", "medium", "low"],
    ];
    for (const [family, meshKey, museEffort, cloudEffort] of fable52Secondary) {
      const slot = claudeGatewaySlot(family);
      expect(slot?.muse).toBe("muse-spark-1.3-contributor");
      expect(slot?.museEffort).toBe(museEffort);
      expect(slot?.cloud).toBe("gemini-4-carbon");
      expect(slot?.cloudEffort).toBe(cloudEffort);
      expect(claudeGatewaySlot(meshKey)).toEqual(slot);
    }
  });

  it("routes claude-fable-5-2 (+ -high/-xhigh) to gemini-4-carbon with 0.38.4 effort policy (base/medium->medium, high/xhigh/max->high)", () => {
    const carbonPairs: Array<[family: string, meshKey: string, cloudEffort: "medium" | "high"]> = [
      ["fable-5.2/base", "claude-fable-5-2", "medium"],
      ["fable-5.2/high", "claude-fable-5-2-high", "high"],
      ["fable-5.2/xhigh", "claude-fable-5-2-xhigh", "high"],
    ];
    for (const [family, meshKey, cloudEffort] of carbonPairs) {
      const slot = claudeGatewaySlot(family);
      const cloudLeg = routes[meshKey]?.find((t) => t.providerId === "gemini");
      const codexLeg = routes[meshKey]?.find((t) => t.providerId === "openai");
      expect(slot?.cloud).toBe("gemini-4-carbon");
      expect(slot?.cloudEffort).toBe(cloudEffort);
      expect(cloudLeg?.model).toBe("gemini-4-carbon");
      expect(cloudLeg?.effort).toBe(cloudEffort);
      expect(codexLeg?.model).toBe("gpt-6.2-astra");
      expect(slot?.muse).toBe("gemini-4-carbon");
      expect(slot?.museEffort).toBe("max");
      expect(claudeGatewaySlot(meshKey)).toEqual(slot);
    }
  });

  it("verifies 0.38.4 Claude alias codex and cloud mapping (Opus 5.5->Neon/Sol/Astra, Sonnet 5.5->Hydrogen/Terra, Haiku 5.5->Hydrogen/Luna, Fable 5.1 unchanged)", () => {
    const codexOf = (key: string) => routes[key]?.find((t) => t.providerId === "openai");
    const cloudOf = (key: string) => routes[key]?.find((t) => t.providerId === "gemini");

    expect(cloudOf("claude-opus-5-5")).toMatchObject({ model: "gemini-4-neon", effort: "medium" });
    expect(cloudOf("claude-opus-5-5-medium")).toMatchObject({ model: "gemini-4-neon", effort: "medium" });
    expect(cloudOf("claude-opus-5-5-xhigh")).toMatchObject({ model: "gemini-4-neon", effort: "xhigh" });
    expect(cloudOf("claude-opus-5-5-max")).toMatchObject({ model: "gemini-4-neon", effort: "xhigh" });
    expect(codexOf("claude-opus-5-5")).toMatchObject({ model: "gpt-6.1-sol" });
    expect(codexOf("claude-opus-5-5-max")).toMatchObject({ model: "gpt-6.2-astra" });

    expect(cloudOf("claude-sonnet-5-5")).toMatchObject({ model: "gemini-4-hydrogen", effort: "medium" });
    expect(codexOf("claude-sonnet-5-5")).toMatchObject({ model: "gpt-6.1-terra" });

    expect(cloudOf("claude-haiku-5-5")).toMatchObject({ model: "gemini-4-hydrogen", effort: "medium" });
    expect(codexOf("claude-haiku-5-5")).toMatchObject({ model: "gpt-6-luna" });

    expect(cloudOf("claude-fable-5-1")).toMatchObject({ model: "gemini-4-argon", effort: "high" });
    expect(codexOf("claude-fable-5-1")).toMatchObject({ model: "gpt-6-astra" });
  });
});
