/**
 * EVO-12 hosted MCP — runnable entrypoint (Docker CMD / `node dist/runtime/mcp-http/main.js`).
 * Reads the deploy env and serves the OAuth-gated read-only MCP over HTTP.
 */
import { startHostedServer } from "./serve.js";

startHostedServer()
  .then((s) => {
    process.stderr.write(`h2a hosted MCP (EVO-12) listening on :${s.port}\n`);
  })
  .catch((e: unknown) => {
    process.stderr.write(`h2a hosted MCP failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
