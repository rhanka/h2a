# Dossier diagrams implementation

Spec: `SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md`, SHA-256
`34b0b43a1f7edbde8805f59dbc6789c1d85f0a3f8ee00d1c56d11e9b13ee0b37`.
The two supplied independent spec reviews say GO-CODE. They do not review this code.

## External dependency boundary

H2 needs distributable `@sentropic/diagram-core@0.1.0` and
`@sentropic/diagram-canvas@0.1.0`. On 2026-10-18 both `npm view <name>
version --json` commands returned E404. The DS `origin/main` canvas manifest
still declares `private:true`. No reproducible, pinned DS2 tarballs were supplied.
H2 adoption stops at this boundary; H3 also needs DS4/DS5 renderer controls,
projections/publication and controlled heat-map exports. No engine fork is made.

DS conductor handoff: deliver public type/runtime exports, exact dependency
tarballs and hashes, measurement and diagnostics contracts, and a fresh isolated
consumer layout/replay witness. H2 resumes with those artifacts; DS3 qualifies
geometry, DS4 supplies the four in-canvas control families. Focus supplies closed
choice/reference bindings; the DS renderer owns placement, hit/focus regions,
pan/zoom/resize, camera and atomic scene publication. A page toolbar is insufficient.

## Review selection

```yaml
status: selection-failed
target-ref: a2bd27b40 (source/portable assets complete)
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: Exact author metadata is unavailable; installed h2a/live mesh dispatch is forbidden by owner confinement.
```

No independent implementation consensus or merge gate is claimed.

## Rapport de livraison

| Lot | Résultat | Commits principaux |
| --- | --- | --- |
| H1 contrat | Version 2, intégrité des octets/locateurs ; v1 intact | 6203d5c, 6873e73, 2c03632, 96db4f9, 72fedf5 |
| H1 lecture/exports | Résumés budgétés ; index des pièces partout | ed07e87 |
| H1 build/UI | Publication atomique, preuves hors ligne, recherche annulable, retour clavier | 467e6b2, dc14060, 74a6c6e, ac046d2 |
| H1 G5a | Corpus réel figé, calibration puis budgets numériques | c10ecbe, 250804d |
| H4-H1 | Registre/méthode, tarballs isolés, template → build → ouverture, assets/vendor | 3d05e4d, 35d4cce, 66bcb90, 8fcbf22, 1760cf0 |
| H2 | Contrat préparé ; adoption bloquée par DS2 | a2bd27b |
| H3 | Bloqué par H2 + DS4/DS5 ; aucun faux contrôle hors canvas | contrat DS ci-dessus |

Chaque fichier a été lancé séparément. Les commandes Focus ont pour cwd
`packages/focus`, les autres la racine. Le lanceur local
`rtk node tmp/diagcode-run.mjs <commande>` crée HOME/XDG/TMP sous mkdtemp et
retient argv, cwd, code et sortie complète dans
`/home/antoinefa/.cache-tmp/diagcode-evidence-Ds69T6/run-*/{command.json,output.log}`.
Toutes les commandes ci-dessous portent le préfixe `rtk`.

