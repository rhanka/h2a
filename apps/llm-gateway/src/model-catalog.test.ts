import { afterEach, describe, expect, it, vi } from "vitest";
import { describeCanonicalTargetRoutes } from "@sentropic/llm-gateway";

import {
  listModelCatalog,
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
  it("uses the package's canonical route descriptions as its only default map", () => {
    expect(
      listModelCatalog().map((entry) => [
        entry.id,
        entry.targetProviderId,
        entry.transportProviderId,
        entry.upstreamModel,
        entry.routeKind,
      ]),
    ).toEqual(
      describeCanonicalTargetRoutes().map((entry) => [
        entry.requestedId,
        entry.providerId,
        entry.transportProviderId,
        entry.model,
        entry.kind,
      ]),
    );
  });

  it("keeps bare ids faithful and routes only described aliases", () => {
    expect(resolveModelRoute("claude-opus-4-8")).toMatchObject({
      requestedModel: "claude-opus-4-8",
      catalogModelId: "claude-opus-4-8",
      upstreamModel: "claude-opus-4-8",
      accountPool: "anthropic",
      routeReason: "canonical-route",
      routeKind: "faithful",
    });
    expect(resolveModelRoute("claude-fable-5")).toMatchObject({
      requestedModel: "claude-fable-5",
      catalogModelId: "claude-fable-5",
      upstreamModel: "claude-fable-5",
      accountPool: "anthropic",
      routeKind: "faithful",
    });
    expect(resolveModelRoute("claude-fable-5-max")).toMatchObject({
      catalogModelId: "claude-fable-5-max",
      upstreamModel: "gpt-5.6-sol",
      routeReason: "canonical-route",
      routeKind: "alias",
    });
    expect(resolveModelRoute("claude-opus-4-8-xhigh")).toBeUndefined();
  });

  it("keeps Terra and Luna as explicit catalog routes", () => {
    expect(resolveModelRoute("gpt-5.6-terra")).toMatchObject({
      catalogModelId: "gpt-5.6-terra",
      upstreamModel: "gpt-5.6-terra",
      accountPool: "codex",
      routeReason: "canonical-route",
    });
    expect(resolveModelRoute("gpt-5.6-luna")).toMatchObject({
      catalogModelId: "gpt-5.6-luna",
      upstreamModel: "gpt-5.6-luna",
      accountPool: "codex",
      routeReason: "canonical-route",
    });
  });

  it("rejects routes absent from the canonical descriptions", () => {
    expect(resolveModelRoute("gpt-5.future")).toBeUndefined();
    expect(resolveModelRoute("claude-sonnet-4-6")).toBeUndefined();
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
    expect(response.data.find((entry) => entry.id === "gpt-5.6-terra")).toMatchObject({
      object: "model",
      id: "gpt-5.6-terra",
      owned_by: "codex",
    });
    expect(JSON.stringify(response)).not.toContain("token");
  });
});
