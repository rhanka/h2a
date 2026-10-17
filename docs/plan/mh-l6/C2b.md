# C2b — bootstrap et adoption avant raccourci de version

Référence : spec §8.6. Le bootstrap autonome identifie le préfixe depuis
l'entrée npm réelle, prépare une image indépendante, vérifie manifeste/graphe
fermé/binaires, applique les gardes héritées, installe le lanceur, sélectionne
durablement puis délègue au contrôleur cible absolu. `h2a upgrade` exécute
l'adoption nécessaire avant le raccourci `current == latest`.

## C2b-1 — session de bootstrap protégée (livré)

`openBootstrapSession({ prefix, entrypoint, legacyPrefix, target })` dans
`packages/h2a/src/runtime/upgrade/bootstrap-session.js` : contrôle
d'éligibilité de la cible (`bootstrap_target_invalid`), observation physique
C2a, prise du verrou compatible sur le préfixe canonique vérifié
(`bootstrap_lock_unavailable`), revalidation anti-dérive sous verrou avec
libération sur échec. La session gelée expose preuve, préfixe, cible et
`release()` idempotent. `assertBootstrapSessionUnchanged(session)` revalide
à la demande pour les étapes suivantes. Aucune image préparée, aucune
sélection, aucun paquet exécuté.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-bootstrap.test.js final-C2b-1` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs bootstrap` (verrou, dérive, cible, libération) | 4 rouges ERR_ASSERTION / 4 verts | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : ouvreur absent (`ERR_ASSERTION`, 1 test, exit 1), conservé
comme diagnostic. Audit : `node scripts/mh-l6-c2b-audit.mjs
/tmp/mh-l3-qualification-c2b-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 4 paires/profil. Preuve :
`proof-C2b-1.json`.

| NOT covered restant | Gate |
|---|---|
| Revalidation interne à `open` non rejouable en monothread (aucune dérive intercalable entre observation et verrou sans second processus) ; elle partage le chemin prouvé d'`assertBootstrapSessionUnchanged`, tué/restauré ci-dessus | Noté ; C2b-2/F l'exerceront sur chemins vivants |
| Préparation d'image indépendante, vérification graphe/binaires, installation conditionnelle du lanceur, sélection durable, délégation, adoption après remplacement et already-current | C2b-2/F ; la session ne prépare ni ne sélectionne rien |
| Observateurs B2-3 alimentant `select({ exclusion })`, CLI/auto commune | B2-3/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |
