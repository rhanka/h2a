---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 743340e031bc61959a1439ea27b096d199c687d5
observed-failure: "Identité exacte modèle/effort non fournie et transport de revue h2a installé interdit par le confinement. Aucun nouveau consensus de pairs revendiqué."
---

# PR #390 — R9 : convergence sous charge

Les deux constats R8 sont corrigés et qualifiés ci-dessous. Les revues Astra/Sol restent le contrat de réception ; aucune nouvelle revue indépendante n'est revendiquée. Seuils inchangés : **delta registre 1 500 ms, médiane 8 926 ms, p95 9 798 ms, sonde médiane 500 ms**. Les délais publication/démarrage/santé/RPC restent inchangés. Le lancement dans le processus CLI conserve son délai global de **15 s**, une annulation des RPC et un contrôle de l'horloge avant create.

## Rouge et cause

Archive propre de bf46d5128, construite par npm ci puis npm run build ; quatre instances sur les mêmes huit CPU, Node 22.22.1 :

- `rtk taskset -c 0-7 node "$TMPDIR/parallel.mjs" r9-red 1 4` → **exit 1**, quatre échecs, zéro skip. Une instance ne lance que **17/20** sessions, avec trois « host did not become ready » / ENOENT ; deux autres dépassent le plafond médian à **12 571 / 11 653 ms**. Le pilote privé lance quatre fois le fichier incident en parallèle ; son équivalent commis est indiqué ci-dessous.
- La trace privée relève **44–74 preuves par endpoint**, puis **3–16 candidats host** pour un seul gagnant. Une file retarde le premier lancement de **8 362 ms**, puis la publication de **2 668 ms**. Un refus ENOENT au terme de l'attente de disponibilité correspond ici à une publication encore retardée par la file de preuves et de démarrages.
- Profil du chemin encore forké, 80 reprises simultanées : **160 processus de sonde**, **80 de lancement**, et **70,4 s CPU** cumulées pour ces auxiliaires et les CLI appelantes. Sur huit CPU, cela consomme déjà **8,8 s**, avant les PTY et leurs CLIs. R8 libère bien le CPU des attentes de verrou ; il ne supprime pas ce travail.
- Régressions structurelles rouges : **16 candidats au lieu de 2**, **40 sondes au lieu de 20** dans une fixture (cible ensuite renforcée à zéro), **20 auxiliaires de lancement au lieu de zéro**. L'adoption d'un publisher sain pendant une autre vérification de santé expirait après **5 012 ms** ; le nouveau test passe sans attendre la libération de ce verrou.

## Correction bornée

1. Préparer le host avant les lectures préalables d'un run natif, avec un seul lanceur élu par endpoint. Le verrou d'élection est un socket abstrait distinct ; le child garde sa preuve et son verrou de publication. La mort du lanceur libère l'élection dans le noyau.
2. Pendant la contention, les autres lanceurs peuvent adopter un publisher sain en parallèle. Chaque adoption vérifie protocole, génération, pid et inode ; elle n'accorde jamais une preuve d'absence ni un droit de création. L'acquisition reste bornée à cinq secondes.
3. La sonde de nom et le lancement utilisent les mêmes opérations natives dans le processus CLI. Seul le verdict du **même nom** est réutilisé par le garde de conversation ; les autres propriétaires gardent leur sonde indépendante. Le garde relit les lignes de la conversation, refuse les lignes illisibles correspondantes et inventorie les propriétaires distants. Le lancement refait l'inventaire complet et l'admission clôturée avant toute création.
4. Fermer les connexions de préparation et d'inventaire, y compris l'endpoint compatible inutilisé. Le timer de 15 s ferme les RPC ; l'horloge est aussi vérifiée avant create pour empêcher une création tardive si le timer a été retardé.

Aucun changement de file-lock.ts, des preuves d'identité, des plafonds, des scopes systemd, des workflows, du lockfile de dépendances ou des assertions existantes. La cellule incident ajoute les assertions « un seul candidat remplaçant », « zéro sonde auxiliaire pour ce même nom » et « zéro auxiliaire de lancement ».

Les tentatives d'éviter des écritures d'identité identiques n'ont pas suffi et ont été retirées. L'élection seule et la seule suppression d'une sonde laissaient des rouges. Une première série longue du chemin partagé a aussi exposé l'attente sérialisée des contrôles de santé ; elle n'est pas comptée comme verte. La série finale utilise l'adoption parallèle et tous les garde-fous finaux.

## Qualification finale — cinq tours, quatre instances, CPU 0–7

Dans l'archive construite, avec TMPDIR privé :

```sh
rtk taskset -c 0-7 node scripts/owner-lab/incident-load.mjs 5 4
```

**Exit 0, 20/20 passages complets.** Chaque passage garde l'échauffement, la référence, trois fixtures de 214 lignes dont 100 background mortes, et toutes les assertions. Total : **100 fixtures, 2 000 reprises utilisables**, un host vivant par fixture, zéro timeout de verrou. Chaque journal TAP conclut `pass 1 / fail 0 / skipped 0`.

Temps en ms ; les trois durées chargées sont les sorties diagnostiques du test :

