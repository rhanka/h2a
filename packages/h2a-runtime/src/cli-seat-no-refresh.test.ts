import { describe, expect, it } from "vitest";

import { SEAT_CLIS_5, makeSyntheticConsumerBundle } from "./cli-seat-fixtures.js";
import { classifyAccessFault } from "./cli-seat-materialization.js";
import { validateSeatBundleForMaterialization } from "./cli-seat-materialization.js";

describe("cli-seat-no-refresh", () => {
  it.each(SEAT_CLIS_5)("classifies expiry/401 as access-unavailable with zero refresh for %s", (cli) => {
    expect(classifyAccessFault({ expired: true })).toBe("access-unavailable");
    expect(classifyAccessFault({ status401: true })).toBe("access-unavailable");
    expect(classifyAccessFault({})).toBe("access-ok");
  });

  it.each(SEAT_CLIS_5)("accepts a refresh-less consumer projection for %s", (cli) => {
    const bundle = makeSyntheticConsumerBundle(cli);
    expect(validateSeatBundleForMaterialization(bundle).ok).toBe(true);
  });

  it("rejects hidden refresh material in a consumer payload", () => {
    const bundle = makeSyntheticConsumerBundle("claude");
    const tainted = {
      ...bundle,
      nativeUse: { kind: "access", accessRef: "access-synth-claude-01", refreshToken: "should-not-be-here" },
    };
    const result = validateSeatBundleForMaterialization(tainted);
    expect(result).toMatchObject({ ok: false, code: "refresh-material-present" });
  });

  it("rejects a custodian authority claim on a consumer channel", () => {
    const bundle = makeSyntheticConsumerBundle("vibe");
    const escalated = { ...bundle, authority: "custodian" as const };
    const result = validateSeatBundleForMaterialization(escalated, { trustedAuthority: "consumer" });
    expect(result).toMatchObject({ ok: false, code: "authority-escalation" });
  });

  it("never upgrades a consumer status from bundle data", () => {
    const bundle = makeSyntheticConsumerBundle("agy");
    const upgraded = { ...bundle, lifecycle: { ...bundle.lifecycle, refreshAuthority: "custody" as const } };
    const result = validateSeatBundleForMaterialization(upgraded, { trustedAuthority: "consumer" });
    expect(result.ok).toBe(false);
  });
});
