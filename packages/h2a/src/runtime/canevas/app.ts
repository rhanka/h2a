// Canevas ③ — read-only Hono app. Deps are injected so the app is testable with
// fakes; the real wiring (gather + lazy capturePane) lives in serve.ts. NO write
// routes here (the reply-bridge is a later, gated tranche). Bind 127.0.0.1 only.

import { Hono } from "hono";

import type { PendingDecision } from "./aggregate.js";
import type { PaneSnapshot } from "./adapter.js";
import type { AnswerResult } from "./answer.js";
import { CANEVAS_HTML } from "./ui.js";

export interface CanevasDeps {
  /** IO: current pending human decisions (read-only aggregate). */
  readonly listDecisions: () => PendingDecision[];
  /** IO: read-only tmux pane snapshot (lazy runtime; degraded-clean). */
  readonly capturePane: (tmuxName: string, lines: number) => Promise<PaneSnapshot>;
  /** tranche-3b write-bridge: required token for POST /answer. Absent → read-only. */
  readonly writeToken?: string;
  /** tranche-3b write-bridge: gated reply handler. Absent → 501. */
  readonly postAnswer?: (
    decisionId: string,
    body: { answerId: string; note?: string }
  ) => AnswerResult | Promise<AnswerResult>;
}

export function createCanevasApp(deps: CanevasDeps): Hono {
  const app = new Hono();

  // Self-hosted UI. The write token (if any) is injected into the same-origin
  // page so its buttons can POST; a cross-origin page has neither the token nor
  // CORS access.
  app.get("/", (c) => c.html(CANEVAS_HTML.replace("__CANEVAS_TOKEN__", deps.writeToken ?? "")));

  app.get("/api/decisions", (c) =>
    c.json({ kind: "canevas-decisions", version: 1, decisions: deps.listDecisions() })
  );

  app.get("/api/sessions/:tmuxName/pane", async (c) => {
    const tmuxName = c.req.param("tmuxName");
    const raw = Number(c.req.query("lines") ?? "200");
    const lines = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2000) : 200;
    const snap = await deps.capturePane(tmuxName, lines);
    return c.json({ kind: "canevas-pane", version: 1, tmuxName, lines, ...snap });
  });

  // tranche-3b — GATED reply-bridge. Requires the write token (same-origin page
  // has it; CORS is closed so no cross-origin write). The handler resolves the
  // target LIVE + is idempotent. answeredBy is "local-human" (never a forged
  // signed attestation).
  app.post("/api/decisions/:id/answer", async (c) => {
    if (!deps.postAnswer) return c.json({ error: "reply-bridge disabled" }, 501);
    if (deps.writeToken) {
      const tok = c.req.header("x-canevas-token");
      if (tok !== deps.writeToken) return c.json({ error: "forbidden: missing/invalid token" }, 403);
    }
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { answerId?: unknown; note?: unknown };
    const answerId = typeof body.answerId === "string" ? body.answerId : "";
    if (!answerId) return c.json({ error: "answerId (string) is required" }, 400);
    const result = await deps.postAnswer(id, {
      answerId,
      ...(typeof body.note === "string" ? { note: body.note } : {})
    });
    const code =
      result.status === "answered" ? 200 :
      result.status === "already" ? 409 :
      result.status === "not-found" ? 404 :
      result.status === "no-live-target" ? 409 : 400;
    return c.json(result, code);
  });

  return app;
}