| Tour.instance | Référence | Trois tours chargés | Médiane | p95 | Delta | Verdict |
|---|---:|---|---:|---:|---:|---|
| 1.1 | 5570 | 5898 / 6232 / 6343 | 6232 | 6343 | +662 | PASS |
| 1.2 | 5535 | 5931 / 6003 / 6131 | 6003 | 6131 | +468 | PASS |
| 1.3 | 5500 | 5672 / 6131 / 6251 | 6131 | 6251 | +631 | PASS |
| 1.4 | 5704 | 5857 / 6209 / 6377 | 6209 | 6377 | +505 | PASS |
| 2.1 | 5737 | 5914 / 5909 / 6249 | 5914 | 6249 | +177 | PASS |
| 2.2 | 5765 | 5595 / 5899 / 6110 | 5899 | 6110 | +134 | PASS |
| 2.3 | 5772 | 5876 / 5902 / 6161 | 5902 | 6161 | +130 | PASS |
| 2.4 | 5752 | 5949 / 5774 / 5953 | 5949 | 5953 | +197 | PASS |
| 3.1 | 5216 | 5203 / 4763 / 4302 | 4763 | 5203 | -453 | PASS |
| 3.2 | 5633 | 5678 / 5584 / 5341 | 5584 | 5678 | -49 | PASS |
| 3.3 | 5539 | 5635 / 5521 / 5587 | 5587 | 5635 | +48 | PASS |
| 3.4 | 5378 | 5233 / 5566 / 5627 | 5566 | 5627 | +188 | PASS |
| 4.1 | 5599 | 5628 / 6127 / 6209 | 6127 | 6209 | +528 | PASS |
| 4.2 | 5761 | 5831 / 5703 / 6297 | 5831 | 6297 | +70 | PASS |
| 4.3 | 5624 | 5800 / 6159 / 6117 | 6117 | 6159 | +493 | PASS |
| 4.4 | 5672 | 5960 / 6112 / 6420 | 6112 | 6420 | +440 | PASS |
| 5.1 | 5746 | 5862 / 6061 / 6246 | 6061 | 6246 | +315 | PASS |
| 5.2 | 5747 | 5827 / 6083 / 6220 | 6083 | 6220 | +336 | PASS |
| 5.3 | 5797 | 5975 / 5980 / 6163 | 5980 | 6163 | +183 | PASS |
| 5.4 | 5763 | 5830 / 6131 / 6247 | 6131 | 6247 | +368 | PASS |

Le [pilote commis](../../scripts/owner-lab/incident-load.mjs) attend toutes les instances avant le tour suivant, garde un journal par instance et exige un vrai passage avec zéro skip. L'affinité du parent s'applique aux enfants.

## Solos et contrôle négatif

`rtk node scripts/owner-lab/incident-load.mjs 3 1` → **exit 0, 3/3 PASS**, chaque fois 20/20 utilisables, un host, zéro timeout, zéro skip.

| Solo | Médiane | p95 | Delta | Verdict |
|---|---:|---:|---:|---|
| 1 | 883 | 910 | +14 | PASS |
| 2 | 912 | 945 | +49 | PASS |
| 3 | 901 | 944 | +45 | PASS |

Mutation privée : insérer `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000)` après le shebang de l'archive `packages/h2a/dist/bin.js`, puis `rtk node --test packages/h2a/test/incident-20-resume.test.js`. **Exit 1 attendu : surcharge médiane 1 120 > 500 ms**, témoin node indépendant, zéro skip. Binaire restauré dans finally et identité des octets vérifiée.

## Autres contrôles

- Build du worktree et de l'archive : `rtk npm run build` → **exit 0**.
- Runtime, 13 fichiers ciblés, `--maxWorkers=2 --reporter=json` : **234 PASS, 0 FAIL, 0 pending/todo** : file-lock, registry, conv-guard, native-host, native-host-reuse, native-host-async, agy-launch, index, publication-proof, fleet, op-launch-abort, op-probe et upgrade.functional. Couverture nouvelle : annulation à 15 s, horloge expirée avant timer, absence de create après annulation, fermeture des deux endpoints et verdict unknown conservé.
- `rtk node --test packages/h2a/test/{publication-lock,native-host-crash-recovery,release-workflow,run-test-gates}.test.js` → **79 PASS, 0 FAIL, 0 skip**. Inclut libération de l'élection après SIGKILL et contrats publication, crash, release et trust-root inchangés.
- `rtk node scripts/audit-security-debt.mjs` → **exit 0**, `security debt gate passed: 0 moderate+ finding(s) exactly matched by the register.`
- Inspection des **130 modules JS** du runtime dist : **zéro import runtime→core**.
- Adaptation des mocks de trois suites au même verdict async : aucune assertion retirée. Invariants hôte : **16 PASS**, les **2 TODO historiques** restent inchangés. Une exécution supplémentaire de supervisor donne 16 PASS et **1 skip explicite historique** ; ce skip n'est pas inclus dans les 234 tests acceptés. Aucun saut dû à l'absence de l'état réel n'est accepté.
- Un lancement de Vitest en parallèle d'une fixture proc a découvert des copies par ses liens cwd sous .q ; cette invocation n'est pas comptée. Le rejeu cible uniquement les vrais fichiers (`--exclude '**/.q/**'`, aucune suppression de test) et passe.

La CI du SHA final, dont les matrices fresh/resume/restore, le contrôle +1 s et les cgroups effectifs, est suivie jusqu'à son état terminal dans le corps de PR. Aucun test de pression mémoire n'a été exécuté sur le poste.

Confinement : `/home/antoinefa/.cache-tmp/h2a-test/run-p7KIPs`, HOME/XDG/socket/proc privés, uniquement les processus créés par les fixtures. Les fixtures se suppriment à la fin des tests ; le TMPDIR de campagne est supprimé après la livraison et son absence vérifiée dans le compte rendu final. État réel, host installé, autres processus et diagnostics fournis intacts ; aucun Python, aucun trailer d'attribution.
