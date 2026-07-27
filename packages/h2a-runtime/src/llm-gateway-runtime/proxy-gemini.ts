import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { routeModelOrThrow } from "./model-catalog.js";
import { refreshOAuthToken } from "./accounts.js";

const projectCache = new Map<string, string>();
async function fetchCodeAssistProject(token: string, accountId?: string): Promise<string> {
  const cached = projectCache.get(token);
  if (cached) return cached;
  let attempts = 0;
  let currentToken = token;
  while (attempts < 2) {
    try {
      const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cloudaicompanionProject?: string };
        if (data.cloudaicompanionProject) {
          projectCache.set(token, data.cloudaicompanionProject);
          return data.cloudaicompanionProject;
        }
        break;
      } else if (res.status === 401 || res.status === 403) {
        if (attempts === 0 && accountId) {
          const newToken = await refreshOAuthToken(accountId);
          if (newToken) {
            currentToken = newToken;
            attempts++;
            continue;
          }
        }
      }
      break;
    } catch {
      break;
    }
  }
  return "";
}

const GEMINI_ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "properties",
  "required",
  "items",
  "enum",
]);

export function cleanGeminiSchema(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(cleanGeminiSchema);
  }
  if (obj && typeof obj === "object" && obj !== null) {
    const src = obj as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    if ("const" in src && !("enum" in src)) {
      cleaned.enum = [String(src.const)];
    }

    for (const [key, value] of Object.entries(src)) {
      if (key === "const") continue;
      if (!GEMINI_ALLOWED_SCHEMA_KEYS.has(key)) continue;

      if (key === "enum" && Array.isArray(value)) {
        cleaned.enum = value.map(String);
      } else if (key === "properties" && value && typeof value === "object") {
        const cleanedProps: Record<string, unknown> = {};
        for (const [propName, propVal] of Object.entries(
          value as Record<string, unknown>,
        )) {
          cleanedProps[propName] = cleanGeminiSchema(propVal);
        }
        cleaned.properties = cleanedProps;
      } else if (key === "items") {
        cleaned.items = cleanGeminiSchema(value);
      } else {
        cleaned[key] = value;
      }
    }

    if (!cleaned.type) {
      if (cleaned.properties) cleaned.type = "object";
      else if (cleaned.items) cleaned.type = "array";
      else cleaned.type = "string";
    }

    return cleaned;
  }
  return obj;
}

// Anthropic types
type AntTextBlock = { type: "text"; text: string };
type AntToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AntToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | AntContentBlock[];
};
type AntContentBlock =
  | AntTextBlock
  | AntToolUseBlock
  | AntToolResultBlock
  | { type: string };

type AntMessage = {
  role: "user" | "assistant";
  content: string | AntContentBlock[];
};
type AntTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};
type AntRequest = {
  model: string;
  messages: AntMessage[];
  system?: string | AntContentBlock[];
  max_tokens?: number;
  temperature?: number;
  tools?: AntTool[];
  stream?: boolean;
};

// Gemini types
interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiRequest {
  model?: string;
  contents: GeminiContent[];
  systemInstruction?: {
    parts: { text: string }[];
  };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  tools?: Array<{
    functionDeclarations?: Array<{
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    }>;
  }>;
}

function systemToText(system?: string | AntContentBlock[]): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => (block.type === "text" ? (block as AntTextBlock).text : ""))
      .join("");
  }
  return undefined;
}

