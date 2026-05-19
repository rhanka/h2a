# Projet — Index

> **Nom parapluie** : `h2a` (DEC-025).
> **Packages publiés** : `@sentropic/h2a` et `@sentropic/h2a-cli` (npm, TypeScript, MIT — DEC-027).
> **Date d'amorce** : 2026-05-16.

## CLI surface (V1)

```
h2a --help
h2a hosts
h2a mcp-tools

# runtime local-files (store sous <root>/.h2a, DEC-031)
h2a init [--root <path>]
h2a register --json <registration-json> [--root <path>]
h2a discover [--role <role>] [--scope <scope>] [--root <path>]

# négociation
h2a negotiate open --json <record-json> [--root <path>]
h2a negotiate status --id <id> --status <status> [--root <path>]
h2a negotiate event --id <id> --json <payload-json> [--root <path>]
h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--root <path>]
h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--root <path>]
h2a negotiate journal --id <id> [--root <path>]

# mailboxes
h2a inbox put --instance <id> --json <envelope> [--root <path>]
h2a inbox read --instance <id> [--root <path>]
h2a inbox pop --instance <id> --envelope <id> [--root <path>]
h2a outbox put --instance <id> --json <envelope> [--root <path>]
h2a outbox read --instance <id> [--root <path>]
```

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
- **Plan de pilotage projet** → [`PLAN.md`](./PLAN.md)
- **Prompt de handover Claude** → [`handover.md`](./handover.md)

## Convention

- Toute nouvelle exigence → ajouter dans `SPEC.md` (numérotation continue `REQ-NNN`).
- Toute nouvelle décision → ajouter dans `DECISIONS.md` (numérotation continue `DEC-NNN`, append-only).
- Tout renommage de concept → nouvelle DEC + bump version de `VOCABULARY.md`.

## Historique

Ce fichier a été refactoré le 2026-05-16 (DEC-011) à partir d'un `INTENT.md` initial qui mélangeait les trois couches. Le contenu original est intégralement préservé dans les 3 fichiers ci-dessus.
