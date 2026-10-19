NON-FUSIONNABLE
Reviewer: astra-max
Repo: rhanka/h2a
PR: 354
Head-SHA: 757a5b933479361b5d176f6091433fd87d6dfb89

- **P1 — LOT-3 : qualification Claude contournée.** [L’admission du bridge](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/runtime/mcp-central-policy.ts:14) vérifie l’environnement et le marqueur central, sans vérifier l’`initialize` contre le manifeste. Reproduction avec le binaire livré et un central temporaire réel : malgré `clients: []`, un client non répertorié obtient **60 outils, un attachement central et `identity_ready`** sous Node 24. La route doit appliquer la qualification exacte avant admission. Cela contredit RQ-02 et l’affirmation auteur « tout initialize refusé ».

- **P1 — LOT-4 : création concurrente écrasée.** Dans [la transaction](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:306), la comparaison avant publication dépend de `existed`. Si le fichier était absent puis est créé par un autre acteur, `renameSync` l’écrase. Reproduit sur Node 22 et 24 : résultat `installed`, paramètres concurrents perdus. L’absence initiale doit également être vérifiée avant publication, conformément à RQ-09.

- **P2 — LOT-5 : définition enregistrée encore mutable.** [`register`](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/registry.ts:197) conserve les références fournies. Après enregistrement, ajouter `h2a_send` au profil `hosted-read-only` permet de compiler, activer et appeler ce handler **avec le digest initial inchangé**. Reproduit sur les deux Nodes. Il faut figer une copie indépendante des métadonnées et des tables de handlers.

- **P2 — LOT-5 : handlers remplacés avant activation.** [`compile`](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/registry.ts:421) publie les handlers dès qu’un candidat valide est produit. Reproduction : G1 sert A ; compilation de G2 avec B, sans `activate` ; G1 sert désormais B. Les handlers doivent appartenir au candidat et basculer uniquement avec son activation. La correction F-11 protège les compilations refusées, mais laisse cette violation de RQ-10.

- **P2 — LOT-6 : loader fonctionnellement factice.** [La définition publiée](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/definitions.ts:70) retourne une `Map` dont toutes les fonctions lèvent systématiquement une erreur. Le cycle réel `register → configure → compile → activate → dispatch(h2a_identity_status)` termine par `compile-time presence only`. La compilation verte ne démontre donc pas une définition utilisable : les handlers doivent être reliés au contrat d’exécution prévu.

- **P2 — LOT-4 : désinstallation Codex sans contrôle des modifications utilisateur.** [Le contrôle de propriété](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/codex-toml.ts:183) accepte toute entrée dont les arguments contiennent `registry-bridge`. Après installation, remplacer la commande par un wrapper personnel puis désinstaller supprime quand même l’entrée. Reproduit sur les deux Nodes. Comparer l’entrée courante au reçu d’installation avant suppression, comme l’exige RQ-09.

- **P2 — LOT-4B : double mécanisme accepté sans reçu antérieur.** [La vérification du plugin](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:1002) recherche seulement un reçu concurrent. Avec une configuration contenant déjà `h2a mcp-serve`, sans reçu, elle retourne `installed` et laisse cette déclaration intacte : plugin et fichier peuvent exposer simultanément h2a. Reproduit sur les deux Nodes. Vérifier les déclarations présentes, pas seulement les reçus.

**P3 : aucun constat supplémentaire retenu.**

Les portes de fusion restent également fermées :

- **G-2 / LOT-2B** : aucune qualification réelle exécutée, manifeste vide, aucune décision D-01 fournie. Le [harnais](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/scripts/qualify-registry-bridge-campaign.mjs:100) ne contient pas encore l’exécution des oracles après détection d’un siège.
- **G-6 / LOT-7** : `gh pr checks 354` confirme **14 succès et 4 échecs**. [M17 Node 22](https://github.com/rhanka/h2a/actions/runs/39230763574/job/117987874188) dépasse 1 350 secondes, puis échoue au nettoyage du volume. Les deux `build-and-test` et `npm-test-trust-root` échouent sur cette dépendance ; leurs suites ne sont pas exécutées.

Vérifications indépendantes : neuf fichiers ciblés, **97/98 sur chaque Node, zéro skip/todo**. L’unique échec est `EROFS` dans le test qui régénère les déclarations dans le checkout ; son oracle passe dans une copie temporaire sur les deux Nodes. Track : **5/5 sur chaque Node**. Typecheck sans émission et générateurs `--check` verts. Aucun secret détecté dans les 58 fichiers contrôlés. Aucun fichier du dépôt modifié.