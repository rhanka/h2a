NON-FUSIONNABLE  
Reviewer: astra-max  
Repo: rhanka/h2a  
PR: 379  
Head-SHA: 3d10f8b7b9d02d77b2a5e5f0d183e6c949a6808b

- **P1 — L3 : le faux positif de réveil subsiste.** La vérification des répétitions n’est appelée que si plusieurs offsets sont demandés ([qualify-cross-cli.mjs:1156](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/qualify-cross-cli.mjs:1156)). Reproduction simulée : `--pair claude:codex --poll single:18000 --timeout-ms 90000 --mcp-call-cap 1000` retourne **exit 0, `simulated-OK`, `woke:true`** alors que le récepteur ignore entièrement le wake. La spec exige trois répétitions séparées avant tout crédit à l’étape 7.

- **P1 — L11 : le reçu accepté ne prouve pas la qualification.** [checkReceipt:36](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-receipt-check.mjs:36) n’authentifie pas la provenance du job et ne vérifie ni les huit étapes, ni l’absence de blocker, ni le nettoyage des processus. Une fixture fabriquée avec étapes à `false`, `processRecovery:false`, blocker de nettoyage et zéro session débitée est acceptée pour les **16 cellules**. Le reçu doit être rattaché à une exécution de confiance et ses preuves vérifiées.

- **P1 — L11 : une sonde devient une preuve R2 jamais exécutée.** L’assembleur sélectionne uniquement les sondes, les indexe par paire puis leur attribue le scénario obligatoire ([xcli-ci-check.mjs:27](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-ci-check.mjs:27)). Reproduction : ajouter `loop:lifecycle` au manifeste produit un reçu accepté à **17 cellules**, sans aucune exécution du loop. Le SHA de `qualification.json` est également ignoré. Corréler scénario, paire et SHA des résultats sources.

- **P1 — L11 : les secrets sont exposés au checkout d’un candidat non vérifié.** Les quatre bundles sont dans l’environnement du job avant le checkout de `inputs.candidate_sha`, sans contrôle de provenance ou de protection ([cross-cli-campaign.yml:36](/home/antoinefa/src/h2a/tmp/worktrees/xcli/.github/workflows/cross-cli-campaign.yml:36)). La protection de l’environnement porte sur le lancement du workflow ; elle ne valide pas ce SHA arbitraire. Les scripts du candidat importés ensuite peuvent lire tous les bundles. Valider le candidat avant leur exposition.

- **P1 — L2 : les gates généraux restent cassés.** Le packaging ajoute `h2a` et `track`, mais omet leur dépendance locale Focus ([upgrade.functional.test.ts:375](/home/antoinefa/src/h2a/tmp/worktrees/xcli/packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts:375)). Les deux [jobs CI Node 22/24](https://github.com/rhanka/h2a/actions/runs/39235387637) échouent sur `No matching version found for @sentropic/focus@0.5.0`. Ce sont des échecs observés sur la tête demandée, plus une simple attente de runner.

- **P2 — L11 : aucun transfert exploitable du reçu vers les gates.** Le job publie un artifact, mais PR et release lisent `docs/cross-cli-receipt.json` sans le télécharger. En PR, le contrôle utilise en outre `$GITHUB_SHA`, SHA de fusion synthétique, au lieu de la tête qualifiée ([cross-cli-messaging.yml:227](/home/antoinefa/src/h2a/tmp/worktrees/xcli/.github/workflows/cross-cli-messaging.yml:227)). Committer le reçu modifierait encore le SHA. Il faut récupérer l’artifact authentifié du candidat exact.

- **P2 — L11 : la commande de campagne ne peut pas aboutir.** Le [workflow:92](/home/antoinefa/src/h2a/tmp/worktrees/xcli/.github/workflows/cross-cli-campaign.yml:92) fournit une racine incompatible avec le garde imposant `/tmp/h2a-qual-*`, et conserve un timeout de **30 s** pour des fenêtres réelles totalisant **40 s**. Ensuite, ses quatre versions mesurées omettent Vibe, pourtant déréférencé par le vérificateur : reproduction, `Cannot read properties of undefined (reading 'version')`.

- **P2 — L4 : donnée arbitraire conservée dans les preuves.** [xcli-proxy.mjs:141](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-proxy.mjs:141) persiste directement `request.args.instance`. Un canari ayant exactement la forme `codex:workspace:deadbeefcafe`, envoyé avant toute identité connue dans un appel refusé, reste dans `events.jsonl`. La corrélation aux identités exigée par la spec manque ; aucun scan de publication n’est câblé.

- **P2 — L4 : sortie de la racine d’authentification par symlink.** `O_NOFOLLOW` protège seulement le dernier composant ([xcli-lab.mjs:264](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:264)). Reproduction : `.codex` pointe vers un répertoire extérieur contenant un `auth.json` factice ; `copyLogin` copie ce fichier. Vérifier tous les composants et le confinement avant lecture.

- **P2 — L5 : effacement déclaré malgré un transcript survivant.** La liste effacée couvre les logins et les journaux du harnais, pas les transcripts CLI ([xcli-lab.mjs:220](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:220)). Avec un worker factice perdu, `.codex/sessions/transcript.jsonl` subsiste alors que **`parentSecretWipe:true`**. Le parent n’effectue pas non plus la récupération bornée des processus exigée. Inclure tout l’état privé des CLI dans cette récupération.

- **P2 — L8 : prévols hors confinement.** Les appels `--version` et `codex mcp list --json` héritent de l’environnement courant ([xcli-seats.mjs:225](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-seats.mjs:225), [268](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-seats.mjs:268)). Une CLI factice confirme l’héritage des HOME/XDG ambiants. L’oracle examine ainsi potentiellement la configuration propriétaire plutôt que celle du siège temporaire.

- **P2 — L8/L9 : les chemins de login empêchent la qualification.** Claude est associé à `.config/muse/auth.json`, et Muse est absent de l’allowlist ([xcli-lab.mjs:206](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:206)). Le prévol cherche par ailleurs `auth.json` directement dans `authSource`, au lieu de `.codex/auth.json` ([xcli-seats.mjs:245](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-seats.mjs:245)). Fixtures : zéro copie pour un login Claude normalement disposé ; siège Codex correctement disposé refusé.

- **P2 — L6 : le journal n’observe pas les descendants annoncés.** [recordExec:367](/home/antoinefa/src/h2a/tmp/worktrees/xcli/scripts/xcli-lab.mjs:367) enregistre uniquement les appels explicites d’instrumentation. Un lanceur Node exécutant une copie native de `/bin/true` nommée `python3.14` produit `pythonDescendants:[]`. Le test existant inscrit lui-même le descendant dans le journal. Cela ne satisfait pas l’observation des exécutions exigée par la spec.

P3 : aucun constat supplémentaire retenu.

Validation : `rtk node --test scripts/xcli-{lab,proxy,seats,matrix,receipt-check,campaign-lane,scenarios,docs,evidence}.test.mjs` → **72 réussis, zéro échec, zéro ignoré**. Les contre-exemples ci-dessus utilisent uniquement des fixtures temporaires. Le spot simulé au budget standard a aussi rencontré `wake-window-unfunded`.

Dernier `gh pr checks 379` : **4 échecs, 91 en attente, 13 réussites**. Le manifeste des non-tests est inchangé. Scan de 103 fichiers de preuve : aucun motif usuel de token détecté, sans garantie d’absence de fuite.

Tête revérifiée localement et sur GitHub ; checkout resté propre. Qualification réelle non exécutée, conformément à la consigne.