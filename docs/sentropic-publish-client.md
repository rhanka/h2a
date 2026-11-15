# `h2a sentropic` — sign in and bind a workspace for publishing

Piece 3 of the sentropic "h2a publish" plan: the OAuth client that lets h2a reach a declared
cluster-mesh MCP resource server (with sentropic **preprod** as the built-in default federation).
The publish call itself is exercised by the end-to-end test with the sentropic side; this surface
proves the path (sign-in, workspace listing, binding, `tools/list`), carries the `tools/call`
rules the publish uses, and leaves room under `h2a sentropic` for
`h2a sentropic artifact appscript push|get|status [--federation <name>]`.

## Commands

| Command | What it does | Network |
|---|---|---|
| `h2a sentropic login [--federation <name>] [--no-browser] [--tenant <id>] [--timeout <s>] [--no-refresh]` | Browser sign-in: authorization code + PKCE S256, `http://127.0.0.1:<port>/callback` loopback redirect. Prints the URL as the fallback. | AS |
| `h2a sentropic status [--federation <name>] [--json]` | Account (`sub`), tenant (`tid`), token expiry, refresh token yes/no, and this workspace's binding. Without `--federation`, lists all declared federations. Never prints a token. | none |
| `h2a sentropic workspaces [--federation <name>] [--json]` | The workspaces this account can read now on the selected federation, from the `workspaces_list` MCP host tool: id, role, publishable, name; `*` marks the one bound here. Never prints a token. | RS |
| `h2a sentropic bind <workspace-id> [--federation <name>]` | Records the explicit sentropic workspace for this local workspace on the selected federation (recording the `federation` name), after checking it against `workspaces_list`: an id the account cannot read, or cannot publish to, is refused and nothing is recorded. | RS |
| `h2a sentropic unbind [--federation <name>]` | Removes this workspace's binding for the selected federation. | none |
| `h2a sentropic logout [--federation <name>] [--local-only]` | Revokes the refresh and access tokens at the AS revocation endpoint (RFC 7009) when advertised, then removes them locally for the selected federation. A failed revocation still removes them locally and says so. | AS unless `--local-only` |
| `h2a sentropic tools --federation <name> \| --preprod` | The minimal MCP call: `initialize` + `tools/list` on a declared federation's resource server with the stored token, for the bound workspace. `--preprod` is kept as an alias for `--federation preprod`. Refuses without `--federation` (or `--preprod`), and refuses any undeclared resource server or cross-federation token. | RS |

An expired session (no refresh token, or a refused refresh) prints
`… run \`h2a sentropic login\``, exits 1, and sends nothing to the resource server.

## Workspaces and binding

- `workspaces_list` (sentropic MCP host tool, needs `mcp:discover` to be listed and
  `mcp:tools:invoke` to be called) answers `{workspaces:[{workspaceRef, name, role, publishable}]}`
  for the token's account and tenant, filtered like artifact read authorization.
- The client calls it only when `tools/list` names it. While it is absent (servers before
  sentropic train 1b), `bind <id>` is recorded **without validation**, with a warning: the server
  stays the authority at publish. `workspaces` then says the tool is not offered.
