import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildAuthorizeRequest,
  deviceFlowExpired,
  nextDevicePollDelayMs,
  pkceS256,
  verifyCallbackState,
} from "./enroll-flow.js";

const CFG = {
  authorizeUrl: "https://39.auth/authorize",
  clientId: "h2a-cli",
  redirectUri: "http://127.0.0.1:0/cb",
  scope: "openid profile",
};

describe("PKCE", () => {
  it("challenge is the base64url sha256 of the verifier", () => {
    const { verifier, challenge } = pkceS256();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("buildAuthorizeRequest", () => {
  it("emits an S256 authorization_code request carrying the challenge + state", () => {
    const req = buildAuthorizeRequest(CFG, { verifier: "v", challenge: "c" }, "st8");
    const u = new URL(req.url);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("h2a-cli");
    expect(u.searchParams.get("code_challenge")).toBe("c");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(req.verifier).toBe("v"); // verifier stays local, never on the wire
    expect(req.url).not.toContain("v"); // (single-char guard: the verifier value isn't a query param)
  });

  it("verifyCallbackState matches only the exact issued state (CSRF/replay)", () => {
    expect(verifyCallbackState("abc", "abc")).toBe(true);
    expect(verifyCallbackState("abc", "abcd")).toBe(false);
    expect(verifyCallbackState("", "")).toBe(false);
  });
});

describe("device-code polling", () => {
  it("honours slow_down by growing the interval, capped", () => {
    expect(nextDevicePollDelayMs(1000, false)).toBe(1000);
    expect(nextDevicePollDelayMs(1000, true)).toBe(6000);
    expect(nextDevicePollDelayMs(14000, true)).toBe(15000); // capped at maxMs
  });

  it("expires the flow at/after the deadline", () => {
    expect(deviceFlowExpired(1000, 999)).toBe(false);
    expect(deviceFlowExpired(1000, 1000)).toBe(true);
    expect(deviceFlowExpired(1000, 1001)).toBe(true);
  });
});
