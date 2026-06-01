#!/usr/bin/env bash
# One-command Kapsule deploy for the h2a hosted MCP (EVO-12). Mirrors
# deploy/scw/README.md and the mcp-wave convention: build the image, push it to
# the Scaleway Container Registry namespace `h2a-mcp` (public, so the Kapsule
# pulls without a secret), apply ConfigMap/Secret + manifests, then smoke-test.
#
# Prereqs (see README "Inputs"): kubectl context on the Kapsule `poc` cluster
# (`scw k8s kubeconfig get <id>`), the `h2a-mcp` namespace + service account
# created from poc-k8s/tenants/h2a-mcp/00-namespace.yaml, docker logged in to
# rg.fr-par.scw.cloud, and DNS for ${H2A_MCP_HOST} -> 51.159.11.157.
set -euo pipefail

# --- Required environment ---------------------------------------------------
: "${H2A_MCP_HOST:?set H2A_MCP_HOST, e.g. h2a-mcp.sent-tech.ca}"
: "${OAUTH_CONSENT_SECRET:?set OAUTH_CONSENT_SECRET (operator-chosen)}"

# --- Optional (defaults) ----------------------------------------------------
NAMESPACE="${NAMESPACE:-h2a-mcp}"
REGISTRY="${REGISTRY:-rg.fr-par.scw.cloud/h2a-mcp}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
IMAGE="${IMAGE:-${REGISTRY}/h2a-cli:${IMAGE_TAG}}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Image:     ${IMAGE}"
echo "==> Namespace: ${NAMESPACE}"
echo "==> Host:      ${H2A_MCP_HOST}"

# --- Build & push -----------------------------------------------------------
echo "==> Building + pushing image to the SCW registry"
docker build -t "${IMAGE}" "${REPO_ROOT}"
docker push "${IMAGE}"

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
sed -i "s|newName: rg.fr-par.scw.cloud/h2a-mcp/h2a-cli|newName: ${IMAGE%:*}|; s|newTag: latest|newTag: ${IMAGE##*:}|" "${WORK}/kustomization.yaml"
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