- On those servers `tools/list` answers the catch-all JSON-RPC `-32603` when it cannot bind the
  workspace it lists for: the default one (no workspace, or the most recent one in another tenant
  than the token's) or an explicit one the account cannot read. The client counts that answer as
  `workspaces_list` absent (bind recorded with the warnings, `workspaces` says not offered); once
  bound, every call carries the bound `workspaceRef`, and a readable workspace of the right tenant
  lists normally. `tools --federation <name>` (or `--preprod`) without a binding points to `bind` on
  such a `-32603`.
- `publishable` is a hint for choosing. The listing is read live for each `workspaces` and each
  `bind`, and never stored: the binding file keeps the routing choice only (local `ws:` identity,
  `federation`, `server`, workspace id, subject, tenant, time).
- Every `tools/call` carries `params.workspaceRef` next to `name` and `arguments`. Without it the
  server falls back to a default workspace of its own choosing (most recent, no tenant or role
  filter), so a workspace-bound tool call is never sent without it. `workspaces_list` binds no
  workspace; the bound id travels with it anyway when there is one.
- The server re-checks at every call. When the account lost the bound workspace since the bind
  (revoked membership, lower role), the call is refused (`access_denied`, or no publish tool
  listed for it) and the client says so, inviting to run `h2a sentropic workspaces`, then to bind
  another workspace or `h2a sentropic unbind`.
- Train 1b checks membership at authentication: a removed member gets a 403 `access_denied` on
  the bound `workspaceRef` itself, `tools/list` included. `workspaces` then reads the listing
  again without that `workspaceRef` (`workspaces_list` binds no workspace) and warns that the
  workspace bound here is no longer accessible (`staleBinding: true` in `--json`): bind another
  one, or `h2a sentropic unbind`.
- Without a `workspaceRef`, `tools/list` binds the account's default workspace (its most recent
  membership). An account with none gets a 403 `access_denied` there: the client says the
  resource server finds no workspace for this account (join one, or bind one), not to log in
  again. A 403 `access_denied` on `workspaces_list` still means the credential is refused, and
  asks for a new login.
- A binding made by another account, in another tenant, or under another federation than the
  logged-in token is refused on the publish path (`tools`), with a request to bind again; `status`
  and `workspaces` show it as a warning.

## Declarative federations and precedence

### User configuration (`~/.config/sentropic/h2a/config.json`)

The runtime's user configuration file can declare a read-only list of named OAuth/MCP federations
and an optional `defaultFederation` under the `sentropic` key (never mutated by agent tools):

```json
{
  "sentropic": {
    "defaultFederation": "preprod",
    "federations": [
      {
        "name": "staging",
        "issuer": "https://auth.staging.example.test",
        "mcpUrl": "https://mcp.staging.example.test/api/v1/mcp",
        "clientId": "h2a-cli",
        "redirectPort": 18400,
        "label": "Staging mesh"
      }
    ]
  }
}
```

- **`preprod` built-in default**: `preprod` (`https://preprod.auth.sent-tech.ca` +
  `https://preprod.sentropic.sent-tech.ca/api/v1/mcp`) is always present unless overridden by a
  declared entry with `"name": "preprod"`. Without a config file, behaviour is unchanged.
- **Validation**: every declared entry must have a plain identifier `name` (`[A-Za-z0-9._:-]`,
  unique across the list), an `issuer` (RFC 8414) and `mcpUrl` (RFC 8707 audience) passing
  `assertSafeEndpoint` (`https`, or `http` on `127.0.0.1`/`localhost` only; no credentials, query
  or fragment), a plain `clientId`, an optional integer `redirectPort` (`1024..65535`), and an
  optional printable `label` (no control or bidirectional formatting characters).

### Precedence (`flag > env > config default > built-in`)

