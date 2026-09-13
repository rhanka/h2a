import {
  InMemoryRoutePlanner,
  RoutePlanError,
  modelProfiles,
  type AccountDirectoryPort,
  type EligibleAccountDescriptor,
  type PreparedRouteAttempt,
  type RoutePlanInput,
  type RoutePlanner,
  type StreamEvent,
  type StreamRequest,
} from "@sentropic/llm-mesh";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plannerState = vi.hoisted(() => ({
  current: undefined as RoutePlanner | undefined,
}));

vi.mock("../llm-mesh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm-mesh.js")>();
  const activePlanner = (): RoutePlanner => {
    if (!plannerState.current) throw new Error("native-tools test planner is not configured");
    return plannerState.current;
  };
  const forwardingPlanner: RoutePlanner = {
    plan: (...args) => activePlanner().plan(...args),
    prepareAttempt: (...args) => activePlanner().prepareAttempt(...args),
    describeAffinity: (...args) => activePlanner().describeAffinity(...args),
    promoteAffinity: (...args) => activePlanner().promoteAffinity(...args),
    rebindAffinity: (...args) => activePlanner().rebindAffinity(...args),
    resetAffinity: (...args) => activePlanner().resetAffinity(...args),
  };
  return {
    ...actual,
    createCliLlmMeshFacade: () => ({
      createRoutePlanner: () => forwardingPlanner,
    }),
  };
});

import { createLocalGatewayApp } from "./index.js";
import { resetSessionLedger } from "./session-ledger.js";
import { resetSessions } from "./sticky.js";

const MODEL = "claude-sonnet-5";

const nativePrimitives = [
  {
    name: "h2a_loop_create",
    input: { goal: "Keep the objective moving", instance: "builder" },
    result: "loop-created",
  },
  {
    name: "SendMessage",
    input: { recipient: "peer", content: "Gateway round-trip verified" },
    result: "message-sent",
  },
  {
    name: "AskUserQuestion",
    input: {
      questions: [{
        question: "Continue?",
        header: "Gateway",
        options: [{ label: "Continue", description: "Resume the objective." }],
        multiSelect: false,
      }],
    },
    result: "continue",
  },
] as const;

const toolDefinition = (name: string) => ({
  name,
  description: `Exercise ${name} through the active gateway`,
  input_schema: { type: "object", additionalProperties: true },
});

class NativeToolDirectory implements AccountDirectoryPort {
  readonly requests: StreamRequest[] = [];
  readonly accounts: EligibleAccountDescriptor[] = [{
    accountRef: "internal-tool-account",
    diagnosticAccountRef: "tool-account",
    targetProviderId: "anthropic",
    transportProviderId: "claude-code",
    supportedModelIds: [MODEL],
    enrollmentCompletedAt: "2026-09-01T00:00:00Z",
    readiness: "ready",
    revision: "r1",
  }];

  async listEligible(): Promise<readonly EligibleAccountDescriptor[]> {
    return this.accounts;
  }

  async prepareAttempt(): Promise<PreparedRouteAttempt> {
    return {
      attemptRef: `attempt-${this.requests.length + 1}`,
      async generate() {
        throw new Error("native primitive harness requires streaming");
      },
      stream: async (request) => {
        this.requests.push(request);
        const continuation = request.messages.some((message) => message.role === "tool");
        const selectedTool = request.tools?.[0];
        const events = async function* (): AsyncGenerator<StreamEvent> {
          if (continuation) {
            yield { type: "content_delta", data: { delta: "continued" } };
            yield { type: "done", data: { finishReason: "stop" } };
            return;
          }
          if (!selectedTool) throw new Error("tool definition was dropped before dispatch");
          yield {
            type: "tool_call_start",
            data: {
              toolCallId: `call-${selectedTool.name}`,
              providerCallId: `provider-${selectedTool.name}`,
              name: selectedTool.name,
              argumentsText: JSON.stringify(
                nativePrimitives.find((primitive) => primitive.name === selectedTool.name)?.input,
              ),
            },
          };
          yield { type: "done", data: { finishReason: "tool_calls" } };
        };
        return events();
      },
      async recordOutcome() {},
      async markCommitted() {},
      async complete() {},
      async releaseCancelled() {},
    };
  }
}

interface PlannerObservation {
  readonly inputs: RoutePlanInput[];
  error?: unknown;
}

const observingPlanner = (
  directory: AccountDirectoryPort,
  observation: PlannerObservation,
): RoutePlanner => {
  const planner = new InMemoryRoutePlanner({ directory });
  return {
    async plan(subject, input) {
      observation.inputs.push(input);
      try {
        return await planner.plan(subject, input);
      } catch (error) {
        observation.error = error;
        throw error;
      }
    },
    prepareAttempt: (...args) => planner.prepareAttempt(...args),
    describeAffinity: (...args) => planner.describeAffinity(...args),
    promoteAffinity: (...args) => planner.promoteAffinity(...args),
    rebindAffinity: (...args) => planner.rebindAffinity(...args),
    resetAffinity: (...args) => planner.resetAffinity(...args),
  };
};

