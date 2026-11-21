# Révision v3 — traitement des revues de confirmation (Astra max + Sol max)

| Champ | Valeur |
| --- | --- |
| Base révisée | `SPEC_EVOL_FOCUS_EDIT_RETURN.v2.md` (v2), SHA-256 `510a53dd0c0262e0cceaa3aafa2a10280c7d8876014c5faa8ddc26b94b33a0b9` — inchangée |
| Résultat | `SPEC_EVOL_FOCUS_EDIT_RETURN.v3.md`, SHA-256 `6d320f6627643c97a45baf47d103e0442618bbc2da4613054f8c7dd1e8b8e105` |
| Revues | `cffea-last.md` (Astra max) ; `cffes-last.md` (Sol max) — verdict commun `CORRECTIONS-REQUISES`, sur la v2 à l'empreinte ci-dessus |
| Remarque distincte | 1 seul P1, commun aux deux revues, formulations quasi identiques. Aucun autre point soulevé. |
| Vérification | P1 recoupé ligne à ligne avec la v2 (§5.2 L270, §5.4 étape 3 L285, D16–D18, D21, FE-1 RED 5, FE-5 RED 4). Aucun dépôt relu, aucun code, aucun test de dépôt exécuté : révision de spec seule, sous les mêmes épinglages §0.3. |
| Préservé sans changement | Citation owner de l'en-tête ; questions Q1–Q4 (§8) ouvertes, avec leurs périmètres bloquants ; aucun `proposition-not-validated` promu (la mécanique de lignée complète reste rattachée à D21) ; les six traitements v2 (voir `SPEC_EVOL_FOCUS_EDIT_RETURN.v2-changes.md`) intacts hors refonte du seul contrôle de lignée. |

