import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { LlmMeshFacade } from "@sentropic/llm-mesh/facade";

import { handleMessagesViaCloudCode } from "./proxy-cloud-code.js";

describe("Cloud Code facade proxy", () => {
  it("acquires per request and streams facade events", async () => {
    const acquisition = { reservation: { reservationId: "reservation" } };
    const execute = vi.fn().mockImplementation(async function* () {
      yield { kind: "content", delta: "pong" };
      yield { kind: "done", usage: { output_tokens: 1 } };
    });
    const facade = {
      acquire: vi.fn().mockResolvedValue(acquisition),
      release: vi.fn(),
      getAdapter: vi.fn().mockReturnValue({ execute }),
    } as unknown as LlmMeshFacade;
    const app = new Hono();
    app.post("/v1/messages", (c) =>
      handleMessagesViaCloudCode(
        c,
        {
          sessionId: "session-1",
          transportConstraints: {
            transportProviderId: "cloud-code",
            accountConstraints: {
              targetProviderId: "google",
              modelId: "gemini-2.5-pro",
            },
          },
        },
        undefined,
        facade,
      ),
    );

    const response = await app.fetch(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-pro",
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"text":"pong"');
    expect(facade.acquire).toHaveBeenCalledWith(expect.objectContaining({
      transportProviderId: "cloud-code",
      targetProviderId: "google",
      affinityKey: "session-1",
    }));
    expect(facade.getAdapter).toHaveBeenCalledWith("cloud-code");
    expect(execute).toHaveBeenCalledWith(
      acquisition,
      expect.objectContaining({ modelId: "gemini-2.5-pro" }),
      expect.any(AbortSignal),
    );
  });
});
