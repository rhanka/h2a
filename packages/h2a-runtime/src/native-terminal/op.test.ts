import { describe, expect, it } from "vitest";

import {
  nativeSessionDeathConfirmed,
  nativeSessionKillStrategy,
} from "./op.js";

describe("native terminal kill strategy", () => {
  it("uses the persisted-PGID proof only on Linux", () => {
    expect(nativeSessionKillStrategy("linux")).toBe("persisted-pgid");
    expect(nativeSessionKillStrategy("darwin")).toBe("controller");
    expect(nativeSessionKillStrategy("win32")).toBe("controller");
  });

  it("keeps confirmed OS death authoritative while the host projection lags", () => {
    expect(
      nativeSessionDeathConfirmed(
        "incarnation-a",
        {
          sessionId: "alpha",
          status: "reaped",
          pgid: 42,
          elapsedMs: 0,
        },
        { incarnation: "incarnation-a", status: "running" },
      ),
    ).toBe(true);
    expect(
      nativeSessionDeathConfirmed(
        "incarnation-a",
        undefined,
        { incarnation: "incarnation-b", status: "running" },
      ),
    ).toBe(false);
    expect(
      nativeSessionDeathConfirmed(
        "incarnation-a",
        {
          sessionId: "alpha",
          status: "reaped",
          pgid: 42,
          elapsedMs: 0,
        },
        { incarnation: "incarnation-b", status: "running" },
      ),
    ).toBe(false);
  });
});
