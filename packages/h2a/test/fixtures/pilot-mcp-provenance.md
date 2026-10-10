# Pilot MCP incident input (synthetic)

`pilot-mcp.json.pre-incident` is a synthetic stand-in with the same shape as
the pre-incident configuration of the R6 incident: one `graphify-ts` server
launched with `npx.cmd` on Windows, plus an environment entry. No byte comes
from any private repository.

- Size: 323 bytes, UTF-8, LF, no BOM.
- SHA-256: `4cb2e5d3186cb16665c91b69f7e93be1d9bc9eda61b5bab8a7adfcea8eb50f41`.

Tests verify this input's hash before executing the unchanged published
0.98.0 preparation and writer.
