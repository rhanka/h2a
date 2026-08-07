#!/usr/bin/env bash
# dev-test-local.sh — boucle de test locale sans npm publish
# 
# Chaîne: h2a global → h2a-runtime local → @sentropic/llm-mesh local
#
# Usage:
#   ./scripts/dev-test-local.sh           # rebuild + test smoke
#   ./scripts/dev-test-local.sh enroll    # rebuild + lancer enroll cloud-code
#   ./scripts/dev-test-local.sh reset     # désactiver les liens (revenir à npm)

set -e

H2A_RUNTIME=/home/antoinefa/src/h2a/packages/h2a-runtime
SENTROPIC_LLM_MESH=/home/antoinefa/src/sentropic/packages/llm-mesh
H2A_GLOBAL=/home/antoinefa/.npm-global/lib/node_modules/@sentropic/h2a

ensure_links() {
  echo "[dev-test] Vérification des liens locaux..."

  # 1. h2a global → h2a-runtime local
  if [ ! -L "$H2A_GLOBAL/node_modules/@sentropic/h2a-runtime" ]; then
    echo "[dev-test] Linking h2a-runtime..."
    cd "$H2A_RUNTIME" && npm link
    cd "$H2A_GLOBAL" && npm link @sentropic/h2a-runtime
  fi

  # 2. h2a-runtime → llm-mesh local
  if [ ! -L "$H2A_RUNTIME/node_modules/@sentropic/llm-mesh" ]; then
    echo "[dev-test] Symlinking llm-mesh..."
    rm -rf "$H2A_RUNTIME/node_modules/@sentropic/llm-mesh"
    ln -s "$SENTROPIC_LLM_MESH" "$H2A_RUNTIME/node_modules/@sentropic/llm-mesh"
  fi

  echo "[dev-test] ✅ Liens OK"
}

rebuild() {
  echo "[dev-test] Build sentropic/llm-mesh..."
  npx tsc -b "$SENTROPIC_LLM_MESH/tsconfig.json" 2>&1 | tail -3

  echo "[dev-test] Build h2a-runtime..."
  cd /home/antoinefa/src/h2a && npm run build:h2a 2>&1 | tail -3

  echo "[dev-test] ✅ Build OK"
}

case "${1:-smoke}" in
  reset)
    echo "[dev-test] Restauration npm publish..."
    rm -f "$H2A_GLOBAL/node_modules/@sentropic/h2a-runtime"
    rm -f "$H2A_RUNTIME/node_modules/@sentropic/llm-mesh"
    cd "$H2A_GLOBAL" && npm install
    cd "$H2A_RUNTIME" && npm install
    echo "[dev-test] ✅ Reset OK — relancer h2a upgrade pour revenir à la version publiée"
    ;;
  enroll)
    ensure_links
    rebuild
    echo "[dev-test] Lancement enroll cloud-code..."
    h2a llm-mesh enroll cloud-code
    ;;
  smoke)
    ensure_links
    rebuild
    echo "[dev-test] Smoke test..."
    node -e "require('$H2A_RUNTIME/dist/llm-gateway-runtime/proxy-cloud-code.js'); console.log('proxy-cloud-code OK')"
    npx vitest run \
      "$H2A_RUNTIME/src/llm-gateway-runtime/proxy-cloud-code.test.ts" \
      --reporter=verbose 2>&1 | tail -10
    echo "[dev-test] ✅ Smoke OK"
    ;;
esac
