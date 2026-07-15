import { describe, expect, it, vi } from "vitest";

import { prepareStructuredGateway } from "./index.js";

describe("prepareStructuredGateway", () => {
  it("fails closed when an explicitly required gateway is absent", async () => {
    const start = vi.fn();
    await expect(
      prepareStructuredGateway("gateway", async () => undefined).then(start),
    ).rejects.toThrow(/required.*unavailable.*no agent was started/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("propagates gateway startup failure before any launch effect", async () => {
    const start = vi.fn();
    await expect(
      prepareStructuredGateway("gateway", async () => {
        throw new Error("gateway boot failed");
      }).then(start),
    ).rejects.toThrow(/gateway boot failed/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("allows explicit direct mode without a gateway", async () => {
    await expect(
      prepareStructuredGateway("direct", async () => undefined),
    ).resolves.toBeUndefined();
  });
});
