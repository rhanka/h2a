---
status: selection-failed
target-ref: 2279ee9f00b7045b8b1eb21a4d4bee5522eab2e0
review-author:
  host: codex
  model: unavailable
  effort: unavailable
observed-failure: No h2a MCP is exposed in confinement; exact author model/effort are not supplied. Real host access is forbidden. No independent consensus is claimed.
---

# PR #364 — Tour 3

Source : contre-revue indépendante `rev364-r2.md`, tête examinée
`45e2715d3583d795b86480971cd073631d3886a0`. Tous les constats, y compris les
sous-variantes et réserves de la synthèse, ont été lus. Aucun merge sur main,
changement de version/dépendance, outil h2a installé, état h2a réel ou processus
tiers consulté. Aucun outil agent ne lance les mutations proposées dans les
payloads : seuls les hooks et les dépôts factices sont exécutés.

| Constat | Correction de cause | Preuve comportementale |
| --- | --- | --- |
| R1 — agy / Muse | agy lie `conversationId` une fois dans le journal de profil depuis le seul `workspacePaths` absolu de SessionStart, renvoie `{}`, et utilise le workspace lié comme cwd par défaut. `host plugin --write` installe aussi SessionStart sans workspace/session globaux figés. Muse ne crée ses hooks projet que sur installation explicite ; la convergence utilisateur conserve les helpers de profil. | Deux installations agy exécutées depuis le véritable cwd global de configuration, deux workspaces/sessions, écritures et shell propres autorisés, hooks OWNER_ONLY, rebinding refusé ; convergence Muse sans pollution du cwd temporaire. |
| R2 — shell | Groupes simples tokenisés ; syntaxe/état non résolus refusés : contrôles, fonctions, eval/export/aliases, stdin opaque, exécutables variables, pipelines composés, expansions et resets conditionnels ambigus. Wrappers à options connues, commentaires et continuations analysés. Piles cwd/HOME/OLDPWD/pushd isolées. GIT_DIR et worktree restent distincts ; options globales Git analysées ; mutations de configuration/remotes refusées. | Toutes les variantes de la revue, complétées par pipelines entre étapes/sous-shells, options de wrappers inconnues et resets sautés par &&/||. Matrice commune sur claude/codex/agy/muse/vibe. |
| R3 — autorité | Ensemble de chemins de confiance : journaux, clé, helpers, hooks projet/globaux et manifeste projet. Destinations cp/install/ln et dd analysées ; clean vérifie ses cibles ; apply/am mutateurs owner-only même avec flags d’inspection. Références JS à tools exclusivement directes et statiques ; alias/destructuration/accès réfléchis ou échappés refusés. | Accolades, inline runtimes aux flags attachés, heredoc après point-virgule, cp -t/--target-directory, dd/ln, clean explicite/implicite, git apply, hooks des hôtes et alias JS refusés ; lecture de helper toujours autorisée. |
| R4 — versions | Chaque commit inspecte l’index, indépendamment des opérandes de ses options ; chemins/--all inspectent aussi le worktree. Push inspecte toutes les références sélectionnées. Sections de patch comparées par chemin canonique complet. Remplacements agy appliqués à leurs plages de lignes originales, de bas en haut. | --author/--date/-F/-C/-c/--cleanup/--trailer avec index bumpé et worktree restauré ; --branches/--tags depuis HEAD propre ; patch monorepo ; remplacement simple/multiple avec version dupliquée plus haut ; git apply owner-only. |
| R5 — faux positifs | Lexer JS séparant code, commentaires et chaînes ; décodage des littéraux avant classification shell. L’état shell est détecté depuis les commandes effectives, pas les mots de leurs arguments. | Messages/commentaires mentionnant apply_patch ou exec_command autorisés ; littéraux JS simples/templates échappés inspectés ; build avec NODE_ENV et message de commit « cd » autorisés. |
| Réserves Tour 1 | Grants signés/expirés, sélecteurs de refus, clés startup, versions privées, scripts de release et bindings Vibe restent vérifiés. | Les assertions antérieures sont conservées ; aucune assertion de refus n’est retirée. Le test agy existant initialise désormais une vraie session native au lieu de supposer un binding global. |

## Commandes et sorties

Toutes les campagnes tournent avec HOME/XDG_RUNTIME_DIR/XDG_CONFIG_HOME/
XDG_STATE_HOME/CODEX_HOME/CLAUDE_CONFIG_DIR/VIBE_HOME temporaires, supprimés en
`finally`. Les fixtures créent et suppriment leurs dépôts, clés et profils.
Les commandes sont préfixées par `rtk` ; le tableau montre les commandes Node
sous-jacentes. TAP et lanceur d’isolation : `.h2a/build/scopeguard/`.