export function translateAnthropicToGemini(
  body: AntRequest,
  upstreamModel?: string,
): GeminiRequest {
  const contents: GeminiContent[] = [];
  const toolUseMap = new Map<string, string>();

  // Map tool names from tool_use blocks
  for (const msg of body.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const tu = block as AntToolUseBlock;
          toolUseMap.set(tu.id, tu.name);
        }
      }
    }
  }

  for (const msg of body.messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];

    if (typeof msg.content === "string") {
      if (msg.content) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          const tb = block as AntTextBlock;
          if (tb.text) parts.push({ text: tb.text });
        } else if (block.type === "tool_use") {
          const tu = block as AntToolUseBlock;
          parts.push({
            functionCall: {
              name: tu.name,
              args: tu.input && typeof tu.input === "object" ? tu.input : {},
            },
          });
        } else if (block.type === "tool_result") {
          const tr = block as AntToolResultBlock;
          const name = toolUseMap.get(tr.tool_use_id) ?? tr.tool_use_id;
          let resultText = "";
          if (typeof tr.content === "string") {
            resultText = tr.content;
          } else if (Array.isArray(tr.content)) {
            resultText = tr.content
              .map((b) => (b.type === "text" ? (b as AntTextBlock).text : ""))
              .join("");
          }
          if (!resultText) {
            resultText = "[llm-gateway: empty tool result omitted.]";
          }

          let responseVal: Record<string, unknown>;
          try {
            const parsed = JSON.parse(resultText);
            if (parsed && typeof parsed === "object") {
              responseVal = { result: parsed };
            } else {
              responseVal = { result: resultText };
            }
          } catch {
            responseVal = { result: resultText };
          }

          parts.push({
            functionResponse: {
              name,
              response: responseVal,
            },
          });
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  const geminiReq: GeminiRequest = { contents };
  if (upstreamModel) {
    geminiReq.model = `models/${upstreamModel}`;
  }

  const systemText = systemToText(body.system);
  if (systemText) {
    geminiReq.systemInstruction = {
      parts: [{ text: systemText }],
    };
  }

  if (body.max_tokens || body.temperature !== undefined) {
    geminiReq.generationConfig = {};
    if (body.max_tokens) {
      geminiReq.generationConfig.maxOutputTokens = body.max_tokens;
    }
    if (body.temperature !== undefined) {
      geminiReq.generationConfig.temperature = body.temperature;
    }
  }



  if (body.tools && body.tools.length > 0) {
    geminiReq.tools = [
      {
        functionDeclarations: body.tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          parameters: (cleanGeminiSchema(t.input_schema) as Record<string, unknown>) ?? {},
        })),
      },
    ];
  }

  return geminiReq;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function fetchWithRetry(url: string, token: string, accountId: string | undefined, body: any): Promise<Response> {
  let currentToken = token;
  let attempts = 0;
  while (attempts < 2) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    if ((res.status === 401 || res.status === 403) && attempts === 0 && accountId) {
      const newToken = await refreshOAuthToken(accountId);
      if (newToken) {
        currentToken = newToken;
        attempts++;
        continue;
      }
    }
    return res;
  }
  throw new Error("unreachable");
}