const createGatewaySession = async (planner: RoutePlanner) => {
  plannerState.current = planner;
  const app = createLocalGatewayApp({ ownerScopeRef: "cli:test-owner" });
  const created = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "gateway-session",
      clientSessionId: "client-session",
      workspaceId: "/workspace",
    }),
  });
  expect(created.status).toBe(201);
  const { gatewayToken } = await created.json() as { gatewayToken: string };
  return { app, gatewayToken };
};

const sendMessages = (
  app: ReturnType<typeof createLocalGatewayApp>,
  gatewayToken: string,
  body: Record<string, unknown>,
) => app.request("/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": gatewayToken,
  },
  body: JSON.stringify(body),
});

const ssePayloads = (raw: string): Record<string, unknown>[] => raw
  .split(/\r?\n\r?\n/)
  .flatMap((frame) => {
    const data = frame.split(/\r?\n/).find((line) => line.startsWith("data: "));
    return data ? [JSON.parse(data.slice(6)) as Record<string, unknown>] : [];
  });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-owner");
  resetSessions();
  resetSessionLedger();
});

afterEach(() => {
  plannerState.current = undefined;
  vi.unstubAllEnvs();
});

describe("native primitives through the active LLM gateway", () => {
  it.each(nativePrimitives)(
    "round-trips $name through tool-capable routing",
    async ({ name, input, result }) => {
      const directory = new NativeToolDirectory();
      const observation: PlannerObservation = { inputs: [] };
      const { app, gatewayToken } = await createGatewaySession(
        observingPlanner(directory, observation),
      );
      const initial = await sendMessages(app, gatewayToken, {
        model: MODEL,
        max_tokens: 128,
        stream: true,
        messages: [{ role: "user", content: `Use ${name}.` }],
        tools: [toolDefinition(name)],
      });

      expect(initial.status).toBe(200);
      const payloads = ssePayloads(await initial.text());
      const toolStart = payloads.find((payload) =>
        (payload.content_block as { type?: string } | undefined)?.type === "tool_use");
      const argumentDelta = payloads.find((payload) =>
        (payload.delta as { type?: string } | undefined)?.type === "input_json_delta");
      expect(toolStart).toMatchObject({
        content_block: {
          type: "tool_use",
          id: `provider-${name}`,
          name,
          input: {},
        },
      });
      expect(JSON.parse(
        (argumentDelta?.delta as { partial_json: string }).partial_json,
      )).toEqual(input);
      expect(payloads).toContainEqual(expect.objectContaining({
        delta: expect.objectContaining({ stop_reason: "tool_use" }),
      }));
      expect(observation.inputs[0]?.requiredCapabilities).toContain("tools");
      expect(directory.requests[0]?.tools?.[0]).toMatchObject({ name });

      const toolUseId = `provider-${name}`;
      const continuation = await sendMessages(app, gatewayToken, {
        model: MODEL,
        max_tokens: 128,
        stream: true,
        messages: [
          { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name, input }] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolUseId, content: result }],
          },
        ],
        tools: [toolDefinition(name)],
      });

      expect(continuation.status).toBe(200);
      expect(await continuation.text()).toContain("continued");
      expect(observation.inputs[1]?.requiredCapabilities).toContain("tools");
      expect(directory.requests[1]?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: [expect.objectContaining({
            providerCallId: toolUseId,
            name,
            arguments: input,
          })],
        }),
        expect.objectContaining({
          role: "tool",
          toolResult: expect.objectContaining({
            providerCallId: toolUseId,
            name,
            output: { content: result },
          }),
        }),
      ]));
    },
  );

  it("fails closed before dispatch when the selected model does not support tools", async () => {
    const profile = modelProfiles.find((candidate) =>
      candidate.providerId === "anthropic" && candidate.modelId === MODEL);
    if (!profile) throw new Error(`missing test model profile: ${MODEL}`);
    const mutableTools = profile.capabilities.tools as { support: string };
    const originalSupport = mutableTools.support;
    mutableTools.support = "unsupported";

    try {
      const directory = new NativeToolDirectory();
      const observation: PlannerObservation = { inputs: [] };
      const { app, gatewayToken } = await createGatewaySession(
        observingPlanner(directory, observation),
      );
      const response = await sendMessages(app, gatewayToken, {
        model: MODEL,
        max_tokens: 128,
        stream: true,
        messages: [{ role: "user", content: "Exercise the native primitives." }],
        tools: nativePrimitives.map(({ name }) => toolDefinition(name)),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        type: "error",
        error: { type: "overloaded_error", message: "service temporarily unavailable" },
      });
      expect(observation.inputs).toHaveLength(1);
      expect(observation.inputs[0]?.requiredCapabilities).toContain("tools");
      expect(observation.error).toBeInstanceOf(RoutePlanError);
      expect(observation.error).toMatchObject({
        code: "capabilities-unmet",
        message: "Required capabilities are unavailable",
      });
      expect(directory.requests).toHaveLength(0);
    } finally {
      mutableTools.support = originalSupport;
    }
  });
});
