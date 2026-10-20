---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: fix/scope-guard-opt-in working tree based on 05bcd23cc
target-diff-sha256: 5d32debe42faebd926f29ca8b768124fdd445bb23e0d0f2d6a671eb558346a6d
observed-failure: Exact author model/effort are unavailable; the owner also forbids installed h2a/native-host and real-state access. No h2a consensus was dispatched or claimed.
---

# Workspace scope guard: opt-in

Owner order: disable default workspace scope enforcement everywhere while keeping
the optional implementation and the packaged manual h2a CLI refusal unchanged.

The fingerprint above identifies the implementation, tests, documentation and
BRANCH.md staged before this evidence dossier. The dossier is excluded from its
own fingerprint.

## Changes

| Surface | Result |
| --- | --- |
| Packaged Claude/Codex hooks | Scope SessionStart/PreToolUse entries removed; the Bash manual CLI hook is identical. |
| Explicit plugin configuration | `--workspace-scope on` renders/writes the guard; default/off removes former scope entries and retains other hooks. |
| Codex marketplace scaffold | Default omits scope; explicit on includes it. |
| Vibe, agy, Gemini shared store, Muse | Native selection persists as `workspaceScope.enabled`; absent/legacy bindings default to off; doctor/upgrade convergence follows that selection. |
| Vibe pre-tool integration | Scope hook is independent of the existing manual CLI guard and only registered after opt-in; project scope masking cannot block a disabled installation. |
| Guard implementation | Retained unchanged; opt-in hook fragment ships separately and is exercised by explicit-enable tests. |
| Documentation | Isolated lab qualification on real lot worktrees, merges, releases and disable/recovery workflows is required before owner-machine enablement. |

## Isolation and verification

All commands below are prefixed with `rtk`. Temporary state:
`/home/antoinefa/.cache-tmp/h2a-test/run-C26vfo`; TMPDIR is set for every verification.
Tests/builds also use disposable HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME and
XDG_STATE_HOME beneath that directory. Hook fixtures discard inherited host
workspace/session/key variables before exercising their own startup bindings.
No real native host, installed h2a, Track mutation or full suite was used.

| Phase | Command | Observed output |
| --- | --- | --- |
| RED | `node --test packages/h2a/test/package-plugin-manifest.test.js` | tests 2; pass 1; fail 1; skipped 0; exit 1. Default hooks still contained workspace-scope-guard. |
| GREEN | `node --test packages/h2a/test/package-plugin-manifest.test.js` | tests 2; pass 2; fail 0; skipped 0; exit 0. Default guard absent, manual CLI hook unchanged. |
| RED, host defaults/selection | `node --test packages/h2a/test/workspace-scope-hosts.test.js` against original HEAD host/CLI implementations | tests 39; pass 12; fail 27; skipped 0; exit 1. Original TypeScript was transpiled into disposable local build outputs, then the corrected h2a project was rebuilt. |
| First targeted pass | Eleven named files listed below | tests 395; pass 387; fail 8; skipped 0; exit 1. Inherited CLAUDE_PROJECT_DIR contaminated startup fixtures; one Vibe assertion matched inactive helper file paths instead of hook commands. |
| TypeScript | `node node_modules/typescript/bin/tsc -b packages/h2a --force` | exit 0, no diagnostics. |
| Package | `npm pack --workspace @sentropic/h2a --dry-run --ignore-scripts --json`, followed by package-file assertions | PASS: default hooks, optional fragment, guard and manual CLI hook are packaged. |

Initial `npm run build:h2a` reports unrelated Focus type errors in
`packages/focus/src/track/index.ts` (missing Dossier/Option/QAEntry properties).
The Track build succeeds. Local dependency artifacts were emitted with
`tsc -b --noCheck`, followed by the successful, fully checked h2a build above.
No Focus source, dependency, version or compiler configuration was changed.

The first targeted command was:

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

The nine files outside the two scope suites passed 62/62 with zero skips.
Only the two changed scope suites are rerun after correcting fixture isolation
and the command assertion; their final result is recorded below.

```sh
rtk node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js
```

Observed output: tests 333; pass 333; fail 0; cancelled 0; skipped 0; todo 0;
exit 0 (132231 ms). Together with the nine previously passing files, all 395
targeted tests pass without skips. The guard's implementation remains unchanged.

## Correction round 1 — PR #387

Revues reçues : `astra-max` et `sol-xhigh`, sur
`b2e58b9024d8d5455c488d4960edf167905b8bcd`. Les trois P2 distincts sont
reproduits avant correction. Aucune nouvelle revue indépendante n'est revendiquée.

