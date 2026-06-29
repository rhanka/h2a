#!/usr/bin/env bash
# Garde du contrat public h2a (migration P2): la surface live doit == golden gelé.
# Tout drift (ajout/retrait/rename d'outil MCP ou de verbe CLI) => exit 1.
# Usage: scripts/check-public-contract.sh   (CI gate ; bump golden = décision contrat)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLD="$ROOT/docs/contracts/golden"
rc=0

# 1) surface MCP du bus
if command -v h2a >/dev/null 2>&1; then
  live_mcp="$(h2a mcp-tools 2>/dev/null | python3 -c 'import sys,json;print(json.dumps(sorted(json.load(sys.stdin)),indent=2))' 2>/dev/null)"
  if ! diff <(printf '%s\n' "$live_mcp") "$GOLD/mcp-tools.json" >/tmp/_mcp.diff 2>&1; then
    echo "✗ DRIFT surface MCP (bus) vs golden :"; cat /tmp/_mcp.diff; rc=1
  else echo "✓ surface MCP inchangée ($(python3 -c "import json;print(len(json.load(open('$GOLD/mcp-tools.json'))))") outils)"; fi
else echo "… h2a absent du PATH, skip MCP"; fi

# 2) verbes CLI
DIST="$ROOT/packages/h2a-cli/dist/cli-contract.js"
if [ -f "$DIST" ]; then
  live_cli="$(node -e "const m=require('$DIST');console.log(JSON.stringify((m.H2A_CLI_VERB_CONTRACTS||[]).map(x=>x.verb).sort(),null,2))" 2>/dev/null)"
  if ! diff <(printf '%s\n' "$live_cli") "$GOLD/cli-verbs.json" >/tmp/_cli.diff 2>&1; then
    echo "✗ DRIFT verbes CLI vs golden :"; cat /tmp/_cli.diff; rc=1
  else echo "✓ verbes CLI inchangés ($(python3 -c "import json;print(len(json.load(open('$GOLD/cli-verbs.json'))))") verbes)"; fi
else echo "… dist absent (npm run build), skip verbes CLI"; fi

# 3) ANTI-CYCLE (piège n°1): le core @sentropic/h2a doit rester une FEUILLE
CORE="$ROOT/packages/h2a/package.json"
if [ -f "$CORE" ]; then
  bad="$(python3 -c "import json;d=json.load(open('$CORE'));dd={**d.get('dependencies',{}),**d.get('devDependencies',{})};print(','.join(k for k in dd if any(s in k for s in ('h2a-cli','runtime','remote'))))" 2>/dev/null)"
  if [ -n "$bad" ]; then echo "✗ CYCLE: le core @sentropic/h2a dépend de [$bad] (doit être feuille)"; rc=1
  else echo "✓ core @sentropic/h2a = feuille (anti-cycle)"; fi
else echo "… core package.json absent, skip anti-cycle"; fi

[ $rc -eq 0 ] && echo "CONTRAT PUBLIC OK" || echo "CONTRAT PUBLIC: DRIFT — revue + bump golden requis"
exit $rc
