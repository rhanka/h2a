#!/usr/bin/env bash
# Launch one durable h2a actor in the current tab, AND make it read its memory.
#
# Two defects this script exists to NOT have, both found by review of PR 90:
#  - it must resolve its OWN repo, not a hard-coded path: a hard-coded path breaks
#    on a fresh clone and, from a worktree, silently launches the wrong checkout.
#  - it must DELIVER the wake instruction, not merely print paths: a launcher that
#    only echoes file names launches an actor with no memory — the exact failure
#    the wake-recall dossier exists to cure. The instruction is piped in via
#    `--prompt-stdin`, so the actor's first turn is to read COMMON.md, its brief,
#    and RECALL.md.
#
# --no-gw is deliberate, not a preference: a claude session routed through the
# local gateway dies on `API Error: 400 unsupported model: claude-opus-5`.
# The cause is a MISSING ALIAS for the current Claude family, not the nature of
# the gateway. Repairable, owned by the gateway lane. See docs/agents/RECALL.md REF-03.
set -euo pipefail

agent="${1:?agent name required}"

# Resolve the repo from THIS script's location (docs/agents/launch.sh → repo root
# is two levels up), never a hard-coded path.
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$script_dir/../.." && pwd)
cd "$repo"

brief="docs/agents/BRIEF-$agent.md"
if [ ! -f "$brief" ]; then
  echo "no brief at $brief" >&2
  echo "durable actors: agents architect conductor coop cyber gateway harness memory plugins portal runtime track" >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════════"
echo "  ACTEUR : $agent"
echo "  repo   : $repo"
echo "  commun : docs/agents/COMMON.md"
echo "  brief  : $brief"
echo "  rappel : docs/agents/RECALL.md   (doctrine tranchée / réfuté / récurrent)"
echo "  gateway: OFF (aucun alias pour la famille Claude courante)"
echo "════════════════════════════════════════════════════════════"
echo

# The wake instruction is DELIVERED, not printed. This is the whole point of the
# dossier: the actor cannot start blank.
wake_prompt="Tu es l'acteur durable h2a « $agent ». Avant TOUTE autre action, dans cet ordre :
1. Lis docs/agents/COMMON.md — les règles de travail de l'owner.
2. Lis docs/agents/BRIEF-$agent.md — ton périmètre.
3. Lis docs/agents/RECALL.md — ce qui a déjà été tranché, réfuté, ou payé deux fois ; sa règle de lecture 8 (« demande ce qui refuse ») est celle qui te coûtera le plus cher si tu l'ignores.
Si tu délègues à un sous-traitant, docs/agents/DELEGATION.md porte le préambule à coller en tête de son prompt.
Ne commence rien avant d'avoir lu ces trois fichiers."

printf '%s\n' "$wake_prompt" | h2a run claude "$repo" --name "$agent" --no-gw --prompt-stdin
