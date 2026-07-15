import { afterEach, describe, expect, it, vi } from "vitest";

import {
  modelCatalogResponse,
  resetModelCatalogCache,
  resolveModelRoute,
  routeModelOrThrow,
} from "./model-catalog.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetModelCatalogCache();
});

describe("model catalog routing", () => {
  it("resolves Claude compatibility names as catalog aliases", () => {
    expect(resolveModelRoute("claude-sonnet-4-6")).toMatchObject({
      requestedModel: "claude-sonnet-4-6",
      catalogModelId: "gpt-5.5",
      upstreamModel: "gpt-5.5",
      accountPool: "codex",
      routingPolicy: "round-robin",
      routeReason: "catalog-alias",
    });
  });

  it("routes Opus 4.8 to GPT-5.6 Terra and Fable 5 to GPT-5.6 Sol", () => {
    expect(resolveModelRoute("claude-opus-4-8")).toMatchObject({
      requestedModel: "claude-opus-4-8",
      catalogModelId: "gpt-5.6-terra",
      upstreamModel: "gpt-5.6-terra",
      accountPool: "codex",
      routeReason: "catalog-alias",
    });
    expect(resolveModelRoute("claude-fable-5")).toMatchObject({
      requestedModel: "claude-fable-5",
      catalogModelId: "gpt-5.6-sol",
      upstreamModel: "gpt-5.6-sol",
      routeReason: "catalog-alias",
    });
    expect(resolveModelRoute("fable-5")).toMatchObject({
      catalogModelId: "gpt-5.6-sol",
      upstreamModel: "gpt-5.6-sol",
      routeReason: "catalog-alias",
    });
  });

  it("keeps Terra and Luna as explicit catalog routes", () => {
    expect(resolveModelRoute("gpt-5.6-terra")).toMatchObject({
      catalogModelId: "gpt-5.6-terra",
      upstreamModel: "gpt-5.6-terra",
      accountPool: "codex",
      routeReason: "catalog-id",
    });
    expect(resolveModelRoute("gpt-5.6-luna")).toMatchObject({
      catalogModelId: "gpt-5.6-luna",
      upstreamModel: "gpt-5.6-luna",
      accountPool: "codex",
      routeReason: "catalog-id",
    });
  });

  it("keeps other explicit GPT model ids as catalog or passthrough routes", () => {
    expect(resolveModelRoute("gpt-5.3-codex-spark")).toMatchObject({
      catalogModelId: "gpt-5.3-codex-spark",
      upstreamModel: "gpt-5.3-codex-spark",
      routeReason: "catalog-id",
    });
    expect(resolveModelRoute("gpt-5.future")).toMatchObject({
      catalogModelId: "gpt-5.future",
      upstreamModel: "gpt-5.future",
      routeReason: "passthrough-gpt",
    });
  });

  it("keeps OPENAI_MODEL_MAP as an env compatibility source", () => {
    vi.stubEnv("OPENAI_MODEL_MAP", JSON.stringify({ "claude-custom": "gpt-5.5" }));
    resetModelCatalogCache();

    expect(resolveModelRoute("claude-custom")).toMatchObject({
      catalogModelId: "claude-custom",
      upstreamModel: "gpt-5.5",
      accountPool: "codex",
      routeReason: "env-model-map",
    });
  });

  it("rejects unknown non-GPT models instead of silently defaulting", () => {
    expect(resolveModelRoute("mystery-model")).toBeUndefined();
    expect(() => routeModelOrThrow("mystery-model")).toThrow("unsupported model");
  });

  it("renders an OpenAI-compatible model list without tokens", () => {
    const response = modelCatalogResponse();

    expect(response.object).toBe("list");
    expect(response.data[0]).toMatchObject({
      object: "model",
      id: "gpt-5.6-terra",
      owned_by: "codex",
    });
    expect(JSON.stringify(response)).not.toContain("token");
  });
});
