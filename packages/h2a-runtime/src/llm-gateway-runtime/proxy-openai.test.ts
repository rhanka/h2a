import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleMessagesViaOpenAI, toCodexRequest } from "./proxy-openai.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function codexApp(): Hono {
  const app = new Hono();
  app.post("/v1/messages", (c) =>
    handleMessagesViaOpenAI(c, {
      token: "codex.header.signature",
      gatewayToken: "gw-test",
      accountId: "codex-oauth",
    }),
  );
  return app;
}

describe("h2a runtime Codex gateway", () => {
  it("keeps xhigh Claude requests as Codex xhigh", () => {
    const req = toCodexRequest({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "continue" }],
      max_tokens: 4096,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 50_000 },
    });

    expect(req).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "xhigh" },
    });
  });

  it("sends xhigh to the Codex Responses upstream request", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        streamFrom(
          [
            "event: response.completed",
            'data: {"type":"response.completed","response":{"usage":{"output_tokens":0}}}',
            "",
          ].join("\n"),
        ),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await codexApp().fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
          thinking: { type: "enabled", budget_tokens: 50_000 },
        }),
      }),
    );

    expect(res.status).toBe(200);
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(upstreamInit.body))).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "xhigh" },
    });
  });

  it("returns a gateway error instead of 500 when Codex OAuth refresh cannot retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await codexApp().fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
          thinking: { type: "enabled", budget_tokens: 50_000 },
        }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({
      type: "error",
      error: {
        type: "api_error",
        message: expect.stringContaining("token refresh failed"),
      },
    });
  });
});
