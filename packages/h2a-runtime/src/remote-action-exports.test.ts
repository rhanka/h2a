import { describe, expect, it } from "vitest";

import * as entry from "./remote-action.js";

describe("remote-action export scaffolding", () => {
  it("exposes the frozen N1 surface through the barrel", () => {
    expect(entry.REMOTE_ACTION_VERSION).toBe("remote-action-v1");
    expect(typeof entry.verifyActionEnvelope).toBe("function");
    expect(typeof entry.verifyNoncePublication).toBe("function");
    expect(typeof entry.verifyIdpEvidenceJws).toBe("function");
    expect(typeof entry.parseActionRouteRecord).toBe("function");
    expect(typeof entry.createPinnedTrust).toBe("function");
    expect(typeof entry.resolveTrustEntry).toBe("function");
    expect(typeof entry.evaluateAdmissionDeadline).toBe("function");
    expect(typeof entry.digestDomain).toBe("function");
    expect(typeof entry.isTargetRecord).toBe("function");
  });

  it("keeps every export a pure verifier primitive (no network, no store)", () => {
    for (const value of Object.values(entry)) {
      expect(typeof value === "function" || typeof value === "string" || typeof value === "number" || Array.isArray(value)).toBe(
        true,
      );
    }
  });
});
