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
// llm-mesh 0.26.0 / llm-gateway 0.20.0 model surface (Gemini 4 Argon high,
// Muse Spark, Muse Wonder + Wonder Full) with readable aliases.
describe("gateway model catalog (H0 #662)", () => {
  it("exposes the #662 and PR #997 model ids (argon, carbon, fable-5.1, fable-5.2, spark, wonder, wonder-full)", () => {
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon");
    expect(GATEWAY_MODEL_IDS).toContain("gemini-4-carbon");
    expect(GATEWAY_MODEL_IDS).toContain("claude-fable-5-1");
    expect(GATEWAY_MODEL_IDS).toContain("claude-fable-5-2");
    expect(GATEWAY_MODEL_IDS).toContain("muse-spark-1.3");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-1.0");
    expect(GATEWAY_MODEL_IDS).toContain("muse-ember-1.0");
    expect(GATEWAY_MODEL_IDS).toContain("muse-wonder-full-1.0");
  });

  it("resolves readable aliases to canonical ids", () => {
    expect(resolveGatewayModelAlias("gemini-4-argon")).toBe("gemini-4-argon");
    expect(resolveGatewayModelAlias("argon-high")).toBe("gemini-4-argon");
    expect(resolveGatewayModelAlias("gemini-4-carbon")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("carbon")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("carbon-high")).toBe("gemini-4-carbon");
    expect(resolveGatewayModelAlias("gemini-carbon")).toBe("gemini-4-carbon");
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

// Parity with the adopted llm-mesh tuple: canonical routing knowledge stays
// in llm-mesh, so every embedded id must exist there (or in the PR #997
// pre-provisioned set while @sentropic/cluster-mesh@0.25.0 caps llm-mesh at
// <0.33.0 on npm), resolve by itself, and every Muse secondary leg must track
// the mesh canonical route.
const PREPROVISIONED_PR997_IDS: ReadonlySet<string> = new Set([
  "gemini-4-carbon",
  "claude-fable-5-2",
]);

describe("gateway model catalog parity with llm-mesh 0.26.0", () => {
  const meshIds = new Set(
    (modelProfiles as ReadonlyArray<{ modelId: string }>).map((p) => p.modelId),
  );
  const routes = LAUNCH_ALIAS_ROUTE_MAPPINGS as unknown as Record<
    string,
    Array<{ providerId: string; model: string; effort: string }>
  >;

  it("exposes only model ids carried by the installed mesh catalog (plus PR #997 pre-provisioned ids)", () => {
    for (const id of GATEWAY_MODEL_IDS) {
      if (!MODEL_LAUNCH_AVAILABILITY[id].gatewayRoute) continue;
      if (PREPROVISIONED_PR997_IDS.has(id)) continue;
      expect(meshIds.has(id)).toBe(true);
    }
  });

  it("declares Ember direct-only on Muse until a published mesh carries its gateway route", () => {
    expect(MODEL_LAUNCH_AVAILABILITY["muse-ember-1.0"]).toEqual({
      gatewayRoute: false,
      directProfile: "muse",
      reason: "Awaiting a published llm-mesh release carrying muse-ember-1.0 (sentropic #1013).",
    });
    expect(PREPROVISIONED_PR997_IDS.has("muse-ember-1.0")).toBe(false);
    expect(meshIds.has("muse-ember-1.0")).toBe(false);
    expect(Object.entries(MODEL_LAUNCH_AVAILABILITY)
      .filter(([, availability]) => !availability.gatewayRoute)
      .map(([id]) => id)).toEqual(["muse-ember-1.0"]);
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

    const fable52Secondary: Array<
      [family: string, meshKey: string, effort: "high" | "max" | "medium"]
    > = [
      ["fable-5.2/medium", "claude-fable-5-2-medium", "high"],
      ["fable-5.2/max", "claude-fable-5-2-max", "max"],
      ["fable-5.2/low", "claude-fable-5-2-low", "medium"],
    ];
    for (const [family, meshKey, effort] of fable52Secondary) {
      const slot = claudeGatewaySlot(family);
      expect(slot?.muse).toBe("muse-spark-1.3-contributor");
      expect(slot?.museEffort).toBe(effort);
      expect(claudeGatewaySlot(meshKey)).toEqual(slot);
    }
  });

  it("routes claude-fable-5-2 (+ -high/-xhigh) to gemini-4-carbon on the gateway cloud slot", () => {
    const carbonPairs: Array<[family: string, meshKey: string]> = [
      ["fable-5.2/base", "claude-fable-5-2"],
      ["fable-5.2/high", "claude-fable-5-2-high"],
      ["fable-5.2/xhigh", "claude-fable-5-2-xhigh"],
    ];
    for (const [family, meshKey] of carbonPairs) {
      const slot = claudeGatewaySlot(family);
      expect(slot?.cloud).toBe("gemini-4-carbon");
      expect(slot?.cloudEffort).toBe("high");
      expect(slot?.muse).toBe("gemini-4-carbon");
      expect(slot?.museEffort).toBe("max");
      expect(claudeGatewaySlot(meshKey)).toEqual(slot);
    }
  });
});