| P2 | Correction |
| --- | --- |
| Hooks personnels supprimés avec le guard | Filtrer les seules commandes du guard dans chaque groupe SessionStart/PreToolUse ; conserver les autres commandes, leur ordre et les métadonnées. Appliquer le même filtre au CLI et à l'installation Muse. |
| Goldens d'aide obsolètes | Vérification des trois lignes d'aide modifiées : +182 octets pour la sélection explicite et sa qualification. SHA-256 actualisé à `5de555ce408802c4cd7cfe3d7fef10d766d7de24df22f44cac4fd684bfe580d0`, taille à 14 411 octets ; assertions de routage conservées. |
| Migration agy dépendante du poste | PATH privé par fixture avec node/git/sh et un faux agy exécutable. Vérifier l'installation cohérente, la réécriture effective du fichier de hooks et la persistance de `enabled: false`. |

Laboratoire : `/home/antoinefa/.cache-tmp/h2a-test/run-IUV5En` (`T` ci-dessous).
Son PATH extérieur contient uniquement des liens vers node, git et sh, sans agy.
Tous les tests et compilations utilisent ce préfixe (les commandes des tableaux
sont données après ce préfixe) :

```sh
rtk env TMPDIR="$T" HOME="$T/home" XDG_RUNTIME_DIR="$T/runtime" \
  XDG_CONFIG_HOME="$T/config" XDG_STATE_HOME="$T/state" XDG_DATA_HOME="$T/data" \
  H2A_ROOT="$T/state/bus" REMOTE_CLI_CONFIG_HOME="$T/config" \
  CODEX_HOME="$T/home/.codex" CLAUDE_CONFIG_DIR="$T/home/.claude" \
  VIBE_HOME="$T/home/.vibe" PATH="$T/bin"
```

| Phase | Commande | Sortie observée |
| --- | --- | --- |
| Compilation RED | `node node_modules/typescript/bin/tsc -p packages/h2a --tsBuildInfoFile "$T/red.tsbuildinfo"` | exit 0, aucun diagnostic. |
| RED aide, Astra/Sol | `node --test packages/h2a/test/dispatch-characterization-goldens.test.js` | tests 9 ; pass 7 ; fail 2 ; skipped 0 ; exit 1. SHA réel `5de555ce…` contre l'ancien `d5b4a43f…`. |
| RED migration, Sol | `node --test packages/h2a/test/workspace-scope-hosts.test.js` avant ajout des six régressions | tests 39 ; pass 38 ; fail 1 ; skipped 0 ; exit 1. `opt-in migration: legacy agy bindings do not authorize activation` retrouve le guard dans le fichier. |
| RED groupes mixtes, Astra | `node --test --test-name-pattern='opt-in removal preserves' packages/h2a/test/workspace-scope-hosts.test.js` | tests 6 ; pass 0 ; fail 6 ; skipped 0 ; exit 1. SessionStart/PreToolUse deviennent vides au lieu de conserver `echo startup-retained` et `deny-manual-h2a-cli.mjs`. |
| Compilation GREEN | `node node_modules/typescript/bin/tsc -p packages/h2a --tsBuildInfoFile "$T/green.tsbuildinfo"` | exit 0, aucun diagnostic. |
| GREEN aide | `node --test packages/h2a/test/dispatch-characterization-goldens.test.js` | tests 9 ; pass 9 ; fail 0 ; skipped 0 ; exit 0. |
| GREEN hôtes, groupes mixtes et migration | `node --test packages/h2a/test/workspace-scope-hosts.test.js` après isolation de chaque scénario Muse | tests 45 ; pass 45 ; fail 0 ; skipped 0 ; exit 0. |

Les six nouvelles régressions couvrent les cinq hôtes JSON du CLI et l'installation
Muse, la désactivation explicite et par défaut, l'idempotence, les groupes contenant
uniquement le guard et les mentions du nom du guard dans les métadonnées.

Premier passage des douze fichiers ciblés, avec le même préfixe :

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/dispatch-characterization-goldens.test.js
```

Sortie : tests 410 ; pass 409 ; fail 1 ; skipped 0 ; exit 1. Les onze fichiers
autres que `workspace-scope-hosts` passent, soit 365 tests. Le seul échec vient
de la nouvelle fixture Muse : son second scénario réinjectait l'ancien contenu
dans un fichier déjà géré ; le contrôle de hash signale correctement un conflit
local. Reproduction ciblée :
`node --test --test-name-pattern='mixed Muse installation' packages/h2a/test/workspace-scope-hosts.test.js`
→ tests 1 ; pass 0 ; fail 1 ; skipped 0 ; exit 1, `conflicts: [<fixture>/.muse/hooks.json]`.
Correction limitée au test : une nouvelle fixture indépendante pour chaque mode,
sans modifier la protection des fichiers gérés ni les assertions.

Bilan final sur les mêmes sources compilées : 365 tests des onze autres fichiers
déjà réussis, puis 45/45 dans le fichier hôtes corrigé ; soit 410 tests distincts
réussis, zéro échec restant et zéro test ignoré. L'aide a également été relancée
séparément : 9/9. Aucune suite globale, aucun hôte réel ou h2a installé n'a été
utilisé. `git diff --check` : exit 0, aucune sortie.