| Commande exacte | RED observé / capital conservé | GREEN | Journaux RED → GREEN |
| --- | --- | --- | --- |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/evidence.spec.ts` | 21 échecs / 22 ; puis gros base64 : 1 échec / 23 | 23/23, exit 0 | run-Ln8SAT, run-f8QTcQ → run-bUyJ9o |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/schema.spec.ts` | 1 échec / 43 : identité v2 absente du stub importable | 43/43, exit 0 ; hash v1/ancien validateur | run-1tTCJo → run-OioQo9 |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/readability.spec.ts` | 2 échecs / 71 : résumés/explications | 71/71, exit 0 | run-JJw6Lw → run-QcAZwB |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/render.spec.ts` | 1 échec / 21 : citations perdues | 21/21, exit 0 | run-4GBc5x → run-EIOosi |
| `node --test packages/h2a/test/focus-build.test.js` | 7 échecs / 33 : enveloppe, diagnostics, écriture partielle | 33/33, exit 0 | run-WKmSXL → run-vma8Z3 |
| `node --test packages/h2a/focus-kit/test/evidence-browser.test.mjs` | Index absent : 1/1 échoue ; focus recherche : 1 échec / 2 | 2/2, exit 0 ; 320/390/1440px, package installé | run-YOz4In, run-qxXNS5 → run-Tzq2qk |
| `node --test packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs` | Contrôle négatif sans fenêtre : `Bounded lines: 20001`, exit 1 | 1/1, exit 0 ; 30 ouvertures/taille, 30 citations/recherches, 40k lignes | run-27MXPc → run-f2CBud |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/packaging.spec.ts` | 1 échec / 10 : registre v2 absent | 10/10, exit 0 | run-meiHmq → run-bfuOUu |
| `npm exec --offline -- vitest run --config vitest.config.ts tests/registry.spec.ts` | Capital conservé, pas relabellisé RED | 50/50, exit 0 | run-huPvwo |
| `node --test packages/h2a/test/distribution-increments.test.js` | Complément H4 | 1/1, exit 0 ; import guard, zéro alias source | run-5VvZgD ; ouverture : run-Tzq2qk |
| `node --test packages/h2a/focus-kit/test/browser.test.mjs` | Capital v1 conservé | 6/6, exit 0, zéro skip | run-j1nkIT |

Le RED de performance est un contrôle négatif explicite, pas une mesure de
latence contre l'ancien format refusé. Le renderer normal est restauré puis
régénéré ; aucun budget n'a été assoupli. Le défaut RSS de calibration était
un enfant Chromium zombie sans pages résidentes : il compte zéro ; une mesure
absente sur un processus vivant échoue. Le skill `h2a:debug` a guidé le diagnostic.

| Gate statique | Sortie observée |
| --- | --- |
| `rtk npm run build:h2a` | exit 0 ; tsc -b, vendor-engram-live mirror OK ; run-J5Jsvh |
| `rtk npm exec --offline -- tsc -p packages/focus/tsconfig.json --pretty false` | exit 0 ; run-12amS9 |
| `rtk node scripts/check-focus-vendor.mjs` | exit 0 ; byte-identical to a fresh build ; run-lP2zGg |
| `rtk node scripts/build-focus-dossier.mjs --check` | exit 0 ; sources and portable asset: verified ; run-Tmf0zR |
| `rtk git diff --check -- . ':(exclude)packages/h2a/focus-kit/renderer.html'` | exit 0 ; le JS généré contient une chaîne littérale de whitespace Svelte, non réécrite à la main |

Mesures finales/hashes : [metrics.json](dossier-diagrams/metrics.json).
Grand artifact : 31 sources, environ 30,9 Mo HTML, 22,9 Mo de preuves.
P95 : ouverture 1062,7 ms, citation 82,8 ms, recherche 60,0 ms ; RSS crête large
723,4 Mo, croissance retenue 28,4 Mo. Maximum 80 lignes, moins de 400 éléments
de preuve. Node 22.22.1, Chromium 153.0.8010.12, Playwright 1.63.0.

## CI, écarts et NON couvert

Le SHA testé, les URLs et états par job CI figurent dans la description de PR
et le rapport final. Pas de suite complète locale, publication npm, merge ou
modification de main. Aucun skip pour état réel absent.

NON couvert : H2 géométrie/mesure DS et CDN ; H3 exploration liée/contrôles DS ;
lots DS/engram/sentropic et véracité métier CI/CD ; PDF/SVG actif ; qualification
mémoire multi-navigateur ; consensus indépendant de code. Modèle/registre breaking
pour les anciens consommateurs ; la release reste au conducteur.

Écarts : corpus réel h2a figé, groupé sans répétition de remplissage, pour éviter
une dépendance au kit sentropic local évolutif. Fermeture tarball dans
`distribution-increments.test.js`, ouverture dans `evidence-browser.test.mjs`
pour garder Playwright dans le job Focus. Gros fichiers générés au-delà des
limites du skill de planification (BRDG-EX1/2/3). Revue de code selection-failed :
dispatcher installé interdit et métadonnées exactes d'auteur indisponibles.
H2/H3 arrêtés aux dépendances, conformément à la consigne propriétaire.

## Correction CI — fermeture npm sans métadonnées préchauffées

Le premier job [portable-focus](https://github.com/rhanka/h2a/actions/runs/39166628137/job/117790817300)
sur `1f73a67b8` échoue : `ENOTCACHED @hono/mcp` lors de l'installation hors
ligne. Le cache local masquait une résolution de registre non verrouillée.
Le témoin utilise maintenant la fermeture exacte de package-lock, remplace les
liens workspace par les trois tarballs construits, et complète les entrées
abrégées uniquement depuis le même nom/version/intégrité déjà verrouillé.
Les outils de développement des workspaces ne font pas partie du consommateur.

Le test prépare désormais un cache temporaire de 281 tarballs de la plateforme,
avec **zéro entrée de métadonnées registre**. Une pièce absente fait échouer le
témoin. RED local supplémentaire : `ENOTCACHED commander`, run-23dgJg ; aucun
accès réseau ni fallback n'a été ajouté pour le contourner.

| Commande exacte | Sortie finale |
| --- | --- |
| `rtk node --test packages/h2a/test/distribution-increments.test.js` | 1/1 pass, exit 0, zéro skip ; `281 platform tarballs, zero registry metadata entries` ; run-itysZ3 |
| `rtk node --test packages/h2a/focus-kit/test/evidence-browser.test.mjs` | 2/2 pass, exit 0, zéro skip ; installation puis ouverture hors ligne ; run-bNvPMe |

Cette correction concerne le témoin de distribution ; les sources du renderer,
le corpus et les budgets mesurés sont identiques à la qualification retenue.

Le second passage CI [portable-focus](https://github.com/rhanka/h2a/actions/runs/39167019714/job/117791975564)
sur `13a7c3911` révèle un faux prérequis : la préparation copiait encore les
tarballs du dépôt complet, dont un outil de développement musl absent du runner
glibc. Le cache est maintenant dérivé de la fermeture runtime du consommateur,
avec le même filtrage os/cpu/libc que l'installation de la plateforme ; aucune
pièce runtime manquante n'est ignorée et aucun accès réseau n'est ajouté.

Mêmes commandes ciblées : distribution **1/1**, navigateur **2/2**, exit 0,
zéro skip ; `190 platform tarballs, zero registry metadata entries`.
Sorties finales : run-3Z4iin et run-cWTbRb.

## Corpus technique reproductible en CI

Le troisième job [portable-focus](https://github.com/rhanka/h2a/actions/runs/39167209665/job/117792536870)
sur `a08664688` passe l'installation isolée et tous les tests navigateur, puis
refuse le corpus : un ancien fichier de configuration suivi par Git est absent
après le bootstrap CI. Cette absence n'a jamais été comptée comme skip ou GREEN.

Le corpus est désormais borné à **1 731 fichiers techniques** (sources,
documentation et workflows). Leurs blobs Git et SHA-256 sont figés ; le générateur
lit les objets Git en batch, sans lire des configurations de machine ou des
fichiers modifiés par le bootstrap. Un blob absent ou un digest incorrect échoue.
Les blobs inchangés appartiennent à l'arbre du checkout, sans fetch d'historique.

Calibration répétée, hashes de corpus/générateur actualisés, puis qualification
30/30 répétée avec des **budgets numériques strictement identiques**. Commande :
`rtk node --test packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs`.
Sortie : **1/1 pass, exit 0, zéro skip**, run-BttLAh ; mesures finales dans
`dossier-diagrams/metrics.json`. Les anciennes preuves restent dans l'historique.
Le job Focus conserve aussi le JSON brut de ses propres mesures, avec les hashes
d'entrée/HTML/politique, dans l'artifact `focus-evidence-metrics-<SHA>` de la CI.

## Derniers témoins : mémoire et retour d'annexe

Le [job Focus sur ef0228a41](https://github.com/rhanka/h2a/actions/runs/39167686130)
passe tous ses gates. Le passage suivant expose une course de mesure, sans
dépassement numérique : VmRSS peut disparaître avant l'état zombie. Le même PID
doit alors confirmer sept compteurs `statm` nuls. Un processus encore résident,
une mesure malformée ou indisponible restent des échecs. Un défaut de monitoring
conserve désormais les données brutes avant le refus, et l'échec d'initialisation
ferme aussi le navigateur possédé.

| Commande | RED → GREEN |
| --- | --- |
| `rtk node --test packages/h2a/focus-kit/test/evidence-memory.test.mjs` | 2 échecs / 6, run-JBmAL5 → 6/6, exit 0, run-XH8avc |
| `rtk node --test packages/h2a/focus-kit/test/evidence-browser.test.mjs` | 1 échec / 2 sur targetRef d'annexe, run-rOcwrR → 2/2, exit 0, run-D3eUjh |
| `rtk node --test packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs` | Qualification finale 30/30, 1/1 pass, exit 0, run-rJThZ9 |
| `rtk node scripts/build-focus-dossier.mjs --check` | exit 0, sources et portable vérifiés, run-x3BV2y |

Les liens d'annexe résolvent les références vers la section, l'option ou le
dossier effectivement rendu ; le focus suit ce contexte. Le test couvre aussi
de vrais taps sur téléphone, et les budgets numériques sont strictement inchangés.

## Témoins de méthode H4 conservés

| Commande exacte | Résultat |
| --- | --- |
| `rtk node --test packages/h2a/test/install-skills-hosts.test.js` | 17/17 pass, exit 0, zéro skip ; run-6yuT1o |
| `rtk node --test packages/h2a/test/native-host-shared-skills.test.js` | 3/3 pass, exit 0, zéro skip ; run-xm7WQG |
| `rtk npm exec --offline -- vitest run --config vitest.config.ts src/cli/present-decision-skill.test.ts` (cwd packages/track) | RED 1 échec / 13, run-lRHA0J : instructions 879 mots > 850 ; puis 13/13 pass, exit 0, run-Lg4kMk et vérification finale après condensation |

Les instructions H1 tiennent dans le budget existant : 835 mots pour la méthode,
moins de 300 pour l'audit, avec les clauses propriétaires conservées. Aucun seuil
de lecture n'a été modifié. La fermeture du package isolé repasse 1/1 après ce
changement de texte, run-3vnWZe. Total des fichiers ciblés : **300 tests**, zéro skip.
Les sorties par job CI et l'artifact de mesures sont liés dans la PR draft #377.
