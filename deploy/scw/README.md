# h2a hosted MCP — Scaleway Kapsule Runbook (EVO-12)

Hosts the **read-only** h2a MCP surface over HTTP with a self-contained OAuth
authorization server (the mcp-wave "self-AS" pattern), so it can be enrolled as
a remote MCP connector on **claude.ai / claude.com**.

The container image is **built and pushed to GHCR by CI**
(`.github/workflows/docker.yml`, on every `vX.Y.Z` tag) as
`ghcr.io/rhanka/h2a-cli:<version>` and `:latest`. This runbook only pulls that
image and runs the hosted MCP entrypoint from it — there is no local build step.

For a scripted one-command deploy, run `deploy/scw/deploy.sh`: it applies the
ConfigMap/Secret and manifests, waits for rollout, then runs the smoke checks.
The manual steps below are the equivalent it automates.

> **DEC-116 invariant.** The hosted surface is structurally read-only: the
> allowlist (`runtime/mcp-http/readonly-allowlist.ts`) throws at startup if any
> exposed tool takes a `privateKeyPem`. No ed25519 private key is ever written
> to the PVC or sent over the wire. 39-auth OIDC federation comes later (swap
> the self-AS for 39-auth Ed25519 JWT validation); for now the server is its own
> single-tenant AS gated by an operator consent secret.

## Inputs

- Kapsule cluster context selected in `kubectl`.
- Namespace `h2a-mcp` with a `h2a-mcp` service account (default-deny netpol,
  quota/limitrange per the cluster contract).
- DNS host (`h2a-mcp.sent-tech.ca`) pointed at the Traefik ingress; cert-manager
  `letsencrypt-prod` ClusterIssuer present (DNS-01 on sent-tech.ca).
- If the `ghcr.io/rhanka/h2a-cli` package is **private**, an image-pull secret:

  ```bash
  kubectl -n h2a-mcp create secret docker-registry ghcr-pull \
    --docker-server=ghcr.io \
    --docker-username=<gh-user> \
    --docker-password=<PAT with read:packages>
  ```

  (Or make the GHCR package public, in which case drop the `imagePullSecrets`
  block from `deployment.yaml`.)

## Image

No build here. CI publishes the multi-arch image on tag push. Pick the version:

```bash
export IMAGE="ghcr.io/rhanka/h2a-cli:0.25.0"   # or :latest
```

The image ENTRYPOINT is the `h2a` CLI; the Deployment overrides `command` to
launch the hosted MCP HTTP server:
`node /opt/h2a/packages/h2a-cli/dist/runtime/mcp-http/main.js`.

## Runtime Config

```bash
export H2A_MCP_HOST="h2a-mcp.sent-tech.ca"
kubectl -n h2a-mcp create configmap h2a-mcp-config \
  --from-literal=NODE_ENV=production \
  --from-literal=PORT=8787 \
  --from-literal=PUBLIC_BASE_URL="https://${H2A_MCP_HOST}" \
  --from-literal=OAUTH_ISSUER_URL="https://${H2A_MCP_HOST}" \
  --from-literal=OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback \
  --from-literal=OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600 \
  --from-literal=OAUTH_REFRESH_TOKEN_TTL_SECONDS=1209600 \
  --from-literal=OAUTH_AUTH_CODE_TTL_SECONDS=60 \
  --from-literal=OAUTH_STORE_PATH=/var/lib/h2a/oauth-clients.json \
  --from-literal=H2A_ROOT=/var/lib/h2a/root \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n h2a-mcp create secret generic h2a-mcp-secret \
  --from-literal=OAUTH_CONSENT_SECRET="${OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Deploy

```bash
cp -R deploy/scw /tmp/h2a-mcp-scw
cd /tmp/h2a-mcp-scw
kustomize edit set image "ghcr.io/rhanka/h2a-cli=${IMAGE}"
kubectl apply -k .
kubectl -n h2a-mcp rollout status deployment/h2a-mcp
```

## Smoke Checks

```bash
curl -fsS "https://${H2A_MCP_HOST}/healthz"   # {"ok":true}
curl -fsS "https://${H2A_MCP_HOST}/readyz"    # {"ok":true}
curl -fsS "https://${H2A_MCP_HOST}/.well-known/oauth-authorization-server"
curl -fsS "https://${H2A_MCP_HOST}/.well-known/oauth-protected-resource/mcp"
```

`/mcp` without a token must return 401:

```bash
curl -i "https://${H2A_MCP_HOST}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

## Enroll on claude.ai

1. claude.ai → Settings → Connectors → **Add custom connector**.
2. URL: `https://h2a-mcp.sent-tech.ca/mcp`.
3. claude.ai performs Dynamic Client Registration + the OAuth PKCE flow. On the
   `/authorize` consent page, supply the operator `OAUTH_CONSENT_SECRET`.
4. Once connected, only the read-only tools are listed (discover instances /
   sessions, NHI inventory/report, conflict posture, blockage list).

## Rollback

```bash
kubectl -n h2a-mcp rollout undo deployment/h2a-mcp
kubectl -n h2a-mcp rollout status deployment/h2a-mcp
```

## Secret Rotation

```bash
kubectl -n h2a-mcp create secret generic h2a-mcp-secret \
  --from-literal=OAUTH_CONSENT_SECRET="${NEW_OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n h2a-mcp rollout restart deployment/h2a-mcp
```

## OAuth Token Revocation

```bash
curl -fsS -X POST "https://${H2A_MCP_HOST}/revoke" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=${OAUTH_CLIENT_ID}" \
  --data-urlencode "token=${OAUTH_TOKEN}"
```
