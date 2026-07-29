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

/** Collect the JSON payload of every `data:` line, in order. */
function parseSse(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      events.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // a non-JSON data line is not an event we assert on
    }
  }
  return events;
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

  it("streams Codex tool arguments that arrive only in output_item.done", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    // Shape captured live from the Codex Responses upstream: the function-call
    // arguments are delivered ONLY in the terminal output_item.done event, never
    // as response.function_call_arguments.delta.
    const upstream = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x1","name":"add"}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x1","name":"add",' +
        '"arguments":"{\\"a\\":2,\\"b\\":3}"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":7}}}',
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(streamFrom(upstream), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    const res = await codexApp().fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 128,
          stream: true,
          tools: [
            {
              name: "add",
              description: "Add two numbers",
              input_schema: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
              },
            },
          ],
          messages: [{ role: "user", content: "Add 2 and 3 using the tool." }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const events = parseSse(await res.text());

    // A client must be able to reconstruct the tool input from the stream.
    const start = events.find(
      (e) =>
        e.type === "content_block_start" &&
        (e.content_block as { type?: string } | undefined)?.type === "tool_use",
    );
    expect(start).toBeDefined();
    const toolIndex = start!.index as number;
    const partial = events
      .filter(
        (e) =>
          e.type === "content_block_delta" &&
          e.index === toolIndex &&
          (e.delta as { type?: string } | undefined)?.type ===
            "input_json_delta",
      )
      .map((e) => (e.delta as { partial_json: string }).partial_json)
      .join("");
    expect(partial).not.toBe("");
    expect(JSON.parse(partial)).toEqual({ a: 2, b: 3 });

    // The arguments must land before the block is closed.
    const deltaPos = events.findIndex(
      (e) =>
        e.type === "content_block_delta" &&
        (e.delta as { type?: string } | undefined)?.type ===
          "input_json_delta",
    );
    const stopPos = events.findIndex(
      (e) => e.type === "content_block_stop" && e.index === toolIndex,
    );
    expect(deltaPos).toBeGreaterThanOrEqual(0);
    expect(deltaPos).toBeLessThan(stopPos);
  });

  it("does not duplicate Codex tool arguments already streamed as deltas", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    // Upstreams that DO stream argument deltas must not get the terminal
    // arguments appended on top, which would corrupt the JSON.
    const upstream = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x2","name":"add"}}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,' +
        '"delta":"{\\"a\\":2,"}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,' +
        '"delta":"\\"b\\":3}"}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x2","name":"add",' +
        '"arguments":"{\\"a\\":2,\\"b\\":3}"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":7}}}',
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(streamFrom(upstream), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    const res = await codexApp().fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "Add 2 and 3 using the tool." }],
        }),
      }),
    );

    const events = parseSse(await res.text());
    const partial = events
      .filter(
        (e) =>
          e.type === "content_block_delta" &&
          (e.delta as { type?: string } | undefined)?.type ===
            "input_json_delta",
      )
      .map((e) => (e.delta as { partial_json: string }).partial_json)
      .join("");
    expect(JSON.parse(partial)).toEqual({ a: 2, b: 3 });
  });

  it("completes PARTIAL Codex tool argument deltas from the terminal value", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    // Mixed upstream: it streams only the BEGINNING of the arguments as deltas,
    // then delivers the complete value in output_item.done. Skipping the
    // terminal value because "some delta arrived" would hand the client a
    // silently truncated input, so the missing suffix must be relayed.
    const upstream = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x3","name":"add"}}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,' +
        '"delta":"{\\"a\\":2,"}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,' +
        '"item":{"type":"function_call","call_id":"call_x3","name":"add",' +
        '"arguments":"{\\"a\\":2,\\"b\\":3}"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":7}}}',
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(streamFrom(upstream), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    const res = await codexApp().fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "Add 2 and 3 using the tool." }],
        }),
      }),
    );

    const events = parseSse(await res.text());
    const partial = events
      .filter(
        (e) =>
          e.type === "content_block_delta" &&
          (e.delta as { type?: string } | undefined)?.type ===
            "input_json_delta",
      )
      .map((e) => (e.delta as { partial_json: string }).partial_json)
      .join("");
    // Concatenating every relayed fragment must yield the complete arguments,
    // exactly once — neither truncated nor duplicated.
    expect(JSON.parse(partial)).toEqual({ a: 2, b: 3 });
    expect(partial).toBe('{"a":2,"b":3}');
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
