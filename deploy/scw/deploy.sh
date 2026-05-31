#!/usr/bin/env bash
# One-command Kapsule deploy for the h2a hosted MCP (EVO-12). Mirrors
# deploy/scw/README.md. The container image is built and pushed to GHCR by
# .github/workflows/docker.yml on every vX.Y.Z tag — this script does NOT build;
# it pulls ghcr.io/rhanka/h2a-cli and runs the hosted MCP HTTP server from it.
#
# Prereqs (see README "Inputs"): kubectl context on the Kapsule cluster, the
# `h2a-mcp` namespace + service account created, a `ghcr-pull` image-pull secret
# if the GHCR package is private, and DNS for ${H2A_MCP_HOST} pointed at the
# Traefik ingress.
set -euo pipefail

# --- Required environment ---------------------------------------------------
: "${H2A_MCP_HOST:?set H2A_MCP_HOST, e.g. h2a-mcp.sent-tech.ca}"
: "${OAUTH_CONSENT_SECRET:?set OAUTH_CONSENT_SECRET (operator-chosen)}"

# --- Optional (defaults) ----------------------------------------------------
NAMESPACE="${NAMESPACE:-h2a-mcp}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/rhanka/h2a-cli}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="${IMAGE:-${IMAGE_REPO}:${IMAGE_TAG}}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Image:     ${IMAGE}"
echo "==> Namespace: ${NAMESPACE}"
echo "==> Host:      ${H2A_MCP_HOST}"

# --- Runtime config (non-secret) --------------------------------------------
echo "==> Applying ConfigMap"
kubectl -n "${NAMESPACE}" create configmap h2a-mcp-config \
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

echo "==> Applying Secret"
kubectl -n "${NAMESPACE}" create secret generic h2a-mcp-secret \
  --from-literal=OAUTH_CONSENT_SECRET="${OAUTH_CONSENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- Deploy via kustomize (kubectl's built-in; no standalone `kustomize` needed) ---
echo "==> Applying manifests"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
cp -R "${REPO_ROOT}/deploy/scw/." "${WORK}/"
sed -i "s|newName: ghcr.io/rhanka/h2a-cli|newName: ${IMAGE%:*}|; s|newTag: latest|newTag: ${IMAGE##*:}|" "${WORK}/kustomization.yaml"
kubectl apply -k "${WORK}"
kubectl -n "${NAMESPACE}" rollout status deployment/h2a-mcp --timeout=180s

# --- Smoke ------------------------------------------------------------------
echo "==> Smoke checks against https://${H2A_MCP_HOST}"
curl -fsS "https://${H2A_MCP_HOST}/healthz" && echo
curl -fsS "https://${H2A_MCP_HOST}/readyz" && echo
curl -fsS "https://${H2A_MCP_HOST}/.well-known/oauth-authorization-server" >/dev/null && echo "AS metadata OK"
curl -fsS "https://${H2A_MCP_HOST}/.well-known/oauth-protected-resource/mcp" >/dev/null && echo "PRM OK"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://${H2A_MCP_HOST}/mcp" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')"
[ "${code}" = "401" ] && echo "unauth /mcp -> 401 OK" || { echo "expected 401 from /mcp, got ${code}"; exit 1; }

echo "==> Deploy complete: ${IMAGE}"
echo "==> claude.ai connector URL: https://${H2A_MCP_HOST}/mcp"
