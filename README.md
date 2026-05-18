# Projet — Index

> **Nom de travail recommandé** : `h2a` (DEC-025, validé utilisateur le 2026-05-18).
> **Package cible recommandé** : `@sentropic/h2a`, npm, TypeScript.
> **Date d'amorce** : 2026-05-16.

## Pile contractuelle (DEC-010)

Chaque couche a son document :

- **INTENTION** (pourquoi) → [`INTENTION.md`](./INTENTION.md) — verbatim utilisateur, reformulation narrative, périmètre projet.
- **SPÉCIFICATION** (quoi mesurable) → [`SPEC.md`](./SPEC.md) — exigences `REQ-NNN`.
- **ARTEFACTS CONTRACTUELS** (ce qui lie) — `CONTRACT`, `POLICY`, `ENGAGEMENT` (DEC-018).
- **ENFORCEMENT / ESCALADE** (application) — audits, vetos, alertes, escalades, preuves.

## Documents transverses

- **Vocabulaire canonique** (figé V1.7) → [`VOCABULARY.md`](./VOCABULARY.md)
- **Journal de décisions de design** → [`DECISIONS.md`](./DECISIONS.md)
- **Évaluations de compatibilité** → [`EVALUATIONS.md`](./EVALUATIONS.md)
- **Proposition runtime minimale** → [`RUNTIME_PROPOSAL.md`](./RUNTIME_PROPOSAL.md)

## Convention

- Toute nouvelle exigence → ajouter dans `SPEC.md` (numérotation continue `REQ-NNN`).
- Toute nouvelle décision → ajouter dans `DECISIONS.md` (numérotation continue `DEC-NNN`, append-only).
- Tout renommage de concept → nouvelle DEC + bump version de `VOCABULARY.md`.

## Historique

Ce fichier a été refactoré le 2026-05-16 (DEC-011) à partir d'un `INTENT.md` initial qui mélangeait les trois couches. Le contenu original est intégralement préservé dans les 3 fichiers ci-dessus.
