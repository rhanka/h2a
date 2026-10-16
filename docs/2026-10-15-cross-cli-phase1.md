# Qualification live cross-CLI — phase 1

| Émetteur → destinataire | claude | codex | agy | gemini | muse | vibe |
|---|---|---|---|---|---|---|
| claude | [blocked](#claude-claude) | [measured-KO](#claude-codex) | [blocked](#claude-agy) | [blocked](#claude-gemini) | [blocked](#claude-muse) | [blocked](#claude-vibe) |
| codex | [blocked](#codex-claude) | [measured-KO](#codex-codex) | [blocked](#codex-agy) | [blocked](#codex-gemini) | [blocked](#codex-muse) | [blocked](#codex-vibe) |
| agy | [blocked](#agy-claude) | [measured-KO](#agy-codex) | [blocked](#agy-agy) | [blocked](#agy-gemini) | [blocked](#agy-muse) | [blocked](#agy-vibe) |
| gemini | [blocked](#gemini-claude) | [measured-KO](#gemini-codex) | [blocked](#gemini-agy) | [blocked](#gemini-gemini) | [blocked](#gemini-muse) | [blocked](#gemini-vibe) |
| muse | [blocked](#muse-claude) | [measured-KO](#muse-codex) | [blocked](#muse-agy) | [blocked](#muse-gemini) | [blocked](#muse-muse) | [blocked](#muse-vibe) |
| vibe | [blocked](#vibe-claude) | [blocked](#vibe-codex) | [blocked](#vibe-agy) | [blocked](#vibe-gemini) | [blocked](#vibe-muse) | [blocked](#vibe-vibe) |

Commande : `node scripts/qualify-cross-cli.mjs --timeout-ms 30000 --auth-home /home/antoinefa --output docs/2026-10-15-cross-cli-phase1.json --markdown docs/2026-10-15-cross-cli-phase1.md`

Base : `54e7ffd7859f84fdaa04db94975e292e1af63330` ; Node : `v22.22.1` ; mode : **CLI réelles**.

M = MCP initialize + outils ; D = enveloppe durable ; R = lecture inbox par la CLI ; W = réaction après barrière inactive, sans entrée du harness ; A = réponse signée livrée au sender.

Les cellules bloquées ne prouvent aucune fonctionnalité. Les tests MCP simulés ne qualifient pas les CLI réelles.

Isolation : sources compilées dans mkdtemp ; HOME/XDG/store/socket/registre privés par cellule ; aucun host existant. Garde produit `H2A_UPGRADE_REEXECED=1` ; shim h2a vers les sources. Seuls les fichiers d’auth explicitement listés sont copiés, puis effacés avec les états des CLI. Aucun texte de modèle ni secret dans les preuves.

Écart : un point d’entrée Python est bloqué, conformément à l’interdiction du propriétaire. Les écrans de démarrage reconnus sont validés normalement dans le workspace vide temporaire ; aucune désactivation de permission ni modification persistante du trust.

| Émetteur | Destinataire | Statut | M émetteur / récepteur | D | R | W | A | Motif | Preuve |
|---|---|---|---|---|---|---|---|---|---|
| claude | claude | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#claude-claude) |
| claude | codex | measured-KO | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | mcp-not-loaded-before-deadline | [JSON](2026-10-15-cross-cli-phase1.json#claude-codex) |
| claude | agy | blocked | non mesuré / oui | non mesuré | non mesuré | non mesuré | non mesuré | initial-model-tool-turn-not-observed | [JSON](2026-10-15-cross-cli-phase1.json#claude-agy) |
| claude | gemini | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | authentication-required | [JSON](2026-10-15-cross-cli-phase1.json#claude-gemini) |
| claude | muse | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#claude-muse) |
| claude | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#claude-vibe) |
| codex | claude | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#codex-claude) |
| codex | codex | measured-KO | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | mcp-not-loaded-before-deadline | [JSON](2026-10-15-cross-cli-phase1.json#codex-codex) |
| codex | agy | blocked | non mesuré / oui | non mesuré | non mesuré | non mesuré | non mesuré | initial-model-tool-turn-not-observed | [JSON](2026-10-15-cross-cli-phase1.json#codex-agy) |
| codex | gemini | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | authentication-required | [JSON](2026-10-15-cross-cli-phase1.json#codex-gemini) |
| codex | muse | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#codex-muse) |
| codex | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#codex-vibe) |
| agy | claude | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#agy-claude) |
| agy | codex | measured-KO | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | mcp-not-loaded-before-deadline | [JSON](2026-10-15-cross-cli-phase1.json#agy-codex) |
| agy | agy | blocked | non mesuré / oui | non mesuré | non mesuré | non mesuré | non mesuré | initial-model-tool-turn-not-observed | [JSON](2026-10-15-cross-cli-phase1.json#agy-agy) |
| agy | gemini | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | authentication-required | [JSON](2026-10-15-cross-cli-phase1.json#agy-gemini) |
| agy | muse | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#agy-muse) |
| agy | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#agy-vibe) |
| gemini | claude | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#gemini-claude) |
| gemini | codex | measured-KO | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | mcp-not-loaded-before-deadline | [JSON](2026-10-15-cross-cli-phase1.json#gemini-codex) |
| gemini | agy | blocked | non mesuré / oui | non mesuré | non mesuré | non mesuré | non mesuré | initial-model-tool-turn-not-observed | [JSON](2026-10-15-cross-cli-phase1.json#gemini-agy) |
| gemini | gemini | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | authentication-required | [JSON](2026-10-15-cross-cli-phase1.json#gemini-gemini) |
| gemini | muse | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#gemini-muse) |
| gemini | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#gemini-vibe) |
| muse | claude | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#muse-claude) |
| muse | codex | measured-KO | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | mcp-not-loaded-before-deadline | [JSON](2026-10-15-cross-cli-phase1.json#muse-codex) |
| muse | agy | blocked | non mesuré / oui | non mesuré | non mesuré | non mesuré | non mesuré | initial-model-tool-turn-not-observed | [JSON](2026-10-15-cross-cli-phase1.json#muse-agy) |
| muse | gemini | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | authentication-required | [JSON](2026-10-15-cross-cli-phase1.json#muse-gemini) |
| muse | muse | blocked | non mesuré / non | non mesuré | non mesuré | non mesuré | non mesuré | onboarding-or-trust | [JSON](2026-10-15-cross-cli-phase1.json#muse-muse) |
| muse | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#muse-vibe) |
| vibe | claude | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-claude) |
| vibe | codex | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-codex) |
| vibe | agy | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-agy) |
| vibe | gemini | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-gemini) |
| vibe | muse | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-muse) |
| vibe | vibe | blocked | non mesuré / non mesuré | non mesuré | non mesuré | non mesuré | non mesuré | python-entrypoint-forbidden:vibe | [JSON](2026-10-15-cross-cli-phase1.json#vibe-vibe) |

## claude-claude

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 4641 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":2099,"id":"h2a-receiver"}]
```

## claude-codex

Statut : **measured-KO** ; motif : `mcp-not-loaded-before-deadline` ; durée : 31513 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":2155,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":false,"wakeArmed":false}]
```

## claude-agy

Statut : **blocked** ; motif : `initial-model-tool-turn-not-observed` ; durée : 31530 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":2474,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":true,"wakeArmed":true},{"role":"receiver","at":1792120831479,"event":"proxy-start","pid":2502,"childPid":2540},{"role":"receiver","at":1792120831735,"event":"initialize","ok":true},{"role":"receiver","at":1792120831736,"event":"tools","ok":true,"messaging":true},{"role":"receiver","at":1792120832094,"event":"wake-armed"}]
```

## claude-gemini

Statut : **blocked** ; motif : `authentication-required` ; durée : 6418 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":2630,"id":"h2a-receiver"}]
```

## claude-muse

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 1906 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":2716,"id":"h2a-receiver"}]
```

## claude-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## codex-claude

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 5460 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":2780,"id":"h2a-receiver"}]
```

## codex-codex

Statut : **measured-KO** ; motif : `mcp-not-loaded-before-deadline` ; durée : 33441 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":2836,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":false,"wakeArmed":false}]
```

## codex-agy

Statut : **blocked** ; motif : `initial-model-tool-turn-not-observed` ; durée : 31781 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":3141,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":true,"wakeArmed":true},{"role":"receiver","at":1792120930397,"event":"proxy-start","pid":3171,"childPid":3209},{"role":"receiver","at":1792120930663,"event":"initialize","ok":true},{"role":"receiver","at":1792120930900,"event":"tools","ok":true,"messaging":true},{"role":"receiver","at":1792120932088,"event":"wake-armed"}]
```

## codex-gemini

Statut : **blocked** ; motif : `authentication-required` ; durée : 5425 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":3340,"id":"h2a-receiver"}]
```

## codex-muse

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 1913 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":3434,"id":"h2a-receiver"}]
```

## codex-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## agy-claude

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 2092 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":3498,"id":"h2a-receiver"}]
```

## agy-codex

Statut : **measured-KO** ; motif : `mcp-not-loaded-before-deadline` ; durée : 31764 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":3548,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":false,"wakeArmed":false}]
```

## agy-agy

Statut : **blocked** ; motif : `initial-model-tool-turn-not-observed` ; durée : 31610 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":3868,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":true,"wakeArmed":true},{"role":"receiver","at":1792121016670,"event":"proxy-start","pid":3895,"childPid":3934},{"role":"receiver","at":1792121016958,"event":"initialize","ok":true},{"role":"receiver","at":1792121016960,"event":"tools","ok":true,"messaging":true},{"role":"receiver","at":1792121017187,"event":"wake-armed"}]
```

## agy-gemini

Statut : **blocked** ; motif : `authentication-required` ; durée : 7609 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":4048,"id":"h2a-receiver"}]
```

## agy-muse

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 2512 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":4142,"id":"h2a-receiver"}]
```

## agy-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## gemini-claude

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 2110 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":4206,"id":"h2a-receiver"}]
```

## gemini-codex

Statut : **measured-KO** ; motif : `mcp-not-loaded-before-deadline` ; durée : 31578 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":4264,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":false,"wakeArmed":false}]
```

## gemini-agy

Statut : **blocked** ; motif : `initial-model-tool-turn-not-observed` ; durée : 31505 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":4544,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":true,"wakeArmed":true},{"role":"receiver","at":1792121109234,"event":"proxy-start","pid":4570,"childPid":4616},{"role":"receiver","at":1792121109491,"event":"initialize","ok":true},{"role":"receiver","at":1792121109492,"event":"tools","ok":true,"messaging":true},{"role":"receiver","at":1792121109676,"event":"wake-armed"}]
```

## gemini-gemini

Statut : **blocked** ; motif : `authentication-required` ; durée : 6227 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":4827,"id":"h2a-receiver"}]
```

## gemini-muse

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 1699 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":4922,"id":"h2a-receiver"}]
```

## gemini-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## muse-claude

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 1726 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":4987,"id":"h2a-receiver"}]
```

## muse-codex

Statut : **measured-KO** ; motif : `mcp-not-loaded-before-deadline` ; durée : 31592 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":2},{"event":"session-created","role":"receiver","pid":5037,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":false,"wakeArmed":false}]
```

## muse-agy

Statut : **blocked** ; motif : `initial-model-tool-turn-not-observed` ; durée : 31687 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":5334,"id":"h2a-receiver"},{"event":"readiness-deadline","role":"receiver","modelToolCallObserved":false,"composerReady":true,"mcpLoaded":true,"wakeArmed":true},{"role":"receiver","at":1792121199616,"event":"proxy-start","pid":5358,"childPid":5388},{"role":"receiver","at":1792121199941,"event":"initialize","ok":true},{"role":"receiver","at":1792121199943,"event":"tools","ok":true,"messaging":true},{"role":"receiver","at":1792121200426,"event":"wake-armed"}]
```

## muse-gemini

Statut : **blocked** ; motif : `authentication-required` ; durée : 5041 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":5497,"id":"h2a-receiver"}]
```

## muse-muse

Statut : **blocked** ; motif : `onboarding-or-trust` ; durée : 2077 ms.

```json
[{"event":"host-setup","role":"receiver","exitCode":0},{"event":"session-created","role":"receiver","pid":5577,"id":"h2a-receiver"}]
```

## muse-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 0 ms.

```json
[]
```

## vibe-claude

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## vibe-codex

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 0 ms.

```json
[]
```

## vibe-agy

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## vibe-gemini

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 0 ms.

```json
[]
```

## vibe-muse

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```

## vibe-vibe

Statut : **blocked** ; motif : `python-entrypoint-forbidden:vibe` ; durée : 1 ms.

```json
[]
```
