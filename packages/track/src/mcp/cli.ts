#!/usr/bin/env node
// `track-mcp` bin — a stdio read-only MCP server over the nearest-ancestor `.track/events.jsonl`.
// Thin bootstrap: it builds the resolve options and delegates to the SHARED
// `serveTrackMcpStdio` (also imported in-process by h2a's native `track-mcp`
// verb via `@sentropic/track/mcp`), so the bin and the embedded host can never drift.
import type { ResolveOptions } from '../cli/resolve.js'
import { serveTrackMcpStdio } from './serve.js'

// Launch/serve alignment: like h2a `mcp-serve`, `track-mcp` BOOTS UNCONDITIONALLY and advertises its
// read tools without requiring pre-existing project state. The store is resolved LAZILY per read call
// (`--track-dir`→`TRACK_DIR`→nearest-ancestor `.track`), so a `.track` created AFTER boot is picked up
// without a restart. When none resolves, reads serve an honest-empty view + an init hint — `track-mcp`
// is read-only and NEVER creates a store. A bad EXPLICIT override stays loud (surfaced as a read error).
const flagIdx = process.argv.indexOf('--track-dir')
const flag = flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined
const env = process.env['TRACK_DIR']
const resolveOpts: ResolveOptions = {
  cwd: process.cwd(),
  ...(flag !== undefined ? { flag } : {}),
  ...(env !== undefined ? { env } : {}),
}

// Keep the transport fatal: a real connect/transport failure must stay loud (rc=1 + stderr).
// The bin passes NO abort signal — it serves for the process lifetime (stdin EOF resolves it).
serveTrackMcpStdio(resolveOpts).catch((error: unknown) => {
  process.stderr.write(`track-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
