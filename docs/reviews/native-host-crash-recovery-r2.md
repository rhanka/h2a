# Reprise du host natif — qualification R2

Brief : `brief-fixrestart-r2.md`, règles du propriétaire du 11–19 octobre.
Les deux diagnostics Astra et Wonder ont été lus jusqu'à leur dernière section,
sans modification. La PR #382 reste à `5e117c847` ; aucune écriture sur sa branche.

| P0 Astra §7 | Preuve et portée |
|---|---|
| Filtrage avant sondes | Vrai `run --resume`, 500 lignes dont une pertinente : une sonde du propriétaire correspondant, aucune conversation étrangère, premier acquittement CLI observé. Une ligne correspondante illisible refuse avant toute CLI. |
| Convergence du verrou | Le premier tour échouait encore sur dix preuves concurrentes sans suppression : 4 succès, 6 expirations en 5 208 ms. Après correction : dix succès en 294 ms et socket conservé. Le raccourci exige sidecar du cadre courant, inode identique et tous les propriétaires positivement morts ; preuves inconnues/legacy gardent la fenêtre complète. |
| Isolation effective | [CI sur VM Ubuntu jetable](https://github.com/rhanka/h2a/actions/runs/39522995167/job/118971029314), sources `de8acea42`, checkout de fusion `e4f36193bffaef9f8c4cfb44bfcfa84c7e83e9d4` : un test passé, aucun skip. Scope lanceur tué ; host et PTY survivants. Worker plafonné à 128 Mio, swap 0, événement noyau `oom_kill=1` ; host inchangé et deux humains répondant après la faute. |
| Condition de publication | `release.yml` attend le workflow de qualification systemd et les trois jobs de démarrage sur le SHA résolu de la release. La matrice tourne hors des suites parallèles ordinaires pour mesurer sur des VM dédiées. Trois mutations vérifient les témoins de filtre, contention et séparation worker avant le témoin vert. |

Commande locale avec préfixe `rtk env TMPDIR="$RUN"`,
`RUN=/home/antoinefa/.cache-tmp/h2a-test/run-NDLCse` :

```sh
node --test --test-name-pattern='real run|real resume|read-only absence' packages/h2a/test/native-host-crash-recovery.test.js
# Avant correction du verrou : 2 pass, 1 fail, 0 skipped.
# Après : read-only absence + cinq reprises concurrentes : 2 pass, 0 fail, 0 skipped.
# Dix preuves : elapsedMs=294, codes=[0,0,0,0,0,0,0,0,0,0].

./node_modules/.bin/vitest run packages/h2a-runtime/src/native-terminal/host-scope.test.ts
# Avant séparation des sessions : 5 pass, 1 fail, 0 skipped.

./node_modules/.bin/vitest run packages/h2a-runtime/src/native-terminal/host-scope.test.ts packages/h2a-runtime/src/native-terminal/publication-proof.test.ts
# Après : 2 fichiers, 35 tests passés, aucun skip.

H2A_LAB_BASELINE_GUARD="$RUN/rc4-conv-guard.mjs" node --test --test-name-pattern='real run --resume' packages/h2a/test/native-host-crash-recovery.test.js
# Garde extrait immuable du tag rc.4, chargé dans le vrai run par hook de test.
# 1 fail, 0 skipped : encore en sondes étrangères après 5 000 ms.
# Le même témoin avec 451 lignes : 1 fail, 0 skipped ; reprise non terminée.
# Il isole le défaut du garde rc.4, pas l'installation npm historique complète.

./node_modules/.bin/vitest run packages/h2a-runtime/src/native-terminal/fleet.test.ts packages/h2a-runtime/src/native-terminal/server.test.ts packages/h2a-runtime/src/native-terminal/host-scope.test.ts packages/h2a-runtime/src/native-terminal/publication-proof.test.ts packages/h2a-runtime/src/restore-provenance.test.ts
# 5 fichiers, 89 passés, aucun skip.

node --test packages/h2a/test/native-host-crash-recovery.test.js
# 11 passés, 0 fail, 0 skipped ; 52 589 ms.
# 451 lignes : frais 2 004 ms, reprise 2 748 ms, deux échanges CLI.
# Host-start 812 ms ; dix preuves 295 ms ; cinq reprises crash 3 215 ms.

node --test packages/h2a/test/release-workflow.test.js packages/h2a/test/release-workflow-publish-order.test.js
# Avant adaptation du contrat pour le nouveau gate : 29 pass, 3 fail, 0 skip.
# Après : 32 pass, 0 fail, 0 skipped.

node --test --test-name-pattern='C9 A01/A03/A04' packages/h2a/test/run-test-gates.test.js
# Vérification de l'inventaire obligatoire : 1 pass, 0 fail, 0 skipped.
```

La répétition à dix lanceurs a encore reproduit un refus lorsque le successeur
était vivant mais pas encore publié. Fleet/op attendent maintenant, pendant
le budget de santé, uniquement des handshakes sains après un verdict positif
`H2A_ENDPOINT_LIVE_OWNER` : aucun nouveau verdict d'absence ni second host
autorisé par ce retry. Test Fleet rouge avant, vert dans les 89 tests ci-dessus.

Le smoke empaqueté bloquait aussi sur un préfixe de trame rescanné à chaque
fragment. Témoin de 1 984 octets : 64 480 octets rescannés avant, travail
linéaire après. Les 32 Mio du smoke restent en CI ; [smoke vert après correction](https://github.com/rhanka/h2a/actions/runs/39522821108).

## Cgroups et protection effectivement obtenue

Chemins lus dans `/proc/<pid>/cgroup` sur la VM, UID 1001 :

```text
launcher: /user.slice/user-1001.slice/user@1001.service/app.slice/h2a-session-3526-….scope
host:     /user.slice/user-1001.slice/user@1001.service/app.slice/h2a-native-3557-….scope
worker:   /user.slice/user-1001.slice/user@1001.service/app.slice/h2a-session-3786-….scope
memory.max=134217728 ; memory.swap.max=0
memory.events: max 21 ; oom 1 ; oom_kill 1
tests 1 ; pass 1 ; fail 0 ; skipped 0
conversation-filter: RED detected (exit 1); artifact restored
publication-contention: RED detected (exit 1); artifact restored
worker-scope: RED detected (exit 1); artifact restored
```

Le premier témoin CI atteignait `memory.high` sans atteindre la limite dure
dans son budget : 1 échec, 0 skip. Le témoin corrigé désactive uniquement le
seuil souple de **son worker jetable** après lecture du plafond dur, puis
alloue au plus 160 Mio. Aucun timeout n'a été augmenté. La preuve porte sur
un OOM de cgroup, pas sur une saturation globale ni un kill par oomd.

En production, chaque arbre CLI est déplacé avant son exécution dans un scope
frère du host. Plafond : min(8 Gio, RAM physique/4), seuil souple 80 % de ce
plafond, swap 0. `H2A_NATIVE_SESSION_MEMORY_MAX` permet seulement d'abaisser
le plafond, avec minimum 16 Mio. Un échec de placement d'une session empêche
son exécution dans le scope protégé du host. Le gardien PTY reste dans le
scope du host : groupe de processus et signal de mort parent conservés.

Sans systemd, le host utilise le détachement historique et journalise que
host/sessions partagent le cgroup hérité, sans plafond de session. Le témoin
de refus vérifie qu'une CLI n'est pas exécutée si son propre placement échoue.
`ManagedOOMPreference=avoid` reste une préférence ; il n'y a pas de garantie
contre une saturation globale par la somme de nombreux workers sous plafond.

Le poste propriétaire a seulement servi aux CLI déterministes et aux fichiers
privés. `unshare` a refusé, trois tentatives `bwrap` ont refusé, cgroups en
lecture seule : aucune faute mémoire ni manipulation de cgroup locale.
Le test destructif refuse hors runner GitHub hébergé ; son invocation locale
est un échec explicite (1 fail, 0 skip), avant création de tout enfant.

## Mesures de démarrage

La matrice mesure frais, reprise et vrai `restore`, pour 0/50/500 lignes
historiques, 1/5/10 demandes, host vivant/absent/tué après handshake.
Chaque cellule contient trois comparaisons appariées avec la même CLI locale
déterministe : prêt puis entrée acquittée. p95 est donc le maximum des trois
échantillons, pas une estimation de production. Le budget de registre est
+500 ms sur la médiane par rapport au registre vide.

Pour `restore`, N lignes humaines nécessaires aux N restaurations s'ajoutent
aux 0/50/500 lignes historiques ; le total exact est émis dans chaque mesure.
Le terminal graphique est remplacé par un processus privé qui exécute les
commandes réellement produites par `restore`. Aucun `restore --dry-run` ne
sert de preuve d'utilisation ; GNOME n'est pas qualifié par ce témoin.
Les lignes historiques couvrent humain/background/legacy/terminé/worktree/
identité indéterminée. Elles sont dans d'autres projets ; `restore
qualification-owner` sélectionne explicitement le groupe des N cibles.
Les CLI sont lancées avec `--bare --no-gw --no-h2a` et les onglets factices
ajoutent `--background --no-attach`. Fournisseurs réseau et sidecars ne sont
pas inclus dans ces latences.

Le premier balayage a révélé deux défauts du laboratoire : le kill pouvait
précéder l'écriture de `.owner` (corrigé en attendant `ping`), et un cas
reprise/5/vivant/50 a dépassé le budget de registre (+565 ms, conservé comme
échec). Les campagnes intermédiaires ont aussi exposé le successeur vivant
mais pas encore publié et des deltas restore de +651/+789/+892 ms ; l'âge des
lignes durables ne les excluait pas du layout. Le témoin final sélectionne
son groupe pour mesurer exactement N restaurations, et tourne sur une VM
distincte des autres suites. Aucune de ces erreurs n'a été transformée en
skip ni corrigée en augmentant le budget de +500 ms. Les seuls tableaux de
qualification finale ci-dessous proviennent du checkout CI figé.

Campagne CI [39522995167](https://github.com/rhanka/h2a/actions/runs/39522995167), sources de8acea42, fusion e4f36193bffaef9f8c4cfb44bfcfa84c7e83e9d4 : **81 configurations, 243 paires, 27 tests passés, zéro skip**. Maximum du delta médian de registre : frais +427 ms, reprise +126 ms, restore +192 ms.

Temps en ms. Cellules 0/50/500 : **médiane/p95 [sondes/op.js/Node maximum]**. La dernière colonne est la médiane/p95 des écarts appariés h2a − CLI directe, avec 500 lignes.

### Frais

| Demandes | Host | 0 lignes | 50 lignes | 500 lignes | Δ500 | Surcoût CLI directe |
|---:|---|---|---|---|---:|---|
| 1 | vivant | 948/1012 [4/7/9] | 946/961 [4/7/9] | 938/957 [4/7/9] | -10 | 897/911 |
| 1 | absent | 1057/1057 [4/7/12] | 1057/1065 [4/7/12] | 1064/1065 [4/7/12] | 7 | 1021/1023 |
| 1 | tué | 1045/1069 [4/7/12] | 1056/1060 [4/7/12] | 1065/1080 [4/7/12] | 20 | 1023/1038 |
| 5 | vivant | 2270/2322 [20/35/45] | 2309/2351 [20/35/45] | 2304/2314 [20/35/45] | 34 | 2230/2242 |
| 5 | absent | 2657/2677 [20/35/54] | 3084/3111 [20/35/55] | 2582/2608 [20/35/51] | -75 | 2524/2533 |
| 5 | tué | 2506/2829 [20/35/53] | 2641/2807 [20/35/51] | 2609/3108 [20/35/58] | 103 | 2538/3035 |
| 10 | vivant | 4545/4644 [40/70/90] | 4536/4547 [40/70/90] | 4579/4616 [40/70/90] | 34 | 4468/4500 |
| 10 | absent | 4641/4743 [40/70/99] | 4640/4703 [40/70/100] | 4612/4663 [40/70/98] | -29 | 4500/4556 |
| 10 | tué | 4727/4769 [40/70/98] | 4656/4697 [40/70/101] | 4701/4836 [40/70/98] | -26 | 4586/4717 |

### Reprise

| Demandes | Host | 0 lignes | 50 lignes | 500 lignes | Δ500 | Surcoût CLI directe |
|---:|---|---|---|---|---:|---|
| 1 | vivant | 1112/1213 [4/7/9] | 1116/1136 [4/7/9] | 1188/1194 [4/7/9] | 76 | 1136/1152 |
| 1 | absent | 1201/1210 [4/7/12] | 1194/1214 [4/7/12] | 1232/1236 [4/7/12] | 31 | 1189/1193 |
| 1 | tué | 1207/1221 [4/7/13] | 1204/1233 [4/7/13] | 1226/1243 [4/7/12] | 19 | 1184/1201 |
| 5 | vivant | 2623/2642 [20/35/45] | 2653/2727 [20/35/45] | 2679/2722 [20/35/45] | 56 | 2599/2636 |
| 5 | absent | 2930/3157 [20/35/54] | 2931/2944 [20/35/52] | 2940/3139 [20/35/52] | 10 | 2869/3069 |
| 5 | tué | 2959/2974 [20/35/52] | 2934/2967 [20/35/51] | 2946/2956 [20/35/50] | -13 | 2862/2868 |
| 10 | vivant | 5391/5393 [40/70/90] | 5370/5382 [40/70/90] | 5467/5502 [40/70/90] | 76 | 5331/5372 |
| 10 | absent | 5550/5708 [40/70/105] | 5545/6343 [40/70/111] | 5552/5704 [40/70/101] | 2 | 5421/5585 |
| 10 | tué | 5515/5657 [40/70/99] | 5519/5588 [40/70/98] | 5641/5706 [40/70/100] | 126 | 5507/5564 |

### Restauration

| Demandes | Host | 0 lignes | 50 lignes | 500 lignes | Δ500 | Surcoût CLI directe |
|---:|---|---|---|---|---:|---|
| 1 | vivant | 1702/1812 [5/9/14] | 1695/1749 [5/9/14] | 1699/1702 [5/9/13] | -3 | 1658/1660 |
| 1 | absent | 1762/1800 [5/9/16] | 1778/1786 [5/9/16] | 1805/1807 [5/9/16] | 43 | 1764/1764 |
| 1 | tué | 1780/1799 [5/9/17] | 1770/1799 [5/9/17] | 1803/1839 [5/9/16] | 23 | 1762/1798 |
| 5 | vivant | 3320/3352 [25/41/53] | 3344/3348 [25/41/53] | 3363/3441 [25/41/53] | 43 | 3282/3358 |
| 5 | absent | 3584/3596 [25/41/59] | 3609/3630 [25/41/60] | 3647/3677 [25/41/60] | 63 | 3580/3607 |
| 5 | tué | 3628/4142 [25/41/65] | 3647/3812 [25/41/60] | 3820/3842 [25/41/62] | 192 | 3741/3761 |
| 10 | vivant | 6202/6271 [50/81/103] | 6266/6268 [50/81/103] | 6242/6261 [50/81/103] | 40 | 6116/6131 |
| 10 | absent | 6364/6484 [50/81/117] | 6354/6398 [50/81/110] | 6457/6668 [50/81/122] | 93 | 6342/6558 |
| 10 | tué | 6299/6306 [50/81/106] | 6416/6501 [50/81/112] | 6474/6632 [50/81/120] | 175 | 6343/6503 |



Les auxiliaires comptés sont les processus Node enregistrés, avec les
opérations `op.js` et les sondes identifiées séparément. Ce comptage ne prétend
pas tracer chaque court processus shell/utilitaire natif. Le coût absolu
mesuré face à la CLI directe doit rester visible : un registre borné ne
constitue pas une preuve de parité avec la CLI sans h2a. **La parité absolue
n'est pas atteinte** : à une demande et 500 lignes, host vivant, l'écart
apparié médian est +897 ms frais, +1 136 ms reprise, +1 658 ms restore.

## Provenance et coordination #382

Le nouveau test `restore-provenance.test.ts` crée une ancienne ligne d'agent
avec nom ordinaire et transcript Codex réel de laboratoire. Le même contrat
sur `restore.ts` de rc.4 échoue : `legacyAgentWithTranscript=human`, attendu
`background`, code 1. La branche conserve le refus par défaut et l'acceptation
sur confirmation explicite ; les marqueurs de délégation priment sur une
ancienne classe humaine, sans heuristique de nom ni de chemin.

À conserver/ajouter par #382 : provenance explicite de l'initiateur humain ou
agent au lancement ; propagation par hooks, reprise et délégation ; aucune
promotion legacy par transcript/tmux ; récupération explicite des cas
indéterminés sans suppression de leur historique. `attachedTerminal=true`
ne prouve pas un initiateur humain et ne doit pas suffire à lui seul.
L'activité humaine peut compléter la provenance, sans rétroactivement
transformer un lancement d'agent en lancement du propriétaire.

## Limites et revue

Pas de qualification du reset AMD, d'admission mémoire globale, de TTL
d'agents, de saturation multitravailleur, ni de migration du registre réel.
Les états du propriétaire, le binaire installé et les processus tiers n'ont
été ni lus ni modifiés. Les diagnostics et le script non suivi antérieur
`scripts/owner-lab/restart.test.mjs` sont conservés sans changement.

```yaml
status: selection-failed
target-ref: de8acea42
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: exact author metadata unavailable; owner rules forbid dispatch through the installed h2a and real host state
legs: []
```

Ce dossier ne revendique aucun consensus indépendant d'implémentation.
La compétence [harness/review](/home/antoinefa/.codex/plugins/cache/sentropic/h2a/0.98.7/skills/harness/review/SKILL.md)
exige « Unknown author means no acceptable review » et prescrit
`selection-failed` : modèle exact et effort auteur indisponibles ; aucun
contournement via l'installation propriétaire.
Le répertoire privé sera supprimé après conservation des preuves et opérations
Git ; la suppression sera vérifiée dans le compte rendu final.
