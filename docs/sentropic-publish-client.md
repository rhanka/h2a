# `h2a sentropic` — sign in and bind a workspace for publishing (preprod)

Piece 3 of the sentropic "h2a publish" plan: the OAuth client that lets h2a reach the sentropic
artifacts MCP resource server on **preprod**. The publish call itself is exercised by the
end-to-end test with the sentropic side; this surface proves the path (sign-in, binding,
`tools/list`).

## Commands

| Command | What it does | Network |
|---|---|---|
| `h2a sentropic login [--no-browser] [--tenant <id>] [--timeout <s>] [--no-refresh]` | Browser sign-in: authorization code + PKCE S256, `http://127.0.0.1:<port>/callback` loopback redirect. Prints the URL as the fallback. | AS |
| `h2a sentropic status [--json]` | Account (`sub`), tenant (`tid`), token expiry, refresh token yes/no, this workspace's binding. Never prints a token. | none |
| `h2a sentropic bind <workspace-id> [--verify]` | Records the explicit sentropic workspace for this local workspace. `--verify` first asks the resource server (`tools/list` with that workspace). | RS with `--verify` |
| `h2a sentropic unbind` | Removes this workspace's binding. | none |
| `h2a sentropic logout [--local-only]` | Revokes the refresh and access tokens at the AS revocation endpoint (RFC 7009) when advertised, then removes them locally. A failed revocation still removes them locally and says so. | AS unless `--local-only` |
| `h2a sentropic tools --preprod` | The minimal MCP call: `initialize` + `tools/list` on the preprod resource server with the stored token, for the bound workspace. Refuses without `--preprod`. | RS |

An expired session (no refresh token, or a refused refresh) prints
`… run \`h2a sentropic login\``, exits 1, and sends nothing to the resource server.

## Configuration (by name)

| Variable | Default | Meaning |
|---|---|---|
| `H2A_SENTROPIC_ENV` | `preprod` | The only environment: prod serves no MCP resource server yet. |
| `H2A_SENTROPIC_ISSUER` | `https://preprod.auth.sent-tech.ca` | Authorization server issuer (RFC 8414 discovery). |
| `H2A_SENTROPIC_MCP_URL` | `https://preprod.sentropic.sent-tech.ca/api/v1/mcp` | MCP endpoint, also the RFC 8707 `resource` (token audience). |
| `H2A_SENTROPIC_CLIENT_ID` | none | The public CLI client id registered on the AS. Required for login/refresh. Not a secret. |
| `H2A_SENTROPIC_REDIRECT_PORT` | ephemeral | Fixed loopback port, only if the AS matches redirect URIs exactly. |
| `H2A_SENTROPIC_HOME` | `~/.sentropic` | Token store and bindings directory. |
| `H2A_NO_BROWSER=1` | — | Same as `--no-browser`. |

Endpoints must be `https` (plain `http` only on `127.0.0.1`/`localhost`). No secret is
configured: the client is public (`token_endpoint_auth_method=none`).

## Storage

- **Tokens**: the shared sentropic token store `~/.sentropic/h2a-auth.json`
  (`packages/h2a-runtime/src/sentropic/auth-token.ts`, PR #428: per-server namespace, 0600,
  atomic, fail-closed on a damaged file, writers serialized by an owner-checked lock with the
  merge re-checked under it, strict RFC 3339 expiry). The record
  keeps its shape (`server`, `issuer`, `accessToken`, `refreshToken?`, `expiresAt`, `subject`),
  keyed by the resource server origin. This client always writes `expiresAt`. Logout and
  refresh-token rotation use `removeAuth` / `updateAuth` (same locked path as `writeAuth`;
  compare-and-set on the refresh token):
  a pair another process already rotated is never overwritten, and an old refresh token is never
  kept.
- **Bindings**: `~/.sentropic/h2a-bindings/<sha256(server, ws)>.json`, one 0600 file per
  (server, local workspace) in a 0700 directory. The local workspace is its durable git identity
  `ws:<sha256>` (same rule as track). The binding is a local routing choice; the resource server
  re-checks membership on every call.

## What the client checks

- Discovery names the configured issuer exactly; authorization, token and revocation endpoints
  are https on the issuer's origin; `S256` is advertised.
- The loopback listener binds `127.0.0.1` only and serves exactly one callback on `/callback`
  for `Host: 127.0.0.1:<port>`; another path or Host is a 404 that consumes nothing.
- On the callback: RFC 9207 `iss` (required when advertised), then `state` (constant time), then
  `code` or `error` (reported by its code only).
- Token exchange with the same `redirect_uri`, the verifier and the `resource`.
- `openid` is always requested and the id_token is required: `iss`, `aud`, `azp`, `exp`, `sub`
  and the login's `nonce` are checked (signature not verified: OIDC Core §3.1.3.7, TLS to the
  token endpoint).
- `offline_access` is requested only when discovery advertises it **and** the `refresh_token`
  grant. Refresh rotates the pair; a refused refresh (`invalid_grant`: revoked, expired, reuse
  detected) drops the dead pair and asks for a login.
- No output line or error ever carries a code, verifier, token, response body or
  `error_description` (sentinel test).

## What the sentropic authorization server must register

A public client for the h2a CLI, preprod:

| Field | Value |
|---|---|
| `client_id` | e.g. `h2a-cli` (then `H2A_SENTROPIC_CLIENT_ID=h2a-cli`) |
| `token_endpoint_auth_method` | `none` |
| redirect URIs | `http://127.0.0.1:<any port>/callback` (RFC 8252 §7.3). The AS on main matches redirect URIs exactly; until it accepts any loopback port, register one fixed port and set `H2A_SENTROPIC_REDIRECT_PORT`. |
| scopes | `openid email immo:artifacts:read immo:artifacts:write mcp:discover mcp:resources:read mcp:tools:invoke`, plus `offline_access` when refresh is enabled |
| resource indicators | `https://preprod.sentropic.sent-tech.ca/api/v1/mcp` |
| grant types | `authorization_code` (+ `refresh_token` with rotation, when enabled) |
| DPoP | not bound (the CLI sends Bearer tokens) |
| tool allowlist | not in the read-only client set (publishing needs the write tools) |

The token must carry `tid`: an account in several organizations signs in with
`--tenant <id>`.
