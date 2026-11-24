NON-FUSIONNABLE  
Reviewer: sol-xhigh  
Repo: rhanka/h2a  
PR: 354  
Head-SHA: 757a5b933479361b5d176f6091433fd87d6dfb89

- **P1 — Qualification contournée, LOT-3/RQ-02.** [mcp-central-policy.ts:14](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/runtime/mcp-central-policy.ts:14) vérifie l’environnement et le marker, jamais le client `initialize`. Reproduction sur le binaire : manifeste vide, qualification `false`, mais un client non listé reçoit un `initialize` réussi et **60 outils**, sans `claude_version_unqualified`. Le bridge doit appliquer la qualification exacte avant admission.

- **P1 — Écrasement d’une création concurrente, LOT-4/RQ-09.** [host-bootstrap.ts:306](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:306) ne compare les octets que si le fichier existait initialement. Reproduction : création du fichier par `afterRead`, puis installation réussie ; les paramètres concurrents disparaissent, sans sauvegarde. L’absence initiale doit également faire partie de la comparaison avant publication.

- **P1 — Gates G-2 et G-6 non satisfaites.** LOT-2B reste non exécuté, `clients: []`, sans décision D-01 documentée autorisant une fusion à portée réduite. `gh pr checks 354` donne **14 verts, 4 rouges** : M17 Node 22, les deux `build-and-test` et `npm-test-trust-root`. Le [job M17](https://github.com/rhanka/h2a/actions/runs/39230763574/job/117987874188) dépasse 1 350 secondes ; son nettoyage échoue aussi avec `m17_volume_has_unremoved_test_state`. Les trois consommateurs refusent ensuite les preuves manquantes.

- **P2 — Une compilation active prématurément les handlers, LOT-5/RQ-10.** [registry.ts:421](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/registry.ts:421) remplace `stored.handlers` avant `activate`. Reproduction : G1 sert A ; compilation réussie de G2 avec B, sans activation ; G1 sert désormais B. Les handlers doivent appartenir au plan et basculer atomiquement avec lui.

- **P2 — F-09 masqué par des handlers factices, LOT-6/RQ-13.** [definitions.ts:72](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/definitions.ts:72) fournit 45 fonctions qui lèvent systématiquement une erreur. La définition réelle compile et s’active, puis `dispatch(..., "h2a_discover_instances", {})` échoue avec `compile-time presence only`. L’erreur a été déplacée de la compilation vers l’utilisation.

- **P2 — Désinstallation destructive après modification utilisateur, LOT-4/RQ-09.** [host-bootstrap.ts:815](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:815) accepte une entrée Codex dès qu’elle contient `registry-bridge`, sans comparaison au reçu. Reproduction : ajout de `--name operator-edit` après installation ; désinstallation réussie, table supprimée. Le conflit doit être refusé.

- **P2 — `--dry-run` écrit pour le mécanisme plugin.** [cli-registry.ts:170](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/cli-registry.ts:170) appelle l’installateur sans transmettre cette option. Reproduction : `bootstrap install --mechanism plugin --dry-run` crée le lock et le reçu, puis annonce `installed`.

- **P2 — Double mécanisme accepté, LOT-4B/RQ-08.** [host-bootstrap.ts:1002](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/registry/host-bootstrap.ts:1002) recherche uniquement un reçu concurrent. Une déclaration fichier `mcpServers.h2a` existante sans reçu n’est pas détectée. Reproduction : vérification plugin acceptée, déclaration fichier `mcp-serve` conservée ; les deux mécanismes peuvent coexister.

**P3 :** aucun retenu.

Vérifications indépendantes : **84/84 tests ciblés sous Node 22.22.1 et 24.18.0**, zéro ignoré ; les deux générateurs passent en `--check`. Aucun nouveau test ignoré ni secret opérationnel détecté dans le diff ; les PEM des logs proviennent de fixtures éphémères. Aucun fichier du dépôt modifié.