| Rank | Source | Selection | Endpoint / client settings |
|---|---|---|---|
| **1 (highest)** | CLI flag | `--federation <name>` (or `--preprod` alias for `preprod` on `tools`) | Uses the `<name>` entry's declared `issuer`, `mcpUrl`, `clientId`, `redirectPort`, `label` (env overrides still apply to the built-in `preprod` entry when not declared in `config.json`) |
| **2** | Environment variables | `H2A_SENTROPIC_FEDERATION` (or `H2A_SENTROPIC_ENV`) | `H2A_SENTROPIC_ISSUER`, `H2A_SENTROPIC_MCP_URL`, `H2A_SENTROPIC_CLIENT_ID`, `H2A_SENTROPIC_REDIRECT_PORT` override the selected config/built-in entry |
| **3** | User config default | `sentropic.defaultFederation` in `config.json` | Uses the declared federation entry in `sentropic.federations` |
| **4 (lowest)** | Built-in default | `preprod` | `https://preprod.auth.sent-tech.ca` and `https://preprod.sentropic.sent-tech.ca/api/v1/mcp` |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `H2A_SENTROPIC_FEDERATION` (alias `H2A_SENTROPIC_ENV`) | `sentropic.defaultFederation` or `preprod` | Active federation name when `--federation` is not passed. |
| `H2A_SENTROPIC_ISSUER` | Federation entry's `issuer` (`https://preprod.auth.sent-tech.ca` for built-in `preprod`) | Authorization server issuer (RFC 8414 discovery). |
| `H2A_SENTROPIC_MCP_URL` | Federation entry's `mcpUrl` (`https://preprod.sentropic.sent-tech.ca/api/v1/mcp` for built-in `preprod`) | MCP endpoint, also the RFC 8707 `resource` (token audience). `tools` only accepts a declared federation's `mcpUrl` (or a loopback test server for built-in `preprod`). |
| `H2A_SENTROPIC_CLIENT_ID` | Federation entry's `clientId` (none on built-in `preprod`) | Public CLI client id registered on the AS (`h2a-cli`). Required for login/refresh. Not a secret. |
| `H2A_SENTROPIC_REDIRECT_PORT` | Federation entry's `redirectPort` (ephemeral by default) | Fixed loopback port (`1024..65535`). |
| `H2A_SENTROPIC_HOME` | `~/.sentropic` | Token store and bindings directory. |
| `H2A_SENTROPIC_CONFIG` | `~/.config/sentropic/h2a/config.json` | Explicit path to the user configuration file. |
| `H2A_NO_BROWSER=1` | — | Same as `--no-browser`. |

Endpoints must be `https` (plain `http` only on `127.0.0.1`/`localhost`). No secret is
configured: the client is public (`token_endpoint_auth_method=none`).

## Storage

- **Tokens**: the shared sentropic token store `~/.sentropic/h2a-auth.json`
  (`packages/h2a-runtime/src/sentropic/auth-token.ts`, PR #428: per-server namespace, 0600,
  atomic, fail-closed on a damaged file, writers serialized by an owner-checked lock with the
  merge re-checked under it, strict RFC 3339 expiry). The record
  keeps its shape (`server`, `issuer`, `accessToken`, `refreshToken?`, `expiresAt`, `subject`),
  keyed by the resource server origin, so several federations can stay logged in at once and
  `h2a sentropic status` lists them all. This client always writes `expiresAt`. Logout and
  refresh-token rotation use `removeAuth` / `updateAuth` (same locked path as `writeAuth`;
  compare-and-set on the refresh token):
  a pair another process already rotated is never overwritten, and an old refresh token is never
  kept.
- **Refresh lock**: `~/.sentropic/h2a-auth.json.refresh.lock` (O_EXCL, owner `pid:uuid`), held
  across the refresh HTTP calls so two h2a processes never present the same refresh token (the AS
  treats a second presentation as reuse and revokes the whole family). A waiter waits up to 45 s,
  then re-reads the store: the pair the holder rotated is used as is; otherwise it refuses without
  presenting anything. A lock older than 120 s was left by a dead process and is broken, one
  breaker at a time: the breaker holds `h2a-auth.json.refresh.lock.break` (O_EXCL) and checks the
  lock again under it before removing it, so two waiters that saw the same stale lock never both
  end up holding it. A `.break` older than 120 s was left by a breaker that died and is removed.
- **Bindings**: `~/.sentropic/h2a-bindings/<sha256(server, ws)>.json`, one 0600 file per
  (server, local workspace) in a 0700 directory. The local workspace is its durable git identity
  `ws:<sha256>` (same rule as track), and each binding records `federation` alongside `server`,
  `workspaceId`, `subject`, `tenantId`, and `boundAt`. The binding is a local routing choice; the
  resource server re-checks membership on every call.

## What the client checks

