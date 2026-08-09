import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareLlmMeshForRestore,
  prepareStructuredGateway,
  type RestoreLlmMeshPreparationContext,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("prepareLlmMeshForRestore", () => {
  const facadeConfig = { port: 3002 } as const;

  function context(
    overrides: Partial<RestoreLlmMeshPreparationContext> = {},
  ): RestoreLlmMeshPreparationContext {
    return {
      runtimeEnabled: true,
      config: facadeConfig,
      gatewayPid: null,
      injectGateway: vi.fn(async () => "http://localhost:3002"),
      ...overrides,
    };
  }

  it("does not require a consumer-side account inventory", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fixture = context();

    expect("accounts" in facadeConfig).toBe(false);
    expect("meshAccounts" in facadeConfig).toBe(false);
    await expect(
      prepareLlmMeshForRestore(
        { dryRun: true, mode: "gateway" },
        fixture,
      ),
    ).resolves.toBeUndefined();

    expect(fixture.injectGateway).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/gateway would be started on port 3002/i),
    );
  });

  it("fails before restore continuation when required gateway is unavailable", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const launchRestore = vi.fn();
    const fixture = context({
      injectGateway: vi.fn(async () => undefined),
    });

    await expect(
      prepareLlmMeshForRestore({ mode: "gateway" }, fixture).then(
        launchRestore,
      ),
    ).rejects.toThrow(/gateway.*required.*unavailable.*no agent was started/i);

    expect(launchRestore).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringMatching(/continuing direct/i),
    );
  });

  it("honours explicit gateway mode even when auto-reactivation is disabled", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const injectGateway = vi.fn(async () => "http://localhost:3002");

    await expect(
      prepareLlmMeshForRestore(
        { mode: "gateway" },
        context({ runtimeEnabled: false, injectGateway }),
      ),
    ).resolves.toBeUndefined();

    expect(injectGateway).toHaveBeenCalledWith("gateway");
  });
});
