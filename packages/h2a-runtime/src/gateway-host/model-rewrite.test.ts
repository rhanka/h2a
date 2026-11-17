import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLlmMesh,
  createProviderRegistry,
  InMemoryRoutePlanner,
  MuseAdapter,
} from "@sentropic/cluster-mesh/llm-mesh";

import {
  applyModelRewrite,
  matchModelRewrite,
  validateModelRewrites,
  type GatewayModelRewrite,
} from "./config-file.js";
import { createLocalGatewayApp, startServer } from "./host.js";
import { resetSessions } from "./sessions.js";
import { resetSessionLedger } from "./ledger.js";

vi.mock("../claude-code-cli-lifecycle.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../claude-code-cli-lifecycle.js")>();
  return {
    ...mod,
    sweepOrphanSandboxes: vi
      .fn()
      .mockResolvedValue({ swept: 0, retained: 0, skippedAlive: 0 }),
  };
});

let tempBase = "";

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), "h2a-gateway-rewrite-"));
  const emptyBin = join(tempBase, "bin");
  mkdirSync(emptyBin, { recursive: true });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-owner");
  vi.stubEnv("HOME", join(tempBase, "home"));
  vi.stubEnv("XDG_RUNTIME_DIR", join(tempBase, "run"));
  vi.stubEnv("H2A_ROOT", join(tempBase, "h2a-root"));
  vi.stubEnv("PATH", emptyBin);
  resetSessions();
  resetSessionLedger();
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  tempBase = "";
});

interface SeenBackendRequest {
  modelId?: string;
  effort?: string;
  toolNames: string[];
  stream: boolean;
}

/** Fake Muse backend + synthetic in-memory account (no real account). */
function fakeMusePlanner(seen: SeenBackendRequest[]) {
  const runtime = createLlmMesh({
    registry: createProviderRegistry([
      new MuseAdapter({
        client: {
          async generate(req: {
            modelId?: string;
            reasoning?: { effort?: string };
            tools?: Array<{ name: string }>;
          }) {
            seen.push({
              modelId: req.modelId,
              effort: req.reasoning?.effort,
              toolNames: (req.tools ?? []).map((tool) => tool.name),
              stream: false,
            });
            const firstTool = req.tools?.[0];
            return {
              id: "msg_fake_muse",
              providerId: "muse" as const,
              modelId: req.modelId ?? "muse-ember-1.0",
              text: firstTool ? "" : "ok",
              toolCalls: firstTool
                ? [{
                    toolCallId: "toolu_fake_1",
                    providerCallId: "toolu_fake_1",
                    name: firstTool.name,
                    argumentsText: JSON.stringify({ city: "Paris" }),
                    arguments: { city: "Paris" },
                  }]
                : [],
              reasoning: [],
              warnings: [],
              finishReason: firstTool ? "tool_calls" as const : "stop" as const,
              usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            };
          },
          async *stream(req: {
            modelId?: string;
            reasoning?: { effort?: string };
            tools?: Array<{ name: string }>;
          }) {
            seen.push({
              modelId: req.modelId,
              effort: req.reasoning?.effort,
              toolNames: (req.tools ?? []).map((tool) => tool.name),
              stream: true,
            });
            yield { type: "content_delta", data: { delta: "ok" } };
            yield {
              type: "done",
              data: {
                finishReason: "stop" as const,
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              },
            };
          },
        } as never,
      }),
    ]),
  });
  return new InMemoryRoutePlanner({
    directory: {
      async listEligible() {
        return [{
          accountRef: "synthetic-muse",
          diagnosticAccountRef: "acct_muse",
          ownerScopeRef: "cli:test-owner",
          targetProviderId: "muse",
          transportProviderId: "muse",
          supportedModelIds: ["muse-ember-1.0"],
          enrollmentCompletedAt: "2026-11-15T00:00:00.000Z",
          readiness: "ready" as const,
          revision: "r1",
        }];
      },
      async prepareAttempt({ target }: { target: { providerId: string; modelId: string; effort?: string } }) {
        const auth = {
          material: { type: "account-transport" as const, provider: "muse" as const, accessToken: "synthetic" },
          descriptor: { sourceType: "account-transport" as const, accountProviderId: "muse" as const },
        };
        const withRoute = <T extends Parameters<typeof runtime.generate>[0]>(req: T): T => ({
          ...req,
          providerId: target.providerId,
          modelId: target.modelId,
          auth,
          ...(target.effort
            ? { reasoning: { ...req.reasoning, effort: target.effort as never } }
            : {}),
        } as T);
        return {
          attemptRef: "attempt-synthetic",
          generate: (req: Parameters<typeof runtime.generate>[0]) => runtime.generate(withRoute(req)),
          stream: (req: Parameters<typeof runtime.stream>[0]) => runtime.stream(withRoute(req)),
          async recordOutcome() {},
          async markCommitted() {},
          async complete() {},
          async releaseCancelled() {},
        };
      },
    } as never,
  });
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function withGateway<T>(
  options: Parameters<typeof startServer>[0],
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const port = await freeLoopbackPort();
  expect(port).not.toBe(3002);
  vi.stubEnv("PORT", String(port));
  const server = await startServer(options);
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => {
      (server as { close: (cb?: () => void) => void }).close(() => resolve());
    });
  }
}

