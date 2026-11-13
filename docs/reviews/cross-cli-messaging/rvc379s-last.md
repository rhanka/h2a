NON-FUSIONNABLE
Reviewer: sol-xhigh
Repo: rhanka/h2a
PR: 379
Head-SHA: 3d10f8b7b9d02d77b2a5e5f0d183e6c949a6808b

**P1**

- **L3 — Faux positif de réveil autonome reproduit.** [qualify-cross-cli.mjs:1156](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/qualify-cross-cli.mjs:1156) vérifie la séparation uniquement lorsque plusieurs offsets sont demandés. Avec `--simulated --pair claude:codex --poll periodic:60000:17000 --timeout-ms 30000`, un récepteur qui ignore le wake obtient **exit 0, `simulated-OK`, `woke:true`**. La spec §3.3 exige trois répétitions séparées avant tout crédit.

- **L4 — Une entrée arbitraire fuit dans les preuves.** [xcli-proxy.mjs:141](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-proxy.mjs:141) conserve directement `request.args.instance`. Reproduction : un canari envoyé avant toute identité, sur un appel inbox échoué, apparaît dans `events.jsonl`. La validation contre les identités connues et le scan avant publication exigés par L4 sont absents.

- **L4 — Confinement des sources contournable par lien symbolique.** [xcli-lab.mjs:264](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:264) utilise `O_NOFOLLOW` uniquement sur le dernier composant. Reproduction : `authSource/.codex → répertoire extérieur` permet de copier son `auth.json`. Il faut contrôler chaque composant et la containment de la source conformément à F6.

- **L5 — Effacement déclaré réussi malgré un transcript survivant.** [xcli-lab.mjs:220](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:220) couvre les logins listés et quelques fichiers du harnais, pas les transcripts CLI. Avec un worker produisant du JSON invalide, un transcript factice sous `sender/home/.codex/sessions/` survit alors que **`parentSecretWipe:true`**. Le chemin parent n’effectue pas non plus la récupération bornée des processus exigée après perte du worker.

- **L11 — Le candidat exécuté avec les secrets n’est pas contrôlé.** [cross-cli-campaign.yml:44](/home/antoinefa/src/h2a/tmp/worktrees/xcli/.github/workflows/cross-cli-campaign.yml:44) accepte librement `candidate_sha`, puis exécute ses scripts avec les secrets disponibles dans l’environnement du job. Aucun contrôle ne lie ce candidat à une provenance et une référence protégées. Refuser les événements PR ne protège pas le code sélectionné par cet input.

- **L11 — Le gate ne peut pas consommer le reçu produit.** [cross-cli-messaging.yml:227](/home/antoinefa/src/h2a/tmp/worktrees/xcli/.github/workflows/cross-cli-messaging.yml:227) lit `docs/cross-cli-receipt.json`, sans récupérer l’artefact publié par la campagne. Il compare aussi au `GITHUB_SHA` du merge synthétique sur événement PR, au lieu du head candidat. Ajouter le reçu par commit changerait encore le SHA. Il faut récupérer un artefact de provenance trusted et vérifier la tête figée.

- **L2 — Régression CI confirmée sur Node 22 et 24.** [upgrade.functional.test.ts:375](/home/antoinefa/src/h2a/tmp/worktrees/xcli/packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts:375) ajoute les tarballs `h2a` et `track`, mais leur installation réclame `@sentropic/focus@0.5.0`, indisponible au registre. Les deux jobs `build-and-test` échouent avec `ETARGET`. Le test de dispatch L2 de `npm-test-trust-root` échoue également sur GitHub : sa preuve GREEN manque.

**P2**

- **L8 — Prévols hors confinement.** [xcli-seats.mjs:225](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-seats.mjs:225) lance `--version`, puis l’oracle, sans environnement ni répertoire privés. Ces processus héritent du HOME et des variables ambiantes ; l’oracle Codex peut donc lire la configuration réelle avant la création des sessions isolées.

- **L8 — Un HOME de siège valide est refusé.** [xcli-seats.mjs:245](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-seats.mjs:245) compare les noms du premier niveau avec le basename des chemins autorisés. Pour `authSource/.codex/auth.json`, il cherche `auth.json` à la racine. Reproduction factice : `preflight-auth-unproven` malgré le fichier attendu.

- **L9 — Mauvaise association des credentials Claude.** [xcli-lab.mjs:208](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:208) associe `claude` à `.config/muse/auth.json` ; `muse` est lui-même refusé. Ce mapping ne permet pas de rejouer la diagonale Claude avec ses credentials autorisés.

- **Campagne réelle bloquée par ses valeurs par défaut.** [qualify-cross-cli.mjs:31](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/qualify-cross-cli.mjs:31) exige 40 secondes de fenêtres, contre un timeout par défaut de 30 secondes. Le workflow de campagne ne fournit aucun override : toute cellule atteignant cette vérification devient `wake-window-unfunded`. Le runner `ubuntu-latest` ne provisionne par ailleurs aucun des quatre binaires requis.

- **L6 — Le journal ne prouve pas l’observation des descendants.** [xcli-lab.mjs:367](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:367) enregistre uniquement les appels explicites à `recordExec`. Aucun mécanisme général n’observe les execs descendants. Le test des processus transitoires appelle lui-même `recordExec` après chaque spawn : il vérifie l’écriture du journal, pas la détection annoncée.

- **L11/R2 — Résultat R1 réutilisé pour une fonction jamais exécutée.** [xcli-ci-check.mjs:31](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-ci-check.mjs:31) recherche uniquement la paire dans les sondes, puis lui attribue le scénario demandé par le manifeste. Reproduction : ajout d’une ligne obligatoire `loop:lifecycle` avec seulement des sondes R1 en entrée → ligne fabriquée `measured-OK`, gate accepté à **17 cellules**. La recherche doit porter sur `(scenario, pair)`.

**P3**

Aucun constat supplémentaire.

Vérifications : **81 tests ciblés passent, zéro ignoré** — 70 tests harnais/manifeste/reçus/scénarios et 11 tests `op`/drive natif. Le manifeste des non-tests est inchangé. Aucun motif de secret courant détecté dans les 160 fichiers modifiés ; la fuite de canari reste reproduite.

Dernier `gh pr checks 379` : **4 échecs**, 13 succès, 91 contrôles en attente. Qualification réelle et suite complète non exécutées, conformément au périmètre conducteur. Checkout inchangé.