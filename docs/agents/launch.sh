#!/usr/bin/env bash
# Launch one durable h2a actor in the current tab.
# Kept as a script so the calling shell never carries the CLI verb in its argv.
#
# --no-gw is deliberate, not a preference: a claude session routed through the
# local gateway dies on `API Error: 400 unsupported model: claude-opus-5`.
# The cause is a MISSING ALIAS for the current Claude family, not the nature of
# the gateway — `GET localhost:3002/v1/models` returned 5 ids and no claude
# alias on 2026-07-29. Repairable, and owned by the gateway lane. See
# docs/agents/RECALL.md REF-03.
set -u
agent="${1:?agent name required}"
repo=/home/antoinefa/src/h2a
cd "$repo" || exit 1

brief="docs/agents/BRIEF-$agent.md"
if [ ! -f "$brief" ]; then
  echo "no brief at $brief" >&2
  echo "durable actors: agents architect conductor coop cyber gateway harness memory plugins portal runtime track" >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════════"
echo "  ACTEUR : $agent"
echo "  commun : docs/agents/COMMON.md"
echo "  brief  : $brief"
echo "  rappel : docs/agents/RECALL.md   (doctrine tranchée / réfuté / récurrent)"
echo "  déléguer : docs/agents/DELEGATION.md   (préambule sous-traitant)"
echo "  gateway: OFF (aucun alias pour la famille Claude courante)"
echo "════════════════════════════════════════════════════════════"
echo

exec h2a run claude "$repo" --name "$agent" --no-gw