| Campagne rouge | Commande ciblée / sélection | Sortie observée |
| --- | --- | --- |
| `tour3-red.tap` | node --test --test-name-pattern=T3 packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js | tests 76 ; pass 0 ; fail 76 ; skipped 0 ; exit 1 |
| `tour3-matrix-red.tap` | node --test --test-name-pattern='T3 matrix\|reflective and escaped' packages/h2a/test/workspace-scope-guard.test.js | tests 6 ; pass 0 ; fail 6 ; skipped 0 ; exit 1 |
| `tour3-wrapper-red.tap` | même fichier ; --test-name-pattern='unknown wrapper' | tests 1 ; pass 0 ; fail 1 ; skipped 0 ; exit 1 |
| `tour3-interactions-red.tap` | même fichier ; --test-name-pattern='T3 R2.*pipeline stage cwd\|T3 R3.*inspection flags' | tests 2 ; pass 0 ; fail 2 ; skipped 0 ; exit 1 |
| `tour3-pipeline-nested-red.tap` | même fichier ; --test-name-pattern='T3 R2.*pipeline nested cwd' | tests 1 ; pass 0 ; fail 1 ; skipped 0 ; exit 1 |
| `tour3-js-escapes-red.tap` | même fichier ; --test-name-pattern='T3 R3.*JS escapes' | tests 2 ; pass 0 ; fail 2 ; skipped 0 ; exit 1 |
| `tour3-agy-default-red.tap` | node --test --test-name-pattern='T3 R1 should bind agy' packages/h2a/test/workspace-scope-hosts.test.js | tests 2 ; pass 0 ; fail 2 ; skipped 0 ; exit 1 |
| `tour3-shell-state-red.tap` | garde ; --test-name-pattern='T3 R2.*(?:eval cwd state\|export repo state\|readonly repo state)' | tests 3 ; pass 0 ; fail 3 ; skipped 0 ; exit 1 |
| `tour3-conditional-red.tap` | garde ; --test-name-pattern='T3 R2.*(?:conditional cwd reset\|conditional repo reset\|brace expansion subcommand\|skipped cd)' | tests 4 ; pass 0 ; fail 4 ; skipped 0 ; exit 1 |
| `tour3-conditional-prose-red.tap` | garde ; --test-name-pattern='T3 R5.*command data' | tests 2 ; pass 0 ; fail 2 ; skipped 0 ; exit 1 |
| `tour3-ci-inventory-red.tap` | node --test --test-name-pattern='C9 A01/A03/A04' packages/h2a/test/run-test-gates.test.js | tests 1 ; pass 0 ; fail 1 ; skipped 0 ; exit 1 |

Les campagnes matrix/wrapper utilisent une copie temporaire des quatre hooks de
`45e2715d3` et les nouveaux tests, sans modifier le checkout. Les autres rouges
sont observés avant leur correction dans le checkout. Les verts intermédiaires
correspondants sont conservés. Les nouvelles assertions de cwd par défaut agy
enrichissent deux tests déjà présents dans le premier rouge ; les nombres ne se
somment pas en nombre de cas uniques.

Commande finale (11 fichiers nommés, aucune découverte de suite complète) :

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

```text
exit 0
# tests 293
# pass 293
# fail 0
# skipped 0
# duration_ms 69766.651098
TAP: .h2a/build/scopeguard/tour3-final-293.tap
```

| Vérification | Sortie observée |
| --- | --- |
| node --test --test-name-pattern='C9 A01/A03/A04' packages/h2a/test/run-test-gates.test.js | tests 1 ; pass 1 ; fail 0 ; skipped 0 ; exit 0 |
| node node_modules/typescript/bin/tsc -b --pretty false | exit 0 |
| bash scripts/check-public-contract.sh | 60 outils MCP ; 100 verbes CLI ; CONTRAT PUBLIC OK ; exit 0 |
| bash scripts/check-no-python.sh | ZERO PYTHON OK (1 allowlisted hit, 0 unexcused) ; exit 0 |
| git diff --check | exit 0 |

## CI et limites

Les trois jobs rouges de l’ancienne tête (`build-and-test` Node 22/24 et
`npm-test-trust-root`) signalaient le même nom de test normatif obsolète pour
agy/Muse. `scripts/test-inventory.json` exige maintenant le test d’installation
existant ; aucune exigence d’exécution n’est supprimée. Le contrôle C9 ci-dessus
était rouge avant ce remplacement et vert après. Les états job par job de la
nouvelle tête sont dans le Tour 3 du rapport propriétaire.

Non couvert : sessions natives complètes et mutations distantes réelles,
interprétation exhaustive de shell/JavaScript/scripts opaques, immuabilité OS
des hooks/journaux sous le même UID. Les syntaxes connues mais non résolues
refusent plutôt que d’autoriser une cible supposée. Plusieurs workspaces agy
dans un même événement SessionStart sont refusés ; plusieurs sessions distinctes
dans un même profil sont couvertes. La suite complète locale reste réservée au
conducteur/CI. Le probe natif Muse du Tour 2 n’a pas été rejoué ce tour.

Le skill harness-review exige « Launch only through the installed h2a MCP
server ». Aucun serveur h2a MCP n’est exposé ici ; son accès réel est interdit.
Le présent dossier enregistre selection-failed, sans legs ni verdict de
consensus. Cela ne constitue pas une nouvelle revue indépendante du correctif.

Écart borné de périmètre : mise à jour de l’unique entrée d’inventaire CI qui
bloquait la branche, ajoutée aux limites de BRANCH.md. Aucun affaiblissement
d’une garde ou retrait de test ; les constructions ambiguës sont explicitement
refusées et documentées. Aucun processus de test ne doit rester actif à la fin.
