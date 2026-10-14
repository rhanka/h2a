#!/usr/bin/env bash
# Garde du contrat public h2a (migration P2): la surface live doit == golden gelé.
# Tout drift (ajout/retrait/rename d'outil MCP ou de verbe CLI) => exit 1.
# Usage: scripts/check-public-contract.sh   (CI gate ; bump golden = décision contrat)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLD="$ROOT/docs/contracts/golden"
rc=0
# Always qualify this checkout's build, never an installed h2a fallback.
H2A_BIN="$ROOT/packages/h2a/dist/bin.js"
if [ ! -f "$H2A_BIN" ]; then echo "✗ build local absent (npm run build)"; exit 1; fi
contract_temp="$(mktemp -d)"
trap 'rm -rf "$contract_temp"' EXIT
export HOME="$contract_temp/home" XDG_RUNTIME_DIR="$contract_temp/run"
export XDG_CONFIG_HOME="$contract_temp/config" XDG_STATE_HOME="$contract_temp/state"
export H2A_ROOT="$contract_temp/store"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME"

# 1) surface MCP du bus
if node "$H2A_BIN" mcp-tools >/dev/null 2>&1; then
  live_mcp="$(node "$H2A_BIN" mcp-tools 2>/dev/null | node -e 'console.log(JSON.stringify(JSON.parse(require("node:fs").readFileSync(0,"utf8")).sort(),null,2))')"
  if ! diff <(printf '%s\n' "$live_mcp") "$GOLD/mcp-tools.json" >"$contract_temp/mcp.diff" 2>&1; then
    echo "✗ DRIFT surface MCP (bus) vs golden :"; cat "$contract_temp/mcp.diff"; rc=1
  else echo "✓ surface MCP inchangée ($(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).length)' "$GOLD/mcp-tools.json") outils)"; fi
else echo "✗ interrogation MCP du build local échouée"; rc=1; fi

# 2) verbes CLI (source de vérité: le core @sentropic/h2a ; h2a-cli n'est qu'un
# ré-export déprécié sans cli-contract.js propre)
DIST="$ROOT/packages/h2a/dist/cli-contract.js"
if [ -f "$DIST" ]; then
  live_cli="$(node -e "const m=require('$DIST');console.log(JSON.stringify((m.H2A_CLI_VERB_CONTRACTS||[]).map(x=>x.verb).sort(),null,2))" 2>/dev/null)"
  if ! diff <(printf '%s\n' "$live_cli") "$GOLD/cli-verbs.json" >"$contract_temp/cli.diff" 2>&1; then
    echo "✗ DRIFT verbes CLI vs golden :"; cat "$contract_temp/cli.diff"; rc=1
  else echo "✓ verbes CLI inchangés ($(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).length)' "$GOLD/cli-verbs.json") verbes)"; fi
else echo "✗ dist absent (npm run build)"; rc=1; fi

# 3) ANTI-CYCLE (piège n°1): le core @sentropic/h2a doit rester une FEUILLE
CORE="$ROOT/packages/h2a/package.json"
if [ -f "$CORE" ]; then
  bad="$(node -e 'const d=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));console.log(Object.keys({...d.dependencies,...d.devDependencies}).filter(k=>["h2a-cli","runtime","remote"].some(s=>k.includes(s))).join(","))' "$CORE")" || exit 1
  if [ -n "$bad" ]; then echo "✗ CYCLE: le core @sentropic/h2a dépend de [$bad] (doit être feuille)"; rc=1
  else echo "✓ core @sentropic/h2a = feuille (anti-cycle)"; fi
else echo "✗ core package.json absent"; rc=1; fi

[ $rc -eq 0 ] && echo "CONTRAT PUBLIC OK" || echo "CONTRAT PUBLIC: DRIFT — revue + bump golden requis"
exit $rc
