import type { Context } from "hono";
import { accountSupportsRoute, findAccount, markAccountExhausted, selectFallbackAccount } from "./accounts.js";
import {
  lookupToken,
  rebindGatewaySession,
  type SessionEntry,
} from "./sticky.js";
import { handleMessagesViaOpenAI } from "./proxy-openai.js";
import { handleMessagesViaGemini } from "./proxy-gemini.js";
import {
  accountPoolForProvider,
  resolveModelRoute,
  type RoutingTarget,
} from "./model-catalog.js";
import {
  recordSessionActive,
  recordSessionFallback,
  recordSessionIdle,
  recordSessionRateLimitComplete,
  recordSessionRateLimited,
  recordSessionRequest,
} from "./session-ledger.js";

const ANTHROPIC_BASE =
  process.env.ANTHROPIC_UPSTREAM_URL ?? "https://api.anthropic.com";

const PASSTHROUGH_REQUEST_HEADERS = [
  "anthropic-version",
  "anthropic-beta",
  "content-type",
] as const;

const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "transfer-encoding",
  "retry-after",
] as const;

function gatewayTokenFromRequest(c: Context): string | null {
  const auth = c.req.header("authorization") ?? "";
  if (auth.startsWith("Bearer gw-")) return auth.slice("Bearer ".length);

  const apiKey = c.req.header("x-api-key") ?? "";
  if (apiKey.startsWith("gw-")) return apiKey;

  return null;
}

function usesOpenAIProvider(provider: string): boolean {
  return provider === "openai" || provider === "codex";
}

function isQuotaFallbackResponse(response: Response): boolean {
  return response.status === 429 || response.status === 404;
}

function quotaReason(response: Response): string {
  return `upstream ${response.status}`;
}

function retryAfterMs(response: Response, nowMs = Date.now()): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined;
}

async function rebindAfterQuotaResponse(
  gatewayToken: string,
  session: SessionEntry,
  response: Response,
  route?: RoutingTarget,
): Promise<SessionEntry | undefined> {
  const exhaustedAccount = findAccount(session.accountId);
  if (exhaustedAccount && response.status === 429) {
    const retry = retryAfterMs(response);
    recordSessionRateLimited(session.sessionId, exhaustedAccount, {
      ...(route ? { route } : {}),
      ...(retry !== undefined ? { retryAfterMs: retry } : {}),
    });
  }
  markAccountExhausted(session.accountId, quotaReason(response));
  const fallback = selectFallbackAccount(session.accountId, Date.now(), {
    ...(session.requiredTransport
      ? { requiredTransport: session.requiredTransport }
      : {}),
    ...(route ? { route } : {}),
  });
  if (!fallback) return undefined;
  if (
    response.status === 429 &&
    accountPoolForProvider(fallback.provider) !==
      accountPoolForProvider(session.provider)
  ) {
    return undefined;
  }

  let rebound: SessionEntry | undefined;
  try {
    rebound = await rebindGatewaySession(gatewayToken, fallback, route);
  } catch (err) {
    console.warn(
      `[llm-gateway] quota fallback rebind failed for ${session.accountId}: ${String(err)}`,
    );
    return undefined;
  }
  if (!rebound) return undefined;

  if (exhaustedAccount) {
    recordSessionFallback(
      session.sessionId,
      exhaustedAccount,
      fallback,
      route,
    );
  }

  await response.body?.cancel().catch(() => {});
  console.warn(
    `[llm-gateway] account ${session.accountId} returned ${response.status}; ` +
      `rebinding session to ${fallback.id} (${fallback.provider})`,
  );
  return rebound;
}

function completeWhenBodyEnds(
  response: Response,
  complete: () => void,
): Response {
  if (!response.body) {
    complete();
    return response;
  }
  const reader = response.body.getReader();
  let completed = false;
  const completeOnce = () => {
    if (completed) return;
    completed = true;
    complete();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          completeOnce();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        completeOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      completeOnce();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleMessagesViaAnthropic(
  c: Context,
  session: Pick<SessionEntry, "token">,
  body: ArrayBuffer,
): Promise<Response> {
  const upstreamUrl = `${ANTHROPIC_BASE}/v1/messages`;

  const requestHeaders: Record<string, string> = {
    "anthropic-version": c.req.header("anthropic-version") ?? "2023-06-01",
  };
  for (const h of PASSTHROUGH_REQUEST_HEADERS) {
    const v = c.req.header(h);
    if (v !== undefined) requestHeaders[h] = v;
  }
  // SECURITY (architect review 2026-07-13): a Claude Code OAuth token (sk-ant-oat…) must NEVER be
  // relayed here as a raw Anthropic Bearer. It is stored as a pooled claude-code account (WP16) but
  // is meant to be served via the personal-passthrough EXECUTION path (the account executes the
  // request), not by replaying the subscription token to api.anthropic.com (ToS/ban risk on the
  // user's Claude Max). The claude-code serve mechanism is pending the gateway (claude:mesh) lane;
  // do NOT re-add a raw Bearer relay without that sign-off. Keep the API-key path here.
  requestHeaders["x-api-key"] = session.token;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: requestHeaders,
      body,
      // @ts-expect-error Node 18+ fetch supports duplex for streaming
      duplex: "half",
      signal: c.req.raw.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    throw err;
  }

  const responseHeaders: Record<string, string> = {};
  for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v !== null) responseHeaders[h] = v;
  }

  // Pipe stream directly — never buffer
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

