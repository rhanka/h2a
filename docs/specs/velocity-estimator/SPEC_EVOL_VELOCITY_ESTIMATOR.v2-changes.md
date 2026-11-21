# Révision v2 — traitement des revues

La [v2](SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md) traite les **9 P2 Astra et
7 P2 Sol**, dans leur ordre d'apparition. Les deux revues ne contiennent
aucun P1. Aucune remarque n'est réfutée : les lacunes sont confirmées par
la v1 et les sources ci-dessous. Les précisions et hypothèses nouvelles
restent des propositions techniques, jamais des décisions owner.

La [v1](SPEC_EVOL_VELOCITY_ESTIMATOR.md) reste intacte, SHA-256
`0ac733032712f4f8095df1785068c9765122c39e5c43db238da115993478996d`.
Revues : [Astra max](../rvveloa-last.md), SHA-256
`ea71ff39c24092a57195bb20926e5098021619be431668424942561a761aa6c7` ;
[Sol max](../rvvelos-last.md), SHA-256
`041d31951a9a3f5a5e8b4f272b8e5c6d820b0bdc07c8ef31dafde32d8e3b0f68`.

Les références H ci-dessous désignent les objets Git h2a à la révision
`46b82b42781709f2a2ab1bec6707ba58131248f0`, lus avec `rtk git show`.
Le checkout de sources est à `0d6b2eaf…` : ses fichiers de travail ne sont
donc pas substitués à la base examinée. Aucun dist installé n'a été lu.

