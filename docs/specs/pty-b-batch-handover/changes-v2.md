# PTY B spec v2 — remarque → traitement

Base de preuve : `origin/main` (`7670fbed6`), lu par `git show origin/main:<path>`.
Livrable corrigé : `SPEC_EVOL_PTY_B_BATCH_HANDOVER.v2.md` (EN). La v1 reste pour traçabilité.
Résultat global : aucune remarque rejetée sur son fond ; une seule affinée (A9/D13, voir ligne).

## Revue Astra max (`revpty-last.md`)

| N° | Remarque | Verdict + preuve | Traitement v2 |
|---|---|---|---|
| A1 P1 | `h2a upgrade` existe, supprime l'ancienne install | Confirmé. `cli.ts:1877 cmdUpgrade` → `performAutoUpgrade` ; `upgrade/index.ts:1536 rmSyncSafe(prevDir)` + sweep | §2 corrigé, D4/D28, B4 réécrit (2 chemins, rétention, fichiers+tests `packages/h2a` autorisés) |
| A1 suite | Retour au fusionné ≠ protocole v1 | Confirmé. `process.ts` fusionné sans protocole propriétaire | D28 : 2 rollbacks distincts ; abandon B après drainage ; RED B4 avec sessions B actives |
| A2 P1 | Portage macOS produit absent | Confirmé. `server.ts:465` sockets abstraits ; `/proc` partout ; suites `skipIf(linux)` ; CI `ubuntu-latest` seul | Lot BM nouveau + D27, §6 scindé banc/substrat, gates par plateforme, workflow macOS ARM64 |
| A3 P1 | Frappes en vol perdues | Confirmé. `op.ts:499` jette le bloc incertain ; `client.ts:243` id neuf par essai | D21 (id stable, ACK, dédup, reprise lease), B1 couture, B3 avec 3 coupures + octets CLI |
| A4 P1 | État produit non transféré | Confirmé. Lease liée à `host.generation` ; replay/parseurs hors FD ; spike envoie déjà métadonnées+offsets+`controlText` | D22 snapshot versionné + import atomique + traduction lease ; RED L3 client déjà attaché |
| A5 P1 | Registre tueur de CLI transféré | Confirmé. Rows au propriétaire créateur ; `reconcileDeadHostOrphans` tue le groupe | D23 CAS au commit + epoch, §7, RED L4 transfert→sortie→réconciliation |
| A6 P1 | Succession du listener absente | Confirmé (trou de spec). Keeper = listener+verrou+pathname+`.owner` chez le propriétaire | D24 succession ordonnée ; gate L4 même inode après `SIGKILL` frontal |
| A7 P1 | Rollback mort coordinateur flou | Confirmé. Files en mémoire du coordinateur ; commit/timeout/dépassement indéfinis | D25 garde chez le cédant + machine d'états avant L3 ; D26 ; RED mort coordinateur/`PREPARED` tardif/saturation |
| A8 P2 | Listes fichiers non fermées | Confirmé. B5 fichiers non nommés ; `native/` générique ; 0 workflow attribué | Listes exactes partout, natif nommé (4 fichiers), CI à BM, contrôle `git status --porcelain` + `diff` |
| A9 P2 | D13 mal attribué | Confirmé, avec précision. 0 Python livré = owner (QO4) ; C+N-API non sourcé ; « image » = motif owner du 0 Python, pas interdiction générale | D13 scindé owner/proposition ; phrase « No new container image » retirée |

## Revue Sol 6.1 max (`revpty2-last.md`)

| N° | Remarque | Verdict + preuve | Traitement v2 |
|---|---|---|---|
| S1 P1 | Perte frappe `op.ts::pumpInput` | Confirmé (= A3) | D21 + B3 (vrai attach) ; `op.ts` dans B3 dès le départ |
| S2 P1 | Snapshot incomplet | Confirmé (= A4). Leases→`host.generation`, replay/seq/incarnation/parseurs/partielles/statuts | D22 ; RED L3 lease+curseur pré-migration, écriture partielle, statut fragmenté |
| S3 P1 | Snapshot réconciliation périmé | Confirmé, point décisif. `reapOrphan` ne recompare que pgid+token, conservés au transfert | D23 : relecture owner+epoch juste avant signal ; RED réconciliation suspendue reprise après transfert |
| S4 P1 | Succession keeper | Confirmé (= A6) | D24 ; RED L4 migration→sortie→`SIGKILL`→même inode+attente servie |
| S5 P1 | macOS inexécutable, `skipped: 0` | Confirmé (= A2). `server.ts` Linux seul, suites ignorées hors Linux | BM + D27 : ensembles par plateforme, `skipped: 0` interne, preuves Linux conservées |
| S6 P2 | Panne coordinateur + timeout spike | Confirmé. Spike : `reject`/`ebadf` seuls, 0 timeout (`handover.test.mjs:31,37`) | D9 source corrigée (timeout = produit), D25 avant L3 ; RED tardif+doublons |
| S7 P2 | Dépassement file indéfini | Confirmé | D26 admission avant ACK + backpressure typée ; RED préparation puis vidange, master saturé |
| S8 P2 | Listes/gates + non-suivis | Confirmé (= A8). `git diff --stat` ignore les non-suivis | §5 : listes fermées avant lot + `git status --porcelain` obligatoire |
| S9 P2 | Retour fusionné « suffisant » faux | Confirmé (= A1 suite). v1 §7 retiré | D28 + §7 : rollback frontal B ≠ abandon B ; qualification avec sessions B actives |

## Écarts restants assumés

| Point | Statut |
|---|---|
| Relecteur contredit sur le fond | Aucun. Seule A9 affinée : l'interdiction d'image existait comme motif du 0 Python, pas comme règle générale |
| Chiffrage | Re-dérivé §9 v2 : 160–260 h agent, 10–16 tours (v1 : 102–176, 8–13). À recalibrer après B1 et BM |
| Code / tests exécutés | Aucun — tâche de rédaction seule. Aucune preuve verte revendiquée |