async function mintToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "rewrite-proof-session", clientSessionId: "claude-session" }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { gatewayToken: string };
  return body.gatewayToken;
}

async function postMessages(
  baseUrl: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": token },
    body: JSON.stringify(body),
  });
}

const EMBER_REWRITE: GatewayModelRewrite[] = [{
  match: { model: "claude-opus-5-5", effort: "medium" },
  target: { model: "muse-ember-1.0", effort: "max" },
}];

describe("gateway model rewrites (ephemeral loopback, fake Muse backend)", () => {
  it("applies the rewrite before routing and marks the response", async () => {
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { modelRewrites: EMBER_REWRITE, routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "claude-opus-5-5-medium",
          max_tokens: 64,
          messages: [{ role: "user", content: "ping" }],
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-h2a-model-rewrite"))
          .toBe("claude-opus-5-5-medium -> muse-ember-1.0");
        expect(response.headers.get("x-sentropic-served"))
          .toBe("provider=muse; model=muse-ember-1.0; transport=muse");
        const body = (await response.json()) as { model?: string };
        expect(body.model).toBe("muse-ember-1.0");
      },
    );
    expect(seen).toEqual([{ modelId: "muse-ember-1.0", effort: "max", toolNames: [], stream: false }]);
  });

  it("changes nothing when the config is absent", async () => {
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "muse-ember-1.0",
          max_tokens: 64,
          messages: [{ role: "user", content: "ping" }],
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-h2a-model-rewrite")).toBeNull();
        expect(response.headers.get("x-sentropic-served"))
          .toBe("provider=muse; model=muse-ember-1.0; transport=muse");
      },
    );
    expect(seen).toEqual([{ modelId: "muse-ember-1.0", effort: undefined, toolNames: [], stream: false }]);
  });

  it("does not match on an effort mismatch", async () => {
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { modelRewrites: EMBER_REWRITE, routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "claude-opus-5-5-high",
          max_tokens: 64,
          messages: [{ role: "user", content: "ping" }],
        });
        expect(response.headers.get("x-h2a-model-rewrite")).toBeNull();
        expect(response.status).not.toBe(200);
      },
    );
    expect(seen).toEqual([]);
  });

  it("passes tool_use through the rewritten route", async () => {
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { modelRewrites: EMBER_REWRITE, routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "claude-opus-5-5-medium",
          max_tokens: 64,
          messages: [{ role: "user", content: "weather in Paris?" }],
          tools: [{
            name: "get_weather",
            description: "Get the weather for a city",
            input_schema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          }],
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-h2a-model-rewrite"))
          .toBe("claude-opus-5-5-medium -> muse-ember-1.0");
        const body = (await response.json()) as {
          content?: Array<{ type?: string; name?: string; input?: unknown }>;
        };
        expect(body.content).toContainEqual(
          expect.objectContaining({ type: "tool_use", name: "get_weather", input: { city: "Paris" } }),
        );
      },
    );
    expect(seen).toEqual([{ modelId: "muse-ember-1.0", effort: "max", toolNames: ["get_weather"], stream: false }]);
  });

  it("passes streaming through the rewritten route", async () => {
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { modelRewrites: EMBER_REWRITE, routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "claude-opus-5-5-medium",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "ping" }],
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-h2a-model-rewrite"))
          .toBe("claude-opus-5-5-medium -> muse-ember-1.0");
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const text = await response.text();
        expect(text).toContain("ok");
        expect(text).toContain("message_stop");
      },
    );
    expect(seen).toEqual([{ modelId: "muse-ember-1.0", effort: "max", toolNames: [], stream: true }]);
  });

  it("loads the rewrites from the gateway config file", async () => {
    const home = join(tempBase, "home");
    mkdirSync(join(home, ".sentropic"), { recursive: true });
    writeFileSync(
      join(home, ".sentropic", "llm-mesh.json"),
      JSON.stringify({ modelRewrites: EMBER_REWRITE }) + "\n",
    );
    const seen: SeenBackendRequest[] = [];
    await withGateway(
      { routePlanner: fakeMusePlanner(seen), ownerScopeRef: "cli:test-owner" },
      async (baseUrl) => {
        const token = await mintToken(baseUrl);
        const response = await postMessages(baseUrl, token, {
          model: "claude-opus-5-5-medium",
          max_tokens: 64,
          messages: [{ role: "user", content: "ping" }],
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-h2a-model-rewrite"))
          .toBe("claude-opus-5-5-medium -> muse-ember-1.0");
      },
    );
    expect(seen).toEqual([{ modelId: "muse-ember-1.0", effort: "max", toolNames: [], stream: false }]);
  });

  it("refuses an unknown target at load, naming the entry", async () => {
    await expect(createLocalGatewayApp({
      modelRewrites: [{
        match: { model: "claude-opus-5-5", effort: "medium" },
        target: { model: "muse-inconnu-9.9", effort: "max" },
      }],
      routePlanner: fakeMusePlanner([]),
      ownerScopeRef: "cli:test-owner",
    })).rejects.toThrow(/modelRewrites\[0\].*muse-inconnu-9\.9/);
  });
});

