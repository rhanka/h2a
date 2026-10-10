// 0.97.9: the llm-mesh catalog h2a-runtime consumes must carry the gpt-6 models that
// `h2a run` resolves sol/luna/astra to, and keep terra on gpt-5.6. Alias→id resolution
// itself is owned and tested by llm-mesh; this asserts the CONSUMED catalog exposes the
// expected model ids (the integration point), and that gpt-6-terra never appears —
// gpt-6-terra is unavailable on every transport (verified 2026-09-26: 400 under Codex, 404
// on the OpenAI API), so terra stays gpt-5.6-terra.
import { describe, expect, it } from "vitest";
import { modelProfiles } from "@sentropic/cluster-mesh/llm-mesh";

describe("0.97.9 gpt-6 model catalog (consumed by h2a-runtime)", () => {
  const ids = new Set((modelProfiles as ReadonlyArray<{ modelId: string }>).map((p) => p.modelId));

  it("carries the gpt-6 models h2a run resolves (sol, luna, astra)", () => {
    expect(ids.has("gpt-6-sol")).toBe(true);
    expect(ids.has("gpt-6-luna")).toBe(true);
    expect(ids.has("gpt-6-astra")).toBe(true);
  });

  it("keeps terra on gpt-5.6-terra and never routes it to gpt-6-terra", () => {
    expect(ids.has("gpt-5.6-terra")).toBe(true);
    expect(ids.has("gpt-6-terra")).toBe(false);
  });
});
