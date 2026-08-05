import { createLlmMeshFacade, type LlmMeshFacade } from "@sentropic/llm-mesh/facade";
import type { Context } from "hono";

import type { SessionEntry } from "./sticky.js";

type AnthropicMessage = {
  role?: unknown;
  content?: unknown;
};

type AnthropicRequest = {
  model?: unknown;
  messages?: unknown;
  system?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  stream?: unknown;
};

function facadeConfigResolver() {
  return {
    async resolveConfig(configRef: string): Promise<Record<string, unknown>> {
      const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const scoped = parsed[configRef];
      return scoped && typeof scoped === "object" && !Array.isArray(scoped)
        ? scoped as Record<string, unknown>
        : parsed;
    },
  };
}

let facade: LlmMeshFacade | undefined;

/** The gateway keeps the opaque mesh facade, never a provider credential. */
export function getCloudCodeFacade(): LlmMeshFacade {
  facade ??= createLlmMeshFacade({
    configResolver: facadeConfigResolver(),
    mode: "cli",
  });
  return facade;
}

function textParts(content: unknown): Array<{ text: string }> {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      return [{ text: (part as { text: string }).text }];
    }
    return [];
  });
}

function toProviderRequest(body: AnthropicRequest): {
  modelId: string;
  contents: unknown[];
  generationConfig?: unknown;
} {
  const contents: unknown[] = [];
  if (typeof body.system === "string") {
    contents.push({ role: "user", parts: [{ text: body.system }] });
  } else if (Array.isArray(body.system)) {
    const parts = textParts(body.system);
    if (parts.length > 0) contents.push({ role: "user", parts });
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages as AnthropicMessage[]) {
      const parts = textParts(message.content);
      if (parts.length > 0) {
        contents.push({
          role: message.role === "assistant" ? "model" : "user",
          parts,
        });
      }
    }
  }

  const generationConfig = {
    ...(typeof body.max_tokens === "number"
      ? { maxOutputTokens: body.max_tokens }
      : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { topP: body.top_p } : {}),
  };
  return {
    modelId: typeof body.model === "string" ? body.model : "",
    contents,
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

function sse(event: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function cloudCodeError(message: string): { type: "error"; error: { type: "api_error"; message: string } } {
  return { type: "error", error: { type: "api_error", message } };
}

/**
 * Execute a Cloud Code request through the mesh facade. `execute()` owns every
 * non-abort outcome; an aborted client request releases only its reservation.
 */
export async function handleMessagesViaCloudCode(
  c: Context,
  session: Pick<SessionEntry, "sessionId" | "transportConstraints">,
  requestBody?: ArrayBuffer,
  llmMesh: LlmMeshFacade = getCloudCodeFacade(),
): Promise<Response> {
  const rawBody = requestBody ?? (await c.req.raw.arrayBuffer());
  let body: AnthropicRequest;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody)) as AnthropicRequest;
  } catch {
    return c.json(cloudCodeError("invalid JSON"), 400);
  }
  if (!session.transportConstraints || typeof body.model !== "string") {
    return c.json(cloudCodeError("Cloud Code session or model is missing"), 400);
  }

  const acquisition = await llmMesh.acquire({
    ...session.transportConstraints.accountConstraints,
    transportProviderId: "cloud-code",
    modelId: body.model,
    affinityKey: session.sessionId,
  });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await llmMesh.release(acquisition);
  };
  const request = toProviderRequest(body);

  if (!body.stream) {
    try {
      let content = "";
      let usage: unknown = {};
      for await (const event of llmMesh
        .getAdapter("cloud-code")
        .execute(acquisition, request, c.req.raw.signal)) {
        if (c.req.raw.signal.aborted) {
          await release();
          return new Response(null, { status: 499 });
        }
        if (event.kind === "content") content += event.delta;
        if (event.kind === "done") usage = event.usage;
        if (event.kind === "error") return c.json(cloudCodeError(event.message), 502);
      }
      return c.json({
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: content }],
        model: body.model,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage,
      });
    } catch (error) {
      if (c.req.raw.signal.aborted) {
        await release();
        return new Response(null, { status: 499 });
      }
      return c.json(cloudCodeError(error instanceof Error ? error.message : String(error)), 502);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const onAbort = () => void release();
        c.req.raw.signal.addEventListener("abort", onAbort, { once: true });
        try {
          controller.enqueue(sse("message_start", {
            type: "message_start",
            message: { id: `msg_${Date.now().toString(36)}`, type: "message", role: "assistant", content: [], model: body.model },
          }));
          controller.enqueue(sse("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }));
          for await (const event of llmMesh
            .getAdapter("cloud-code")
            .execute(acquisition, request, c.req.raw.signal)) {
            if (c.req.raw.signal.aborted) {
              await release();
              controller.close();
              return;
            }
            if (event.kind === "content") {
              controller.enqueue(sse("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: event.delta },
              }));
            } else if (event.kind === "done") {
              controller.enqueue(sse("content_block_stop", { type: "content_block_stop", index: 0 }));
              controller.enqueue(sse("message_delta", {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: event.usage,
              }));
              controller.enqueue(sse("message_stop", { type: "message_stop" }));
            } else {
              controller.enqueue(sse("error", cloudCodeError(event.message)));
            }
          }
          controller.close();
        } catch (error) {
          if (c.req.raw.signal.aborted) await release();
          else controller.enqueue(sse("error", cloudCodeError(error instanceof Error ? error.message : String(error))));
          controller.close();
        } finally {
          c.req.raw.signal.removeEventListener("abort", onAbort);
        }
      })();
    },
    cancel() {
      return release();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