export async function handleMessagesViaGemini(
  c: Context,
  session: {
    token: string;
    gatewayToken?: string;
    accountId?: string;
    sessionId?: string;
  },
  requestBody?: ArrayBuffer,
): Promise<Response> {
  const rawBody = requestBody ?? (await c.req.arrayBuffer());
  let body: AntRequest;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as AntRequest;
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const originalModel = body.model;
  let route;
  try {
    route = routeModelOrThrow(originalModel);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  // Cross-pool fallback: if the upstream model targets Codex (gpt-*), use the
  // default Gemini model instead. This happens when a Codex 429 triggers a
  // rebind to the Google pool.
  const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
  const geminiModel =
    route.accountPool !== "google" ? DEFAULT_GEMINI_MODEL : route.upstreamModel;

  const projectId = await fetchCodeAssistProject(session.token, session.accountId);

  const upstreamReq = translateAnthropicToGemini(body, geminiModel);
  // Cloud Code Assist expects an envelope: { model, project, user_prompt_id, request: { contents, … } }
  const codeAssistBody = {
    model: geminiModel,
    project: projectId,
    user_prompt_id: randomUUID(),
    request: {
      contents: upstreamReq.contents,
      ...(upstreamReq.systemInstruction
        ? { systemInstruction: upstreamReq.systemInstruction }
        : {}),
      ...(upstreamReq.generationConfig
        ? { generationConfig: upstreamReq.generationConfig }
        : {}),
      ...(upstreamReq.tools ? { tools: upstreamReq.tools } : {}),
    },
  };
  const upstreamUrl =
    "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

  const responseHeaders = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  };

  if (!body.stream) {
    // Non-streaming request — we still fetch stream and accumulate it
    try {
      const resp = await fetchWithRetry(upstreamUrl, session.token, session.accountId, codeAssistBody);

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        return c.json({ error: `Upstream error: ${resp.status} ${resp.statusText}`, detail: errBody }, resp.status as any);
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        return c.json({ error: "Empty upstream response" }, 500);
      }

      let text = "";
      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          let chunk;
          try {
            chunk = JSON.parse(raw);
          } catch {
            continue;
          }

          const responseObj = chunk.response ?? chunk;
          const candidate = responseObj.candidates?.[0];
          const parts = candidate?.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.text) {
                text += part.text;
              }
              if (part.functionCall) {
                toolCalls.push(part.functionCall);
              }
            }
          }
        }
      }

      const contentBlocks: any[] = [];
      if (text) {
        contentBlocks.push({ type: "text", text });
      }
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
        contentBlocks.push({
          type: "tool_use",
          id: `toolu_${i}`,
          name: tc.name,
          input: tc.args || {},
        });
      }

      return c.json({
        id: `msg_${Date.now().toString(36)}`,
        type: "message",
        role: "assistant",
        content: contentBlocks,
        model: originalModel,
        stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  }

  // Streaming request
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (msg: string) => {
        controller.enqueue(new TextEncoder().encode(msg));
      };

      const messageId = `msg_${Date.now().toString(36)}`;
      emit(
        sseEvent("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            content: [],
            model: originalModel,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      );
      emit(sseEvent("ping", { type: "ping" }));

      try {
        const resp = await fetchWithRetry(upstreamUrl, session.token, session.accountId, codeAssistBody);

        if (!resp.ok) {
          emit(sseEvent("error", { type: "error", error: { type: "api_error", message: `Upstream returned status ${resp.status}` } }));
          controller.close();
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          emit(sseEvent("error", { type: "error", error: { type: "api_error", message: "No response body from upstream" } }));
          controller.close();
          return;
        }

        let buf = "";
        let textBlockIdx = -1;
        let textBlockOpen = false;
        let nextBlockIdx = 0;
        let stopReason: string | null = null;
        let outputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;

            let chunk;
            try {
              chunk = JSON.parse(raw);
            } catch {
              continue;
            }

            const responseObj = chunk.response ?? chunk;
            const candidate = responseObj.candidates?.[0];
            if (candidate?.finishReason) {
              const fr = candidate.finishReason;
              if (fr === "MAX_TOKENS") stopReason = "max_tokens";
              else if (fr === "STOP") stopReason = "end_turn";
            }

            if (responseObj.usageMetadata) {
              const usage = responseObj.usageMetadata;
              if (typeof usage.candidatesTokenCount === "number") {
                outputTokens = usage.candidatesTokenCount;
              }
            }

            const parts = candidate?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (part.text) {
                  if (!textBlockOpen) {
                    textBlockIdx = nextBlockIdx++;
                    textBlockOpen = true;
                    emit(
                      sseEvent("content_block_start", {
                        type: "content_block_start",
                        index: textBlockIdx,
                        content_block: { type: "text", text: "" },
                      }),
                    );
                  }
                  emit(
                    sseEvent("content_block_delta", {
                      type: "content_block_delta",
                      index: textBlockIdx,
                      delta: { type: "text_delta", text: part.text },
                    }),
                  );
                }

                if (part.functionCall) {
                  if (textBlockOpen) {
                    emit(
                      sseEvent("content_block_stop", {
                        type: "content_block_stop",
                        index: textBlockIdx,
                      }),
                    );
                    textBlockOpen = false;
                  }

                  const blockIdx = nextBlockIdx++;
                  stopReason = "tool_use";
                  emit(
                    sseEvent("content_block_start", {
                      type: "content_block_start",
                      index: blockIdx,
                      content_block: {
                        type: "tool_use",
                        id: `toolu_${blockIdx}`,
                        name: part.functionCall.name,
                        input: part.functionCall.args || {},
                      },
                    }),
                  );
                  emit(
                    sseEvent("content_block_stop", {
                      type: "content_block_stop",
                      index: blockIdx,
                    }),
                  );
                }
              }
            }
          }
        }

        if (textBlockOpen) {
          emit(
            sseEvent("content_block_stop", {
              type: "content_block_stop",
              index: textBlockIdx,
            }),
          );
        }

        emit(
          sseEvent("message_delta", {
            type: "message_delta",
            delta: { stop_reason: stopReason || "end_turn", stop_sequence: null },
            usage: { output_tokens: outputTokens },
          }),
        );
        emit(sseEvent("message_stop", { type: "message_stop" }));
        controller.close();
      } catch (err) {
        emit(sseEvent("error", { type: "error", error: { type: "api_error", message: String(err) } }));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: responseHeaders });
}
