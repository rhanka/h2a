import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetModelCatalogCache,
  resolveModelRoute,
} from "./model-catalog.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetModelCatalogCache();
});

describe("embedded h2a runtime model catalog", () => {
  it("routes the Opus compatibility alias to Terra", () => {
    expect(resolveModelRoute("claude-opus-4-8")).toMatchObject({
      catalogModelId: "gpt-5.6-terra",
      upstreamModel: "gpt-5.6-terra",
      accountPool: "codex",
      routeReason: "catalog-alias",
    });
  });

  it("keeps Luna available as an explicit model", () => {
    expect(resolveModelRoute("gpt-5.6-luna")).toMatchObject({
      catalogModelId: "gpt-5.6-luna",
      upstreamModel: "gpt-5.6-luna",
      routeReason: "catalog-id",
    });
  });

  it("keeps OPENAI_MODEL_MAP precedence over the Terra default", () => {
    vi.stubEnv(
      "OPENAI_MODEL_MAP",
      JSON.stringify({ "claude-opus-4-8": "gpt-5.6-luna" }),
    );
    resetModelCatalogCache();

    expect(resolveModelRoute("claude-opus-4-8")).toMatchObject({
      catalogModelId: "claude-opus-4-8",
      upstreamModel: "gpt-5.6-luna",
      routeReason: "env-model-map",
    });
  });
});