| Réf. | Source vérifiée et portée de la preuve |
| --- | --- |
| O | [Décisions owner](../DECISIONS-owner.md), décision du 12/10 sur heures d'agent et tours de revue ; exclusion des non-tests désactivés le 12/10 ; réponses du 18/10 ~10:20 sur fusion/installé et questions de principes. [Brief commun](../brief-velo-common.txt) : propositions distinctes des exigences. |
| H1 | [cli-contract.test.js](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a/test/cli-contract.test.js#L18) : `node:test`, imports `../dist/…` ; motif `keepalive` à L1496. [Allowlist nominative](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/scripts/test-non-tests-0986.json#L3) : décision owner, fichier, nom complet et raison. |
| H2 | [Config agent-stats](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/agent-stats/vitest.config.ts#L3) et `packages/track/vitest.config.ts` : Vitest + setup d'isolation natif. [Bootstrap existant](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a/test/helpers/identity-isolated-run.mjs#L11) : mkdtemp, environnement enfant privé, build de sources et fichiers Node nommés ; sa liste de copie ne suffit pas pour agent-stats et les goldens. |
| H3 | [cli-command-map.test.js](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a/test/cli-command-map.test.js#L700) : égalité des verbes entre golden/contrat/tableau de test, puis comptes README/version-matrix. [Gate publique](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/scripts/check-public-contract.sh#L9) : build local obligatoire, environnement temporaire et comparaison CLI à L31. |
| H4 | [release-candidate.mjs](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/scripts/release-candidate.mjs#L61) : RC après smoke, `next`, intégrité des tarballs, attestation SHA/tree/version/run/attempt ; **aucun horodatage d'installation ni cible** dans le record à L77. [release.yml](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/.github/workflows/release.yml#L532) : installation/smoke existants, attestation à L634 et upload. `packages/h2a/test/ci-release-candidate.test.js` utilise aussi Node. |
| H5 | `git ls-tree` confirme les trois sources : `packages/h2a/skills/harness/plan/SKILL.md`, `packages/h2a/skills/harness/track-report/SKILL.md`, `packages/track/skills/track-report/SKILL.md`. La v1 n'en borne que « both SKILL surfaces ». |
| E | [État des contrats engram](/home/antoinefa/src/graphify/.graphify/scratch/design/memory-finalization/repo-knowledge-sol.out:18) : contrat métier et consommation encore `unverified`. [PR #400](https://github.com/rhanka/engram/pull/400), vérifiée via `rtk gh pr view 400 --repo rhanka/engram --json number,title,files,mergeCommit,url` : seulement `docs/evidence/live-git-qualification.md`, `plan/09-BRANCH_LIVE_GIT_INDEXING.md`, `scripts/bench-live.mjs`, `tests/live-read-side-timing.test.ts` ; merge `01697527c49e26a3d40d4917384f15d08fd36243`. Ce portage n'est pas le profil manquant. |
| K | [Réconciliation sentropic](/home/antoinefa/src/sentropic/.tmp/ci-knowledge-study/reconciliation.md:24), remarque 10 : quatre horloges. [Étude source](/home/antoinefa/src/sentropic/.tmp/ci-knowledge-study/study-astra.md:57) : exécution, collecte, publication, révision/configuration d'application ; profil unique à L84. |
| M | [Table Astra](analysis-astra.md), §B « Les 20 PR » ; [analyse Sol](analysis-sol.md), §B.2 et §D.2 ; [20 PR Sol figées](sample/h2a-20prs.json). Recalcul indépendant ci-dessous, sans réseau ni données d'agent. |

| Remarque | Vérification contre les sources | Traitement dans la v2 |
| --- | --- | --- |
| A1 · P2 — Tours de revue absents du résultat | **Confirmée.** O exige heures et tours ; §5/L3/L6 v1 ne définissent ni prévision de tours ni score au réalisé. T-V08 n'est qu'une preuve de rôle. | D4 définit `review-round/1` : une soumission/candidat/vague, plusieurs relecteurs parallèles dans un même tour, nouvelles soumissions distinctes, couverture explicite. §5 expose prévision et réalisé ; L2/T-V08 compte les tours et exige null sans preuve ; L3/T-V37 prévoit les comptes ; L6/T-V38 mesure l'écart et sa propre absence de données. |
| A2 · P2 — « Installé » non vérifiable | **Confirmée.** O sépare les jalons ; H4 qualifie une release et un runner, sans relier une installation à la cible du lot. | D2/§5 déclarent cible, version/tuple, intégrité, source release et inclusion du merge. L7 nomme les fichiers producteurs et le reçu ; `installedAt` est la fin du smoke réussi sur **cette cible**. T-V39 couvre échec, version/artefact/cible incorrects, smoke absent et filiation non prouvée. |
| A3 · P2 — Contrat engram bloquant non borné | **Confirmée.** E confirme le manque ; les quatre fichiers de #400 ne fournissent aucun profil métier. | L0 scindé : L0-D documentaire ; L0-C livraison upstream sous responsabilité gr-conductor, fichiers **nouveaux proposés** `profiles/repo-knowledge/1/*`, validation et fixtures exactes. Artefact `1.0.0` proposé, profil unique, adaptateur engram distinct, SHA de publication + SHA-256 dans le lock consommateur h2a, lecture hors ligne. T-V00-C prouve la consommation avant L1. |
| A4 · P2 — Receipts sans producteur planifié | **Confirmée.** La v1/L2 décrit un wrapper sans chemin ni raccord ; des receipts manuels pouvaient suffire à ses tests. | L2 ajoute `scripts/velocity-run.mjs`, `run-producer.ts`, ses tests et le raccord dans le skill de planification. Horloge/processus/IO injectés, début persisté avant dispatch, fin unique, erreurs et interruption distinguées ; destination explicite `.tmp/velocity-pilot/receipts/<runId>.jsonl`. T-V36 traverse le producteur réel, inclut un processus Node de test et une interruption sans fin normale. |
| A5 · P2 — Effet des poids indéfini | **Confirmée.** D5/D6/T-V13 v1 acceptent des poids mais ne définissent que le rang non pondéré ; `nEff` ne définit pas un quantile. | D6 conserve `nearest-rank/1` unitaire et fixe `weighted-ecdf/1` : seuil de poids cumulé, décimaux positifs validés, comparaisons rationnelles exactes. T-V13 exige P50/P80/P95 = 100 sur valeurs `[10,20,100]`, poids `[1,1,98]`, et rejette les poids invalides. |
| A6 · P2 — Vitest global incompatible avec L7 | **Confirmée.** H1/H2 : deux runners distincts ; les CLI importent leur build. | §6.0 donne commandes, cwd, build et bootstrap par package. Vitest pour agent-stats/Track ; `node --test <fichier>` pour h2a, après build de sources dans une copie temporaire. Le nouveau bootstrap est borné et testé en L0-C/T-V00-I. Aucun build absent ne vaut skip. |
| A7 · P2 — Goldens CLI manquants | **Confirmée.** H3 exige les ensembles de verbes et les deux comptes annoncés ; la gate compare aussi la liste CLI. | L7 inclut `docs/contracts/golden/cli-verbs.json`, `README.md`, `version-matrix.json`, plus tableau/happy path de `cli-contract.test.js`. Gate explicite `scripts/check-public-contract.sh` dans la lane isolée. Cette gate n'a pas été exécutée dans la présente révision. |
| A8 · P2 — G2 contredit l'exclusion owner | **Confirmée.** O/H1 excluent nommément `keepalive` des tests requis ; une règle globale « tout skip échoue » réintroduit cette dette comme gate. | G2 exige zéro skip nouveau/requis et distingue les non-tests préexistants par fichier + nom complet, depuis l'allowlist épinglée. Ils sont exclus et déclarés, sans compter comme succès. L'absence de build/runtime/fixtures ou d'état réel n'est jamais une exclusion admissible. |
| A9 · P2 — Questions fermées | **Confirmée.** O rejette les questions binaires de conception ; Q1 v1 annonce déjà A, Q2/Q3 imposent des alternatives. | §9 demande usages et critères de réussite, principes d'autorité/fraîcheur des capacités, conditions d'extension. Les mécanismes sont des exemples non exclusifs ; le petit lot h2a et le shadow sont des hypothèses techniques réversibles, sans choix owner prétendu. |
| S1 · P2 — Runners et skips incompatibles | **Confirmée**, mêmes preuves H1/H2/O qu'A6/A8. | §6.0 et G2 traitent les deux dimensions séparément : commandes ciblées par runner avec build et isolation ; non-tests nominaux conservés, jamais comptés en preuve. Aucun ajout à l'allowlist. |
| S2 · P2 — L0/L2/L5 insuffisamment bornés | **Confirmée.** E pour le contrat ; v1/L2 pour le wrapper sans fichiers ; H5 pour les trois skills. | L0-C donne upstream, artefact et pin ; L2 nomme producteur, raccord et RED T-V36 ; L5 énumère les **trois** chemins SKILL, le rôle de chacun et la consommation sans mutation upstream. Tous les nouveaux chemins sont signalés comme planifiés. |
| S3 · P2 — L7 ne mesure pas `merge_to_installed` | **Confirmée.** H4 fournit le capital à réutiliser ; T-V33–35 v1 restent des preuves de packaging. | L7 étend release.yml/attest, ajoute producteur et validation pure, reçu versionné horodaté/cible/artefact/merge ; T-V39 prouve producteur → attestation → actual. Publication seule, mauvais artefact, smoke absent ou preuve d'un autre environnement laissent `unknown`. Runner et poste propriétaire restent distincts. |
| S4 · P2 — Cible 4 h insensible au choix de cohorte | **Confirmée par recalcul**, M : mêmes trois proxies + Astra donnent P80 13:16:34, P95 30:20:01. Choisir la composition départ→fusion ne justifie pas la seule cohorte Sol. | §3.4/L1/T-V01 affichent **les deux** scénarios et leurs valeurs exactes sur proxies arrondis ; pas de cible unique de 4 h sans règle d'éligibilité fixée avant résultat. 60 combinaisons ≠ 60 observations ; aucun intervalle calibré ni engagement de capacité. |
| S5 · P2 — Quantiles pondérés non testables | **Confirmée**, même défaut qu'A5. Avec `[10,1000]` pondéré `[99,1]`, le rang non pondéré et la CDF pondérée divergent effectivement. | D6/T-V13 fixent P80/P95 pondérés à 10, contre 1000 à poids unitaires ; test d'invariance avec `['0.99','0.01']`, seuil exact et validation des poids. Les poids sont produits par une politique déterministe versionnée, pas inventés par l'IA. |
| S6 · P2 — Disponibilité temporelle omise | **Confirmée.** K distingue les quatre horloges ; « evidence closed before it » dans D8 v1 ne garantit pas sa disponibilité avant la prévision. | D8/§5 conservent exécution, collecte, publication et révision d'application, plus `firstAvailableAt` par révision de preuve. T-V14/T-V31 excluent un événement ancien divulgué/collecté plus tard, une publication tardive et une correction tardive. Sans snapshot historique attesté : rétrospectif descriptif ou abstention, jamais backtest prospectif prétendu. |
| S7 · P2 — Alternatives owner fermées | **Confirmée**, mêmes preuves O/v1 qu'A9. | §9 reformulé sur les principes, usages, critères de succès et conditions d'extension. Questions réellement ouvertes ; aucun « Pilot runs A first », aucun ordre inter-dépôts décidé au nom de l'owner. |

Précisions de réconciliation : H4 prouve qu'une attestation existe déjà,
mais pas qu'elle mesure déjà une installation cible horodatée. E confirme
le transfert de chronométrage de #400, sans contrat métier livré. Le
recalcul S4 utilise les trois proxies publiés **arrondis** ; les centièmes
de seconde affichés servent au rejeu, sans améliorer la qualité de ces
horloges faibles. Aucun de ces constats n'invalide une remarque de revue.

Une correction de cohérence supplémentaire concerne G5 : la v1 autorisait
`--force-with-lease` tout en interdisant le force-push. La v2 retire cette
contradiction conformément à la règle non négociable de cette mission ;
elle ne modifie aucune décision owner. Les limites de suite complète sont
aussi alignées sur « le conducteur une fois à l'intégration ».

Les seules écritures de cette mission sont la v2, ce tableau et
[spec-summary.md](spec-summary.md). Aucun code produit, aucun commit ni
push : le répertoire livré est un scratchpad hors dépôt Git. Les RED/GREEN
T-V00-C/I et T-V01–39 sont des **critères futurs**, pas des exécutions
revendiquées. L'implémentation, l'installation réelle, la calibration et
une nouvelle double revue de la v2 ne sont pas réalisées par cette tâche.

Contrôles exécutés depuis ce répertoire, tous avec sortie ci-dessous et
code de retour 0. Ce sont des contrôles de documents et des calculs de
référence ; **aucun test applicatif n'a été exécuté**. Les tests futurs
nommés dans la v2 ne sont donc pas déclarés GREEN.

```bash
rtk sha256sum SPEC_EVOL_VELOCITY_ESTIMATOR.md ../rvveloa-last.md ../rvvelos-last.md
```

```text
0ac733032712f4f8095df1785068c9765122c39e5c43db238da115993478996d  SPEC_EVOL_VELOCITY_ESTIMATOR.md
ea71ff39c24092a57195bb20926e5098021619be431668424942561a761aa6c7  ../rvveloa-last.md
041d31951a9a3f5a5e8b4f272b8e5c6d820b0bdc07c8ef31dafde32d8e3b0f68  ../rvvelos-last.md
```

```bash
rtk node - <<'NODE'
const fs = require('node:fs');
const sol = JSON.parse(fs.readFileSync('sample/h2a-20prs.json', 'utf8')).map(p => (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 1000);
const astra = fs.readFileSync('analysis-astra.md', 'utf8').split('\n').filter(l => /^\| \[#\d+\].*\| 10-/.test(l)).map(l => { const [h,m,s] = l.split('|')[4].trim().split(':').map(Number); return h*3600 + m*60 + s; });
for (const [name, cohort] of [['Sol', sol], ['Astra', astra]]) {
  if (cohort.length !== 20) throw new Error(name + ': expected 20 PRs');
  const sums = cohort.flatMap(s => [4.06,9.93,17.07].map(m => s + m*60)).sort((a,b) => a-b);
  console.log(name + ': n=20, combinations=60, P50/P80/P95 seconds=' + [.5,.8,.95].map(p => sums[Math.ceil(sums.length*p)-1].toFixed(1)).join('/'));
}
NODE
```

```text
Sol: n=20, combinations=60, P50/P80/P95 seconds=10642.6/14264.2/47794.2
Astra: n=20, combinations=60, P50/P80/P95 seconds=10729.6/47794.2/109201.2
```

```bash
rtk node - <<'NODE'
for (const [values, weights] of [[[10,20,100],[1,1,98]], [[10,1000],[99,1]], [[10,1000],[1,1]]]) {
  const total = weights.reduce((s,w) => s+BigInt(w), 0n);
  const results = [50n,80n,95n].map(p => { let sum=0n; return values.find((v,i) => { sum+=BigInt(weights[i]); return sum*100n >= p*total; }); });
  console.log('values='+values+' weights='+weights+' P50/P80/P95='+results.join('/'));
}
NODE
```

```text
values=10,20,100 weights=1,1,98 P50/P80/P95=100/100/100
values=10,1000 weights=99,1 P50/P80/P95=10/10/10
values=10,1000 weights=1,1 P50/P80/P95=10/1000/1000
```

```bash
rtk node - <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto');
const original=fs.readFileSync('SPEC_EVOL_VELOCITY_ESTIMATOR.md','utf8');
const revised=fs.readFileSync('SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md','utf8');
const changes=fs.readFileSync('SPEC_EVOL_VELOCITY_ESTIMATOR.v2-changes.md','utf8');
const summary=fs.readFileSync('spec-summary.md','utf8');
const check=(ok,message)=>{if(!ok)throw new Error(message);console.log('OK '+message)};
check(crypto.createHash('sha256').update(original).digest('hex')==='0ac733032712f4f8095df1785068c9765122c39e5c43db238da115993478996d','v1 digest unchanged');
const owner=s=>s.split('### 1.1 Owner requirements\n')[1].split('### 1.2')[0];
check(owner(original)===owner(revised),'owner requirements unchanged');
const ids=[...changes.matchAll(/^\| ([AS]\d+) · P2/gm)].map(m=>m[1]);
check(ids.length===16 && new Set(ids).size===16 && ['A1','A2','A3','A4','A5','A6','A7','A8','A9','S1','S2','S3','S4','S5','S6','S7'].every(x=>ids.includes(x)),'16 unique review rows: 9 Astra + 7 Sol');
check((fs.readFileSync('../rvveloa-last.md','utf8').match(/\*\*P2/g)||[]).length===9 && (fs.readFileSync('../rvvelos-last.md','utf8').match(/\*\*P2/g)||[]).length===7,'review inventory matches source files');
const tests=[...revised.matchAll(/\*\*(T-V\d+(?:-[A-Z])?) /g)].map(m=>m[1]);
check(tests.length===41 && new Set(tests).size===41,'41 unique future acceptance IDs: T-V00-C/I and T-V01-39');
check(summary.includes('(SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md)')&&summary.includes('(SPEC_EVOL_VELOCITY_ESTIMATOR.v2-changes.md)'),'French summary links to v2 and treatments');
for(const [name,text] of [['SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md',revised],['SPEC_EVOL_VELOCITY_ESTIMATOR.v2-changes.md',changes],['spec-summary.md',summary]]) {
  check(!text.split('\n').some(l=>/[ \t]+$/.test(l))&&!/^(<{7}|={7}|>{7})/m.test(text),'no trailing whitespace or conflict markers: '+name);
}
NODE
```

```text
OK v1 digest unchanged
OK owner requirements unchanged
OK 16 unique review rows: 9 Astra + 7 Sol
OK review inventory matches source files
OK 41 unique future acceptance IDs: T-V00-C/I and T-V01-39
OK French summary links to v2 and treatments
OK no trailing whitespace or conflict markers: SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md
OK no trailing whitespace or conflict markers: SPEC_EVOL_VELOCITY_ESTIMATOR.v2-changes.md
OK no trailing whitespace or conflict markers: spec-summary.md
```
