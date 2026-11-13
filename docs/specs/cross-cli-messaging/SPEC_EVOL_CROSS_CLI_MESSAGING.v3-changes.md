# Table des changements — SPEC_EVOL_CROSS_CLI_MESSAGING v2 → v3

| Champ | Valeur |
| --- | --- |
| Source | `SPEC_EVOL_CROSS_CLI_MESSAGING.v2.md`, SHA-256 `8f2ef6efb27796eea97c45703d040b676428920ec53d52330efde303af3137a9`, identique à celui cité par les deux revues ; v2 conservée intacte |
| Livrable | `SPEC_EVOL_CROSS_CLI_MESSAGING.v3.md`, SHA-256 `22ec83b1b51f7d2374176c4fec76173f45ca58f1656048c14bde75008ebf04fe` |
| Revues appliquées | `../cfxca-last.md` (Astra max : 2 P1) et `../cfxcs-last.md` (Sol max : 1 P1, doublon du second constat Astra) : **2 P1 distincts** |
| Périmètre | Les deux P1 restants uniquement, leurs critères RED/GREEN et leurs renvois directs ; métadonnées de version actualisées. Deux nouveaux fichiers Markdown, aucun code livré |

| P1 | Origine | Correction minimale | Ancres v3 |
| --- | --- | --- | --- |
| Réplications créditant un poller lent | Astra, §3.3 v2, l.394 | Suppression de la garantie fondée sur des décalages non commensurables. Exigence mesurée : la fenêtre entière `A_i = [wake_i, wake_i + D]` d'une répétition doit être strictement contenue dans la rétention `B_j = [delivery_j, release_j)` d'une autre, sur des temps relatifs à la barrière et avec marge d'incertitude. Aucun crédit d'étape 7 avant validation du lot complet ; sinon `woke:false`, sortie 2, `wake-phase-separation-unproven`. Ajout au RED du cas exact `W0=W1=10 s`, `D=3 s`, réveils à 21 / 21,414 / 21,732 s, première lecture à 23 s. GREEN exigé : refus de ce lot et détection de la même lecture pendant une rétention suffisamment prolongée | §3.3 l.305 ; §5.3 l.639 ; L3 l.1375 ; §12 l.1987 |
| Fusion excluant les lignes R2 déjà obligatoires | Astra et Sol, §7.1 v2, l.1004–1005 | Fusion et release exigent toutes les lignes R1 **et R2 déjà obligatoires dans le manifeste du SHA candidat**. Tests de `--gate merge` : R1 entièrement vert, ligne R2 obligatoire absente puis `blocked`, y compris si le reçu omet R2 de son propre périmètre ; refus dans les deux cas. Jumeau positif avec toutes les cellules R1/R2 obligatoires `measured-OK`. Renvois de fusion alignés | §7.1 l.1007 ; introduction §9 l.1272 ; L11 l.1694 ; §13 l.2049 |

| Vérification documentaire exécutée | Résultat observé |
| --- | --- |
| Même fichier ciblé `spec-p1.test.mjs` sur une copie temporaire de v2, avant révision | **RED** : sortie 1 ; `tests 4`, `pass 0`, `fail 4`, `skipped 0` |
| Même commande et mêmes assertions sur une copie temporaire de v3 | **GREEN documentaire** : sortie 0 ; `tests 4`, `pass 4`, `fail 0`, `skipped 0` |
| Arithmétique du contre-exemple, incluse dans le premier contrôle | `overlap=[21.732, 24] s; first read=23 s; old timing accepts 3/3` ; la géométrie de séparation est absente. Avec rétention ultérieure `[10, 25.1) s`, la fenêtre `[21, 24] s` est contenue et la lecture à 23 s tombe pendant la rétention |
| Comparaison des sections et SHA par Node, puis lecture du diff v2 → v3 | Sortie 0 : `SCOPE OK: 9 allowed sections changed; 66 sections byte-identical; heading structure unchanged` ; SHA v2 inchangé. Sections modifiées : en-tête, §3.3, §5.3, §7.1, introduction §9, L3, L11, §12, §13 |

Commande exacte des deux passages RED/GREEN (seule la copie temporaire `candidate.md` passe de v2 à v3) :

```sh
rtk env XDG_RUNTIME_DIR='/home/antoinefa/.cache-tmp/xcli-spec-v3-hWVJHU/runtime' node --test '/home/antoinefa/.cache-tmp/xcli-spec-v3-hWVJHU/spec-p1.test.mjs'
```

Ces contrôles portent sur le contrat écrit et l'arithmétique du contre-exemple. Le vérificateur, les copies et `XDG_RUNTIME_DIR` utilisent un répertoire créé par `mkdtemp`, supprimé après vérification ; aucun fichier de code n'est livré.

| Point demandé au rapport final | État |
| --- | --- |
| Commits poussés | Aucun ; ce répertoire de livrables est hors dépôt Git |
| Tests produit et campagnes réelles | **Non couverts** : aucune exécution de h2a, aucune suite du dépôt, aucun login, aucun état réel consulté. Les futurs tests fonctionnels restent prescrits dans L3/L11 |
| Garantie wake restante | **Non couverte** : preuve absolue de consommation et polling dont la phase varie entre sessions, dérive ou s'adapte. La séparation exclut le calendrier périodique invariant relatif à la barrière ; sans séparation mesurée, F1 reste ouvert et aucun crédit n'est accordé |
| Nouvelle double revue indépendante de v3 | Non exécutée dans ce lot ; la porte GO-CODE reste inscrite en §13 |
| Écart à la tâche | Aucun : seulement les deux P1 restants, leurs validations/renvois et les métadonnées v3 ; aucun autre fichier existant modifié |
