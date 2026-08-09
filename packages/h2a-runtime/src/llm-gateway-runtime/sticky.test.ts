import { beforeEach, describe, expect, it } from "vitest";
import { acquireSession, lookupToken, resetSessions, sessionCount } from "./sticky.js";

beforeEach(resetSessions);

describe("local gateway bearers", () => {
  it("are process-local, opaque and idempotent per session", async () => {
    const first = await acquireSession("session-a", { clientSessionId: "client-a" });
    const second = await acquireSession("session-a", { clientSessionId: "ignored" });
    expect(second.gatewayToken).toBe(first.gatewayToken);
    expect(sessionCount()).toBe(1);
    expect(await lookupToken(first.gatewayToken)).toMatchObject({
      sessionId: "session-a", clientSessionId: "client-a",
    });
    expect(first.gatewayToken).not.toContain("session-a");
  });

  it("does not accept a fabricated bearer", async () => {
    expect(await lookupToken("gw-v2-fabricated")).toBeUndefined();
  });
});