| Remarque | Vérification contre la v2 | Traitement dans la v3 |
| --- | --- | --- |
| **P1 restant (Astra + Sol) — Supersession transitive indéterminable si un retour intermédiaire manque.** §5.2 ne transporte que `supersedesReturnId` (prédécesseur immédiat) ; §5.4 étape 3 exige pourtant de tombstoner toute la chaîne, même jamais reçue. Contre-exemple commun, même baseline : R1 `A→B` ; R2 `A→C` remplace R1 ; R3 vide remplace R2. Livraison R3 puis R1, sans R2 : le consommateur connaît R3→R2 mais pas R2→R1 ; la branche « Otherwise … candidate new head » réapplique `B`, annulé par R3. Demandes : transporter ou résoudre l'ascendance complète, interdire l'application si l'ordre est indémontrable, ajouter le RED à trois retours R3→R1 avec R2 absent. | **Fondée, confirmée telle quelle.** V2 §5.2 (L270) : seul `supersedesReturnId` optionnel. V2 §5.4 étape 3 (L285) : « its full predecessor chain is tombstoned … even if some predecessors were never directly received » — affirmation sans donnée qui la rende calculable. V2 D16 parle d'une « `supersedesReturnId` chain » qu'un consommateur n'ayant pas reçu R2 ne peut pas reconstituer. Les témoins v2 (cas §5.4 (i)–(iv), FE-1 RED 5 (a)–(e), FE-5 RED 4) couvrent deux retours au plus ; aucun cas à trois retours avec intermédiaire absent. Les deux relecteurs décrivent le même défaut ; aucun n'est en erreur, aucune précision de portée à apporter. | Les deux mécanismes demandés sont mis en place, car chacun seul laisse un trou : **(1) ascendance complète transportée** — nouveau champ requis `supersededReturnIds[]` : tous les `returnId` supersédés transitivement contre la même baseline, prédécesseur immédiat en tête, construction `[supersedesReturnId, ...pred.supersededReturnIds]`, `[]` pour le premier retour, sans doublon ni auto-référence, couvert par le digest du retour figé. R3 seul tombstone donc R2 **et** R1. **(2) contrôle fermé par défaut** — §5.4 étape 3 réécrite en branches ordonnées (3a)–(3e) : déjà traité / digest divergent / positivement supersédé (`returnId` dans les tombstones ou dans la liste de la tête) / successeur prouvé (la tête figure dans la liste du candidat **et** la sous-séquence après la tête égale exactement la liste enregistrée de la tête) / sinon **ordre indéterminé** : refus `lineage-order-indeterminate`, zéro changement appliqué, tête et tombstones inchangés, reçu émis, préconditions jamais évaluées comme voie d'application. L'ordre n'est jamais inféré de l'arrivée, d'un horodatage ou d'une égalité de contenu ; un retour refusé ne fait jamais avancer tête ni tombstones ; la résolution exige un nouveau retour figé prouvant (3d) contre la tête courante, ou l'arbitrage explicite de Q3. Résultat sur le contre-exemple : R1 tardif refusé (3c) si R3 a transporté `[R2, R1]`, refusé (3e) si aucune ascendance utilisable ne l'ordonne (par ex. liste tronquée à `[R2]`) — dans les deux cas `B` n'est jamais réappliqué. Un retour sans `supersededReturnIds[]` ou incohérent en interne échoue dès la validation (§5.4 étape 1) et ne fait rien avancer. Côté export : liste construite uniquement depuis le retour figé précédent ou son enregistrement de session/reprise (§5.5 mémorise `returnId` **et** liste complète) ; ascendance irrécupérable = aucun retour supersédant figé sur liste tronquée présentée comme complète, l'import du retour précédent la restaure. RED ajoutés : cas normé §5.4 (v) ; FE-0 RED 8 (fixtures R1/R2/R3, couches (S)/(M) explicites) ; FE-1 RED 5 (f) ; FE-4 RED 1 (construction à l'export sur trois exports successifs + import profil neuf) ; FE-5 RED 4 (même cas après redémarrage de l'importeur). |

## Lieux touchés (v3, exhaustif)

| Lieu | Changement |
| --- | --- |
| En-tête, §0.4 | Statut/date/base v3, revues `cffea`/`cffes` citées, paragraphe v3 ajouté ; historique v2 conservé |
| §3.2 V3 | Traitement complété : ascendance transportée + refus si ordre non prouvé ; RED à trois retours nommé |
| D16 | Définition de `supersededReturnIds[]` (contenu, ordre, construction, invariants, digest) ; état de lignée = tête + sa liste, tombstones monotones étendus par les seules têtes acceptées ; refus `lineage-order-indeterminate` |
| D17 | Construction à l'export par induction ; interdiction de deviner ou de tronquer en la présentant comme complète ; sort consommateur d'une ascendance absente/incohérente (étape 1) ou sans ordre prouvé (étape 3 (3e)) |
| D18 | Étape (2) : refus supersédé **et** refus ordre indéterminé avant toute précondition ; étape (6) : statut de reçu `lineage-order-indeterminate (not applied)` distinct de `superseded` |
| D21 | Vocabulaire : `supersedesReturnId` (immédiat) + `supersededReturnIds[]` (transitive), toujours `proposition-not-validated` |
| §5.2 | Ligne `editReturn` : champ requis, sémantique et invariants ; ligne reçu : issue `refused as lineage-order-indeterminate` |
| §5.4 | Étape 1 : cohérence interne de l'ascendance (égalités inter-champs = couche (M)) ; étape 3 réécrite fermée par défaut, branches (3a)–(3e) — numérotation distincte des cas (a)–(c) de l'étape 4, inchangée ; cas normé (v) ajouté (trois retours, intermédiaire absent, + variante sans ordre prouvable) |
| §5.5 | Le stockage de reprise mémorise la liste complète avec le dernier `returnId` ; ascendance irrécupérable : pas de retour supersédant figé sur liste tronquée ; le retour complet transporté reste le mécanisme inter-machines |
| FE-0 | RED 8 nouveau (fixtures d'ascendance ; (S) présence/type/unicité d'éléments, (M) égalités inter-champs et égalité de sous-séquence contre la tête) ; gate (M) complété en conséquence |
| FE-1 | RED 5 : cinq cas normés (au lieu de quatre) ; (f) intermédiaire absent, variantes (3c) et (3e), sous-séquence divergente |
| FE-4 | RED 1 : retour vide portant la liste complète ; témoin de construction sur trois exports successifs sans envoi intermédiaire, puis après import de R2 seul sur profil neuf |
| FE-5 | RED 4 : cas (v) contre registre persisté après redémarrage ; variante ordre indéterminé, tête inchangée |
| §6.1, G6, §9 n°17, Annexe A | Critère du premier incrément, états prouvables et hors-périmètre alignés (résolution automatique d'une lignée à ordre indéterminé = NOT covered, comme la fourche) ; ligne sources v3 |

## Ce que la v3 ne couvre toujours pas (inchangé)

- Q1–Q4 restent ouvertes (§8), dont l'UX d'arbitrage d'une fourche ou d'un ordre indéterminé (Q3, §9 n°17) : la v3 bloque l'application, elle ne tranche pas l'arbitrage.
- Emplacement et durabilité concrets du registre de lignée par consommateur : U7 (FE-5/FE-9), inchangé.
- Forme du marqueur `untranslated` (U9), budgets hors profils mesurés (§9 n°12) et tout le reste du §9 : inchangés.
- Aucun code écrit, aucun test de dépôt exécuté : les RED nouveaux ou complétés restent à écrire et à observer en échec puis en succès par leurs lots (commande + sortie, §6/G1).
- `spec-summary.md` décrit toujours la v1 ; non mis à jour, à ne pas citer comme résumé de la v2 ni de la v3.
