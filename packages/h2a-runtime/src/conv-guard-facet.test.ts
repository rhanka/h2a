/**
 * Lot L1a — facet-ed line parsing (conv-guard gate, unknown preserved).
 *
 * Pure suite (no repo scratch: conv-guard.test.ts's package-local scratch
 * cannot be created under the test sandbox). Covers the RED contract:
 * well-formed facet-ed owner lines parse, unrecognized facets stay `unknown`
 * (never promoted), malformed lines are not facet lines.
 */
import { describe, expect, it } from "vitest";

import { parseFacetLine } from "./conv-guard.js";

describe("lot L1a: facet-ed line parsing (conv-guard gate, unknown preserved)", () => {
  it("should parse a well-formed facet-ed owner line and flag it", () => {
    expect(
      parseFacetLine("facet:live-agent-cli owner:alice session:s1"),
    ).toEqual({
      facet: "live-agent-cli",
      owner: "alice",
      session: "s1",
    });
    expect(
      parseFacetLine("facet:shell owner:bob session:sh"),
    ).not.toBeNull();
  });

  it("should keep unknown facets and malformed lines unknown (never promoted)", () => {
    expect(
      parseFacetLine("facet:cyborg owner:alice session:s1")?.facet,
    ).toBe("unknown");
    expect(parseFacetLine("facet:live-agent-cli owner: session:s1")).toBeNull();
    expect(parseFacetLine("plain line without facet")).toBeNull();
  });
});
