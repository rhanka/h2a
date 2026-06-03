# Runbook — deploying the h2a-mcp gateway broker (mode 3, multi-tenant)

Status: **the broker is code-complete (0.39.0)**. This runbook is the live path
to turn it on. Two of the steps are **sentropic/39-auth-side** (not h2a code).
Until step 1 is done, keep `H2A_BROKER_MODE=false` (single-tenant, unchanged).

## What "broker mode" does

`/authorize` no longer asks for the operator consent secret — it 302-redirects
the user to **39-auth** (OIDC authorization_code + PKCE). On callback the gateway
exchanges the code for the user's `sub`, mints the claude.ai authorization code
**bound to that sub**, and the `sub` rides code → token. `/mcp` then derives
`root = H2A_ROOT/tenants/<sub>` and serves **that user's** h2a dispatch (read-only
surface), cached per root. A session is pinned to the tenant that opened it.

Self-AS DCR for claude.ai stays in the gateway (39-auth has no DCR); only the
**user login** is delegated. claude.ai → gateway → 39-auth is the only added hop.

## Step 1 (sentropic / 39-auth) — seed the gateway client  ⟵ BLOCKING

39-auth has no DCR, so the `h2a-gateway` client must be **seeded** (Drizzle), like
any other 39-auth OAuth client:

- `client_id`: `h2a-gateway`
- `client_secret`: a fresh secret (store the same value in the k8s Secret, step 3)
- `redirect_uris`: `https://h2a-mcp.sent-tech.ca/oidc/callback`
- grant: `authorization_code`; PKCE S256; scope: `openid` (required for `sub`)

Note: 39-auth does not emit `tenant_id` and does not expose a public
`/.well-known/openid-configuration` (BR-39 facts). The gateway therefore uses the
explicit `H2A_UPSTREAM_AUTHORIZE_URL` / `H2A_UPSTREAM_TOKEN_URL` (no discovery) and
keys tenancy on `sub` alone — which is all `rootForSub` needs.

## Step 2 (h2a) — configure the deploy

`deploy/scw/configmap.example.yaml` already carries the broker block (defaults off):

```
H2A_BROKER_MODE: "true"                  # flip on
H2A_UPSTREAM_ISSUER: https://sentropic.sent-tech.ca
H2A_UPSTREAM_AUTHORIZE_URL: https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize
H2A_UPSTREAM_TOKEN_URL: https://sentropic.sent-tech.ca/api/v1/auth/oauth/token
H2A_UPSTREAM_CLIENT_ID: h2a-gateway
H2A_UPSTREAM_REDIRECT_URI: https://h2a-mcp.sent-tech.ca/oidc/callback
H2A_UPSTREAM_SCOPES: openid
```

`oauthConfigFromEnv` **throws on boot** if `H2A_BROKER_MODE=true` and any
`H2A_UPSTREAM_*` field is missing — a missing value fails fast, it never silently
falls back to single-tenant.

## Step 3 (h2a) — the client secret

Put the step-1 secret in `deploy/scw/secret.example.yaml` → `h2a-mcp-secret`:

```
H2A_UPSTREAM_CLIENT_SECRET: <the seeded h2a-gateway secret>
```

The Deployment already `envFrom`s `h2a-mcp-config` + `h2a-mcp-secret`, so no
Deployment change is needed. DEC-116 invariant holds: this is an OAuth client
secret, **not** an h2a ed25519 private key — none of those ever touch the PVC/wire.

## Step 4 (h2a) — roll out

```
kubectl --kubeconfig /tmp/poc.kubeconfig -n h2a-mcp apply -f deploy/scw/configmap.example.yaml
kubectl --kubeconfig /tmp/poc.kubeconfig -n h2a-mcp apply -f deploy/scw/secret.example.yaml
kubectl --kubeconfig /tmp/poc.kubeconfig -n h2a-mcp set image deploy/h2a-mcp \
  h2a-mcp=rg.fr-par.scw.cloud/h2a-mcp/h2a-cli:0.39.0   # or rollout restart if tag-pinned
kubectl --kubeconfig /tmp/poc.kubeconfig -n h2a-mcp rollout status deploy/h2a-mcp
```

CHECKPOINT before apply (the PVC uses `strategy: Recreate`; a bad config means a
brief MCP outage, not data loss). The per-tenant roots live under the existing PVC
at `H2A_ROOT/tenants/`, so no new RWX/PVC is needed (RWX is saturated anyway —
matchid-rwx node pool at max-volume-count).

## Step 5 — connect claude.ai

Add the connector at `https://h2a-mcp.sent-tech.ca/mcp`. claude.ai DCRs against the
gateway (self-AS), then the login redirects to **39-auth**; after sign-in, claude.ai
sees that user's read-only h2a agents. Each user gets `tenants/<their sub>`.

## Verify

```
curl -s https://h2a-mcp.sent-tech.ca/.well-known/oauth-authorization-server | jq .
# /authorize?... should 302 to sentropic.sent-tech.ca/api/v1/auth/oauth/authorize
curl -sI "https://h2a-mcp.sent-tech.ca/authorize?client_id=...&redirect_uri=...&state=x"
```

## Rollback

Set `H2A_BROKER_MODE: "false"` + re-apply + `rollout restart` → back to single-tenant
(consent-secret) instantly. Tenant roots under `tenants/` are left intact for a
later re-enable.