describe("model rewrite matching and validation", () => {
  it("reads the requested effort from the model suffix and explicit fields only", () => {
    expect(matchModelRewrite(EMBER_REWRITE, { model: "claude-opus-5-5-medium" })?.entry)
      .toEqual(EMBER_REWRITE[0]);
    expect(matchModelRewrite(EMBER_REWRITE, {
      model: "claude-opus-5-5",
      reasoning: { effort: "medium" },
    })?.entry).toEqual(EMBER_REWRITE[0]);
    expect(matchModelRewrite(EMBER_REWRITE, {
      model: "claude-opus-5-5",
      reasoning_effort: "medium",
    })?.entry).toEqual(EMBER_REWRITE[0]);
    // A thinking budget is a token ceiling, never an effort rung.
    expect(matchModelRewrite(EMBER_REWRITE, {
      model: "claude-opus-5-5",
      thinking: { type: "enabled", budget_tokens: 64000 },
    })).toBeUndefined();
    expect(matchModelRewrite(EMBER_REWRITE, { model: "claude-opus-5-5-high" }))
      .toBeUndefined();
  });

  it("rewrites the model and effort carriers, preserving thinking", () => {
    const rewritten = applyModelRewrite({
      model: "claude-opus-5-5",
      thinking: { type: "enabled", budget_tokens: 8000 },
      messages: [],
    }, EMBER_REWRITE[0]!);
    expect(rewritten.model).toBe("muse-ember-1.0");
    expect(rewritten.reasoning).toEqual({ effort: "max" });
    expect(rewritten.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
  });

  it("refuses a disallowed target effort, chains and loops at load", () => {
    expect(() => validateModelRewrites([{
      match: { model: "claude-opus-5-5" },
      target: { model: "muse-ember-1.0", effort: "low" },
    }])).toThrow(/modelRewrites\[0\].*muse-ember-1\.0.*low/);
    expect(() => validateModelRewrites([
      { match: { model: "claude-opus-5-5" }, target: { model: "muse-wonder-1.0", effort: "max" } },
      { match: { model: "muse-wonder-1.0" }, target: { model: "muse-ember-1.0", effort: "max" } },
    ])).toThrow(/modelRewrites\[0\].*chain/);
    expect(() => validateModelRewrites([
      { match: { model: "muse-wonder-1.0" }, target: { model: "muse-ember-1.0", effort: "max" } },
      { match: { model: "muse-ember-1.0" }, target: { model: "muse-wonder-1.0", effort: "max" } },
    ])).toThrow(/chain|loop/);
    expect(validateModelRewrites(EMBER_REWRITE)).toEqual(EMBER_REWRITE);
    expect(validateModelRewrites([])).toEqual([]);
    expect(validateModelRewrites(undefined)).toEqual([]);
  });
});
