// Canevas ③ — server bootstrap. Binds the read-only Hono app to 127.0.0.1 and
// runs until an abort signal. Wires the real IO (gather + lazy capturePane).

import { serve } from "@hono/node-server";

import { capturePaneSnapshot } from "./adapter.js";
import { createCanevasApp } from "./app.js";
import { gatherPendingDecisions } from "./gather.js";

export const CANEVAS_DEFAULT_PORT = 8788;

export interface RunCanevasServeOptions {
  readonly root: string;
  readonly port?: number;
  readonly stderr: { write(s: string): void };
  readonly signal?: AbortSignal;
}

export async function runCanevasServe(opts: RunCanevasServeOptions): Promise<number> {
  const port =
    opts.port !== undefined && Number.isFinite(opts.port) && opts.port > 0
      ? opts.port
      : CANEVAS_DEFAULT_PORT;

  const app = createCanevasApp({
    listDecisions: () => gatherPendingDecisions(opts.root),
    capturePane: capturePaneSnapshot
  });

  // 127.0.0.1 STRICT — never bind a public interface (local human↔agents surface).
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  opts.stderr.write(
    `h2a canevas serve: read-only on http://127.0.0.1:${port} (root=${opts.root})\n`
  );

  return await new Promise<number>((resolve) => {
    const shutdown = (): void => {
      try {
        (server as { close?: () => void }).close?.();
      } catch {
        // best-effort
      }
      resolve(0);
    };
    if (opts.signal?.aborted) return shutdown();
    opts.signal?.addEventListener("abort", shutdown, { once: true });
  });
}
