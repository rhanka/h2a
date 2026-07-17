import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translateAnthropicToGemini } from "./proxy-gemini.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Gemini proxy translator", () => {
  it("translates basic Anthropic requests to Gemini format", () => {
    const req = translateAnthropicToGemini({
      model: "claude-opus-4-8",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        { role: "user", content: "ping" },
      ],
      max_tokens: 1000,
      temperature: 0.7,
      system: "You are a helpful assistant",
    }, "gemini-2.5-code-assist");

    expect(req).toEqual({
      model: "gemini-2.5-code-assist",
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi there" }] },
        { role: "user", parts: [{ text: "ping" }] },
      ],
      systemInstruction: {
        parts: [{ text: "You are a helpful assistant" }],
      },
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      },
    });
  });

  it("handles tool definitions and calls", () => {
    const req = translateAnthropicToGemini({
      model: "claude-opus-4-8",
      messages: [
        { role: "user", content: "use tool" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling tool" },
            {
              type: "tool_use",
              id: "call_1",
              name: "get_weather",
              input: { location: "Paris" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "sunny",
            },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather info",
          input_schema: {
            type: "object",
            properties: { location: { type: "string" } },
          },
        },
      ],
    });

    expect(req.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get weather info",
            parameters: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      },
    ]);

    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "use tool" }] },
      {
        role: "model",
        parts: [
          { text: "calling tool" },
          { functionCall: { name: "get_weather", args: { location: "Paris" } } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "get_weather",
              response: { result: "sunny" },
            },
          },
        ],
      },
    ]);
  });
});
