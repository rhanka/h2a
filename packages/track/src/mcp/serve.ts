// track-mcp — the SHARED stdio serve path, used by BOTH the `track-mcp` bin
// (./cli.ts) and any in-process host (e.g. h2a's native `track-mcp` verb via the
// `@sentropic/track/mcp` export). Keeping ONE serve path means the bin and the
// embedded host can never drift. Exposed additively via package `exports["./mcp"]`.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

import type { ResolveOptions } from '../cli/resolve.js'
import { createTrackMcpServer } from './server.js'

// Re-export the factory so `@sentropic/track/mcp` is the single surface an
// embedding host imports (server + serve helpers together).
export { createTrackMcpServer } from './server.js'

export interface ServeTrackMcpStdioOptions {
  /**
   * Abort to stop serving: the server + its transport are closed and the promise
   * resolves. This is the graceful-shutdown hook an embedding host wires to its
   * SIGTERM/SIGINT/SIGHUP handler (e.g. h2a's `track-mcp` bin.ts branch).
   */
  readonly signal?: AbortSignal
}

/**
 * Await a CONNECTED MCP `server` until it closes — either the peer closed the
 * transport (stdin EOF) or `opts.signal` aborted (we close it). Resolves exactly
 * once; rejects only if a requested close throws. Transport-agnostic, so it is
 * unit-testable over an in-memory pair with no stdio coupling — which is where
 * the graceful-shutdown contract for the in-process host is actually verified.
 */
export async function runServerUntilClosed(
  server: Server,
  opts: ServeTrackMcpStdioOptions = {},
): Promise<void> {
  const { signal } = opts
  if (signal?.aborted) {
    await server.close()
    return
  }
  return await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (err?: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      server.onclose = () => {} // detach (the `settled` guard already dedups re-entry)
      if (err !== undefined) reject(err)
      else resolve()
    }
    const onAbort = (): void => {
      // close() also fires onclose → finish(); the `settled` guard dedups.
      server.close().then(() => finish(), (err: unknown) => finish(err))
    }
    // Peer-initiated close (stdin EOF) AND our own close() both fire onclose.
    server.onclose = (): void => finish()
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Serve the read-only track MCP over stdio. Resolves when the transport closes or
 * `opts.signal` aborts; rejects only on a real connect/transport failure (the bin
 * turns that into rc=1 + stderr). The store is resolved LAZILY per read call by
 * the factory, so a `.track` created after boot is picked up without a restart.
 */
export async function serveTrackMcpStdio(
  source: string | ResolveOptions,
  opts: ServeTrackMcpStdioOptions = {},
): Promise<void> {
  if (opts.signal?.aborted) return
  const server = createTrackMcpServer(source)
  await server.connect(new StdioServerTransport())
  return await runServerUntilClosed(server, opts)
}
