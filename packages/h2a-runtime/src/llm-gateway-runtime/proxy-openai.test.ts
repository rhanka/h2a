import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  handleMessagesViaOpenAI,
  toCodexRequest,
  trimCodexBodyForContext,
} from "./proxy-openai.js";

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
  it("refuses a refreshed raw credential before constrained context egress", async () => {
    const upstreamFetch = vi.fn(() => {
      throw new Error("raw credential must not receive constrained context");
    });
    vi.stubGlobal("fetch", upstreamFetch);
    const app = new Hono();
    app.post("/v1/messages", (c) =>
      handleMessagesViaOpenAI(c, {
        token: "sk-refreshed-raw",
        requiredTransport: "codex-responses",
      }),
    );

    const response = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-5-xhigh",
          messages: [{ role: "user", content: "refresh-sensitive context" }],
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("keeps xhigh Claude requests as Codex xhigh", () => {
    const req = toCodexRequest({
      model: "claude-opus-5-xhigh",
      messages: [{ role: "user", content: "continue" }],
      max_tokens: 4096,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 50_000 },
    });

    expect(req).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "xhigh" },
    });
  });

  it("uses canonical max effort without a thinking budget", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
          model: "claude-fable-5-max",
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const upstreamInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(upstreamInit.body))).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "max" },
    });
    expect(res.headers.get("x-h2a-resolved-model")).toBe("gpt-5.6-sol");
    expect(res.headers.get("x-h2a-reasoning-effort")).toBe("max");
  });

  it("replaces unsupported image tool results before Codex trimming and preserves final text", () => {
    const largeImageData = "a".repeat(180_000);
    const req = {
      model: "claude-opus-5-xhigh",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant" as const,
          content: [
            {
              type: "tool_use" as const,
              id: "toolu_image_transcript",
              name: "Read",
              input: { file_path: "/tmp/transcript.png" },
            },
          ],
        },
        {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: "toolu_image_transcript",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: largeImageData,
                  },
                },
              ],
            },
            {
              type: "text" as const,
              text: "Instruction finale: réponds malgré le transcrit omis.",
            },
          ],
        },
      ],
      stream: true,
      thinking: { type: "enabled" as const, budget_tokens: 50_000 },
    };

    const trimmed = trimCodexBodyForContext(req, 4_096);
    const upstream = toCodexRequest(trimmed.body);
    const input = upstream.input as Array<Record<string, unknown>>;

    expect(JSON.stringify(trimmed.body)).not.toContain(largeImageData);
    expect(JSON.stringify(input)).not.toContain(largeImageData);
    expect(input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          call_id: "toolu_image_transcript",
          name: "Read",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "toolu_image_transcript",
          output: expect.stringContaining("unsupported image image/png"),
        }),
        expect.objectContaining({
          type: "message",
          role: "user",
          content: expect.stringContaining("transcrit omis"),
        }),
      ]),
    );
    expect(
      input.some(
        (item) => item.type === "function_call_output" && item.output === "",
      ),
    ).toBe(false);
    expect(input.length).toBeGreaterThan(1);
    expect(input).not.toEqual([
      expect.objectContaining({
        type: "message",
        content: expect.stringContaining(
          "older Claude Code transcript omitted",
        ),
      }),
    ]);
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
          model: "claude-opus-5-xhigh",
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