- Discovery is read for the client id (`/.well-known/oauth-authorization-server?client_id=…`):
  the AS advertises `offline_access` and the `refresh_token` grant per client. It must name the
  configured issuer exactly; authorization, token and revocation endpoints are https on the
  issuer's origin; `S256` is advertised.
- The loopback listener binds `127.0.0.1` only and serves exactly one callback on `/callback`
  for `Host: 127.0.0.1:<port>`; another path, another Host or an unparsable request target is a
  404 that consumes nothing. A request becomes the callback only once its `state` matches in
  constant time: a wrong state (a page guessing the port, a stale tab) is refused with a 400 and
  the login keeps waiting for the real one.
- On the callback: RFC 9207 `iss` (required when advertised), then `code` or `error` (reported
  by its code only).
- Token exchange with the same `redirect_uri`, the verifier and the `resource`.
- Scopes: `mcp:discover mcp:resources:read mcp:tools:invoke`, plus `offline_access` only when
  discovery for this client advertises it **and** the `refresh_token` grant. The sentropic MCP
  server checks `mcp:*` only and one token serves one audience: a future publish to immo needs a
  separate token minted for the immo audience.
- `openid` is not requested, so no id_token is expected. The account is the access token's
  `sub`, after a consistency check of its `iss`, `client_id`, `aud` (the resource) and `sub`
  (never an authorization decision: the resource server verifies the token). An id_token sent
  anyway is checked: `iss`, `aud`, `azp`, `exp`, `sub` and the login's `nonce` (signature not
  verified: OIDC Core §3.1.3.7, TLS to the token endpoint). PKCE S256, `state` and `iss` are the
  defenses of the code flow (RFC 9700 §2.1.1, §4.5.3).
- Refresh rotates the pair under the refresh lock, sends the `resource` again (the AS refuses
  one that is not the resource the grant was sealed with), and validates the refreshed access
  token's `iss`, `client_id`, `aud`, and `sub` (refusing if `sub` changed); a refused refresh
  (`invalid_grant`: revoked, expired, reuse detected) drops the dead pair and asks for a login.
- Anti-exfiltration: `tools` accepts only a declared federation's `mcpUrl` (or a loopback test
  server for built-in `preprod`), and `usableStoredToken` / `assertServerBound` refuse to send a
  token whose server, issuer, or JWT `aud` does not match the selected federation entry.
- The browser is opened without a shell: `rundll32.exe url.dll,FileProtocolHandler <url>` on
  Windows (from `%SystemRoot%\System32`), `open` on macOS, `xdg-open` elsewhere, the URL as one
  argument; only an https URL (http on loopback) is handed to an opener. `cmd /c start` is never
  used: cmd.exe reads the `&` of the query string as a command separator.
- Workspace names from the server are printed without control or bidirectional formatting
  characters.
- No output line or error ever carries a code, verifier, token, response body or
  `error_description` (sentinel test).

## What the sentropic authorization server registers

The public client for the h2a CLI, preprod (sentropic `api/src/scripts/oauth-register-client.ts`,
preset `h2a-cli`):

| Field | Value |
|---|---|
| `client_id` | `h2a-cli` (then `H2A_SENTROPIC_CLIENT_ID=h2a-cli` or `clientId` in `config.json`) |
| `token_endpoint_auth_method` | `none` |
| redirect URIs | `http://127.0.0.1/callback`, port-less: any loopback port is accepted (RFC 8252 §7.3) |
| allowed scopes | `mcp:discover mcp:resources:read mcp:tools:invoke immo:artifacts:read immo:artifacts:write offline_access` (this client asks for the three `mcp:*` scopes, plus `offline_access`) |
| resource indicators | `https://preprod.sentropic.sent-tech.ca/api/v1/mcp` |
| grant types | `authorization_code`, `refresh_token` (rotation) |
| DPoP | not bound (the CLI sends Bearer tokens) |
| tool allowlist | not in the read-only client set (publishing needs the write tools) |

The token must carry `tid`: an account in several organizations signs in with
`--tenant <id>`.
