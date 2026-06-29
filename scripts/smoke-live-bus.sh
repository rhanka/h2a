#!/usr/bin/env bash
# Smoke live-bus (migration P2): gate read-only à passer avant chaque release.
# N'écrit RIEN sur le bus (pas de pollution): vérifie joignabilité + intégrité + surface.
# Exit 1 si le bus est cassé.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rc=0
need() { command -v h2a >/dev/null 2>&1 || { echo "✗ h2a absent du PATH"; exit 2; }; }
need

# 1) store sain (doctor hard checks => exit 2 si KO)
if h2a doctor >/tmp/_doc.json 2>&1 && python3 -c "import json;d=json.load(open('/tmp/_doc.json'));ok=all(c.get('ok') for c in d.get('checks',{}).values());exit(0 if ok else 1)" 2>/dev/null; then
  n=$(python3 -c "import json;print(json.load(open('/tmp/_doc.json'))['checks']['liveSessions']['count'])" 2>/dev/null)
  echo "✓ doctor OK (live sessions: ${n:-?})"
else echo "✗ doctor: hard check KO"; rc=1; fi

# 2) surface MCP intacte (== golden)
if diff <(h2a mcp-tools 2>/dev/null | python3 -c 'import sys,json;print(json.dumps(sorted(json.load(sys.stdin)),indent=2))') "$ROOT/docs/contracts/golden/mcp-tools.json" >/dev/null 2>&1; then
  echo "✓ surface MCP == golden (29)"
else echo "✗ surface MCP != golden"; rc=1; fi

# 3) discover répond (lecture)
if h2a discover >/dev/null 2>&1; then echo "✓ discover répond"; else echo "✗ discover KO"; rc=1; fi

[ $rc -eq 0 ] && echo "SMOKE LIVE-BUS OK" || echo "SMOKE LIVE-BUS: ÉCHEC — ne pas release"
exit $rc
