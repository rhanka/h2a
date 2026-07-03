// Canevas ③ — read-only Hono app. Deps are injected so the app is testable with
// fakes; the real wiring (gather + lazy capturePane) lives in serve.ts. NO write
// routes here (the reply-bridge is a later, gated tranche). Bind 127.0.0.1 only.

import { Hono } from "hono";

import type { PendingDecision } from "./aggregate.js";
import type { PaneSnapshot } from "./adapter.js";
import { CANEVAS_HTML } from "./ui.js";

export interface CanevasDeps {
  /** IO: current pending human decisions (read-only aggregate). */
  readonly listDecisions: () => PendingDecision[];
  /** IO: read-only tmux pane snapshot (lazy runtime; degraded-clean). */
  readonly capturePane: (tmuxName: string, lines: number) => Promise<PaneSnapshot>;
}

export function createCanevasApp(deps: CanevasDeps): Hono {
  const app = new Hono();

  // Self-hosted read-only UI (tranche-3a). Answer buttons are placeholders until
  // the guarded reply-bridge (tranche-3b).
  app.get("/", (c) => c.html(CANEVAS_HTML));

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

  return app;
}
