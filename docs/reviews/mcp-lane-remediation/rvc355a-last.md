NON-FUSIONNABLE  
Reviewer: astra-max  
Repo: rhanka/h2a  
PR: 355  
Head-SHA: d91fe64e067545d2944690ea225e1934f66e11e0

**P1**

- **LOT-2B incomplet : G-1/G-2 non satisfaits.** Le [manifeste](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/runtime/mcp-central-qualification.ts:20) contient toujours `clients: []`. De plus, le [harnais](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/scripts/qualify-registry-bridge-campaign.mjs:100) ne contient aucun oracle après la vérification du siège : il copie les fichiers, affiche un message puis termine. Enrôler un siège ne suffira donc pas à réaliser la qualification annoncée.

- **LOT-1 : la deuxième mise à niveau échoue après adoption.** [h4RunAction](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/cli.ts:2173) ouvre systématiquement une session de bootstrap exigeant le lien npm historique. Or la première adoption remplace ce lien par le launcher géré. Reproduction : sélection B réussie, puis sélection C → `legacy_command_unqualified`, exit 1, même avec le premier journal placé à `COMPLETED`. Le chemin des installations déjà gérées doit être pris en charge.

- **#354, LOT-3 : contournement du contrôle de qualification.** La [politique du bridge](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/runtime/mcp-central-policy.ts:10) vérifie l’environnement et le marqueur, sans contrôler le premier `initialize` contre le manifeste. Reproduction avec le vrai central temporaire, manifeste vide et client `claude-code/999.0.0-unqualified` : initialisation acceptée, appel d’outil accepté, une attachment centrale, aucun diagnostic `claude_version_unqualified`. La route registry doit appliquer la qualification exacte avant admission.

- **#354, LOT-4 : écrasement d’une création concurrente.** Le [compare-before-publish](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:306) ne s’applique que si le fichier existait initialement. Reproduction : configuration absente, création concurrente via `afterRead`, puis installation → succès et disparition des paramètres et du serveur tiers. L’absence initiale doit aussi être comparée avant publication.

**P2**

- **LOT-1 : codes de sortie incorrects.** Reproductions sur Node 22 et 24 : une cible déjà sélectionnée renvoie `already_adopted` avec exit **2**, au lieu de 0 ; `resume --strict` renvoie exit **0** alors que la transaction reste `PREPARING`. Voir le [retour de run](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/cli.ts:2223) et [resume](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/cli.ts:2049). Cela contredit RQ-05 et trompe les consommateurs automatisés.

- **LOT-1 : découverte automatique du préfixe npm défectueuse.** [resolveH4ManagedRoot](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/runtime/upgrade/index.ts:503) reconnaît uniquement `runtime/upgrade/index.js`, tandis que le worker lui transmet son chemin `boot-worker.js`. Sans `H2A_MANAGED_ROOT`, une installation existante dans ce layout devient `managed_installation_absent`. Les tests injectent cette variable et masquent le défaut.

- **#354, LOT-5 : compilation et activation restent couplées.** [compile](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/registry.ts:421) remplace immédiatement les handlers partagés. Reproduction : G1 active sert A ; compilation de G2 sans activation → G1 sert déjà B. Une activation de G2 ensuite refusée pour `integrity_mismatch` laisse encore B actif. Les handlers doivent appartenir au candidat et basculer atomiquement lors d’`activate`.

- **LOT-7 : CI non verte.** `gh pr checks 355` confirme **17 succès, 1 échec**. Le [trust-root](https://github.com/rhanka/h2a/actions/runs/39230734175/job/118001915106) termine sur `tests timed-out … 1260000ms`. #354 présente également quatre checks en échec. G-6 reste ouvert.

**P3**

- Des clés privées **de fixtures éphémères** apparaissent en clair dans les [preuves Node 22](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/docs/plan/mh-l2/evidence/l2fix-node22-key-publication-race-mutant.log:17) et [Node 24](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/docs/plan/mh-l2/evidence/l2fix-node24-key-publication-race-mutant.log:17). Provenance de test vérifiée ; aucun secret de production identifié. Expurger ces PEM des journaux conservés.

Validation locale : **36/36 tests ciblés sur #355 et 77/77 sur #354, chacun sous Node 22.22.1 et 24.18.0**, zéro skip/todo. Les générateurs plugins/registry passent `--check` ; les modules examinés concordent avec leur `dist`. Ces résultats ne couvrent pas les cas défaillants reproduits ci-dessus.

Constats #354 vérifiés sur `757a5b933479361b5d176f6091433fd87d6dfb89`. Revue en lecture seule, worktrees inchangés.