# PR #452 — corrections pour i-cond

Revue traitée : https://github.com/rhanka/h2a/pull/452#issuecomment-6866488999.
Base vérifiée : `origin/main`, `21a9e2396c2864278a5c6da8b5a3f0540eb9a24a`.
Elle est déjà ancêtre de cette branche. Aucun rebase nécessaire.

## Ancres

La bibliographie calcule les identifiants `src-<ref en hexadécimal>-<numéro>`.
Elle réserve les identifiants des sections et des options.
Un suffixe évite même une collision avec ce nouveau préfixe.
Le composant portable et le rendu HTML commun utilisent le même calcul.
Les liens de citation ne portent aucun identifiant DOM.

Le test unitaire force une collision avec une ancre calculée.
Il vérifie aussi deux références de document distinctes.
Le test CDP place `focus-source-1` et la nouvelle ancre dans deux sections.
Entrée sur `[1]` rejoint une seule entrée bibliographique et lui donne le focus.
Le téléchargement et les deux thèmes restent vérifiés.

## Exports texte

Markdown et texte affichent `context → [1]` et `portable → [2]`.
La liste « Sources » conserve les mêmes numéros.
Les groupes et les renvois des annexes suivent cette correspondance.
La copie vendue dans Track a été régénérée et vérifiée.
L'ancien test qui exigeait l'identifiant interne `late` vérifie désormais le renvoi résolu.

## Mobile

La CI plaçait le bas de la ligne à `900,4375` dans une fenêtre de 900 pixels.
Le défilement au bord arrondit les positions du document à des pixels entiers.
La mise en page garde des coordonnées fractionnaires.

Reproduction avant correction : ajout de `margin-top: 0.5px` au lecteur,
à 320 × 900, avec 20 000 lignes. La ligne citée finit à `900,15625`.
Le nouveau test échoue avant la correction. Il passe ensuite pour les décalages
0, 0,25, 0,5 et 0,75 pixel. La ligne citée est maintenant centrée.
L'assertion mobile existante reste inchangée. Aucun délai n'a été augmenté.

Le témoin de performance sélectionne le lien accessible « Source n ».
Il vérifie son fragment et l'unicité de sa cible.
Seule son empreinte change dans la politique figée. Les seuils restent identiques.
La construction désactive le chargement automatique des fichiers d'environnement.

## Compatibilité avec #450

Cible : `3b26f09bf70901d181349cd4ec13c649b72491ad`.
Simulation dans `tmp/report-compat`, depuis une archive de cette cible.
Aucune branche n'a été fusionnée. Le checkout principal reste intact.

Les changements de #452 ont été appliqués à cette copie.
Les conflits textuels demandent ces résolutions :

- `evidence.ts` garde `FocusDocument`, `isReportDocument` et `reportAnnexes`.
  Il ajoute la bibliographie et les renvois numérotés.
- `html.ts` garde le rendu et les annexes du rapport. Il ajoute les ancres.
- `App.svelte` garde `ReportProse`, le libellé Rapport et le pied de page adapté.
  Le récapitulatif reste conditionné par la présence de questions.
- `Evidence.svelte` garde le texte du budget de lecture du rapport.
  Il reçoit la bibliographie et conserve les annexes.
- Le script de construction garde le schéma rapport et ajoute `response-line.ts`.
  Les assets sont reconstruits dans la copie.

Les tests navigateur de #450 utilisaient les anciens boutons de citation.
Dans la simulation, ils activent désormais « Source 1 », vérifient sa cible,
puis consultent les sources par le catalogue. Les assertions de tableaux,
graphiques, annexes, thèmes et largeur de page sont conservées.
Une assertion confirme l'absence du récapitulatif de décisions.
Un test ajouté dans la simulation vérifie `[1]` et « Sources » dans les exports du rapport.

Résultat : construction réussie, 336 tests Focus réussis,
deux tests navigateur rapport réussis et parcours CDP bibliographie/copie réussi.
Ces résultats qualifient la résolution simulée. Les conflits textuels restent
à résoudre lors de l'intégration effective des deux PR.

## Contrôles locaux

- `npm run build` : réussi.
- `npm run test -w @sentropic/focus` : 321 tests réussis.
- `npm run lint:focus-imports` : réussi.
- `npm run typecheck` et le typecheck Focus : réussis.
- Contrôle du renderer et parité du vendor Focus : réussis.
- Construction des dossiers : 36 tests réussis.
- Installation fraîche, navigateur des pièces et CDP : huit tests réussis.
  Le cache isolé `/home/antoinefa/.cache/focus-452-npm` fournit les 272 tarballs.
  Le premier essai avec le cache habituel échouait sur un tarball absent.
- Parcours navigateur généraux et mémoire : 15 tests réussis.
  Corpus depuis un checkout superficiel : un test réussi.
- Performance : réussi, 30 mesures par parcours. Aucun seuil modifié.
  Grand corpus : ouverture p95 948 ms, citation p95 69 ms, recherche p95 61 ms.
  Pic mémoire : 731 Mo. Mesures brutes conservées localement dans
  `/home/antoinefa/.cache-tmp/focus-evidence-performance-Zjct8N/metrics.json`.

Des essais lancés pendant une reconstruction de Track ont rencontré un `dist`
temporairement absent. Les parcours concernés ont été relancés après reconstruction.
Aucune nouvelle revue par pairs n'est revendiquée : aucun outil de lancement
h2a MCP n'est disponible dans cette session.