async function dispatchToSessionAccount(
  c: Context,
  session: SessionEntry,
  body: ArrayBuffer,
  recordOutbound: () => void,
): Promise<Response> {
  if (
    session.requiredTransport &&
    session.transport !== session.requiredTransport
  ) {
    return c.json(
      { error: "gateway session transport constraint is no longer satisfied" },
      503,
    );
  }
  // The account/transport guard above has passed. This is the final common
  // point immediately before the provider-specific outbound request is
  // constructed, so route text cannot be claimed merely from parsing or a
  // successful rebind.
  recordOutbound();
  if (
    session.provider === "google" ||
    session.provider === "gemini" ||
    session.provider === "gcp" ||
    session.provider === "gemini-code-assist"
  ) {
    return handleMessagesViaGemini(c, session, body);
  }
  if (usesOpenAIProvider(session.provider)) {
    return handleMessagesViaOpenAI(
      c,
      {
        token: session.token,
        gatewayToken: session.gatewayToken,
        accountId: session.accountId,
        sessionId: session.sessionId,
        ...(session.requiredTransport
          ? { requiredTransport: session.requiredTransport }
          : {}),
      },
      body,
    );
  }
  return handleMessagesViaAnthropic(c, session, body);
}

function routeFromRequestBody(body: ArrayBuffer): RoutingTarget | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      model?: unknown;
    };
    return typeof parsed.model === "string"
      ? resolveModelRoute(parsed.model)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function handleMessages(c: Context): Promise<Response> {
  const gatewayToken = gatewayTokenFromRequest(c);
  if (!gatewayToken) return c.json({ error: "unauthorized" }, 403);

  let session = await lookupToken(gatewayToken);
  if (!session) return c.json({ error: "unauthorized" }, 403);

  const body = await c.req.raw.arrayBuffer();
  const route = routeFromRequestBody(body);

  const sessionAccount = findAccount(session.accountId);
  if (route && !sessionAccount) {
    return c.json({ error: "gateway session account is unavailable" }, 503);
  }
  if (route && sessionAccount && !accountSupportsRoute(sessionAccount, route)) {
    const correctPoolAccount = selectFallbackAccount(session.accountId, Date.now(), {
      route,
    });
    if (!correctPoolAccount) {
      return c.json({ error: "no account can serve the requested route" }, 503);
    }
    try {
      const rebound = await rebindGatewaySession(
        gatewayToken,
        correctPoolAccount,
        route,
      );
      if (!rebound) {
        return c.json({ error: "requested route could not be rebound" }, 503);
      }
      const reboundSession = rebound;
      session = reboundSession;
    } catch (err) {
      console.error("rebindGatewaySession failed:", err);
      return c.json({ error: "requested route could not be rebound" }, 503);
    }
  }

  const attempted = new Set<string>();
  let outboundRecorded = false;

  try {
    for (;;) {
      const dispatchSession = session;
      attempted.add(dispatchSession.accountId);
      const response = await dispatchToSessionAccount(c, dispatchSession, body, () => {
        if (outboundRecorded) return;
        recordSessionRequest(dispatchSession.sessionId, route);
        outboundRecorded = true;
      });
      if (!isQuotaFallbackResponse(response)) {
        const completedSessionId = session.sessionId;
        return completeWhenBodyEnds(response, () =>
          recordSessionIdle(completedSessionId, route),
        );
      }

      const rebound = await rebindAfterQuotaResponse(
        gatewayToken,
        session,
        response,
        route,
      );
      if (!rebound || attempted.has(rebound.accountId)) {
        if (response.status === 429) {
          recordSessionRateLimitComplete(session.sessionId, route);
        } else {
          recordSessionIdle(session.sessionId, route);
        }
        return response;
      }
      session = rebound;
      recordSessionActive(session.sessionId, route);
    }
  } catch (error) {
    recordSessionIdle(session.sessionId, route);
    throw error;
  }
}
