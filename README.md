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

# négociation (offer/counter/sign/event acceptent aussi --causation-id / --correlation-id ;
# par défaut, chaque événement hérite causationId = id de l'événement précédent
# et correlationId = correlationId précédent — DEC-033)
h2a negotiate open --json <record-json> [--root <path>]
h2a negotiate status --id <id> --status <status> [--root <path>]
h2a negotiate event --id <id> --json <payload-json> [--causation-id <id>] [--correlation-id <id>] [--root <path>]
h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]
h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]
h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]
h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]   # persiste l'artefact gagnant en write-once sous contracts/, policies/, engagements/ ou artifacts/<hash>.json (DEC-033), retourne `artifactPath`
h2a negotiate journal --id <id> [--root <path>]

# mailboxes
h2a inbox put --instance <id> --json <envelope> [--root <path>]
h2a inbox read --instance <id> [--root <path>]
h2a inbox pop --instance <id> --envelope <id> [--root <path>]
h2a outbox put --instance <id> --json <envelope> [--root <path>]
h2a outbox read --instance <id> [--root <path>]

# MCP server (JSON-RPC 2.0 over stdio, DEC-026)
h2a mcp-serve [--root <path>]

# Branchement hôte (Codex / Claude Code) — émet/merge le snippet `mcpServers.h2a`
h2a host setup --host <codex|claude> [--root <path>] [--print | --write <file>] [--force]
```

### Contrat CLI (DEC-034)

Tout verbe émettant du JSON utilise **exactement une** des trois enveloppes
canoniques (`resource` / `list` / `action`), et **tous** les verbes partagent
la même table des codes de sortie `0 / 1 / 2 / 3`. C'est le contrat
programmatique stable du CLI :

- Référence humaine détaillée verbe par verbe → [`docs/cli-contract.md`](./docs/cli-contract.md).
- Manifeste machine ré-exporté par `@sentropic/h2a-cli` :
  `H2A_CLI_VERB_CONTRACTS` (`packages/h2a-cli/src/cli-contract.ts`).

Toute évolution rétro-incompatible exige une nouvelle DEC + un bump majeur de
`@sentropic/h2a-cli`.

### Compatibilité cross-langage (DEC-035)

- **Matrice d'autorité** : `H2A_AUTHORITY_MATRIX` (re-exporté par
  `@sentropic/h2a`, source `packages/h2a/src/authority.ts`) déclare quels
  rôles peuvent signer chaque `H2AArtifactKind`. Appliquée par
  `stabilizeNegotiation` après la vérification ed25519 (DEC-032).
- **Fixtures canoniques** : `packages/h2a/fixtures/` contient un artefact
  byte-canonique par kind liant (`CONTRACT`, `POLICY`, `ENGAGEMENT`,
  `MANDATE`, `AUTHORITY`, `ENFORCEMENT_PLAN`) ; `manifest.json` indexe
  `{path, kind, id, sha256}` pour qu'une implémentation non-TS (Python,
  Go, Rust...) puisse rejouer la canonicalisation JSON sorted-key et
  confirmer le SHA-256 bit-pour-bit. `H2A_CANONICAL_FIXTURES` ré-expose
  ce manifeste depuis `@sentropic/h2a`.

## Exemples

- **`examples/principal-conductors/`** — démo runnable de bout en bout du
  cas `1 PRINCIPAL / 15 CONDUCTORS` : génère 16 paires `ed25519`, enregistre
  les 16 instances, ouvre une négociation avec quorum 3 sur 15, signe et
  stabilise (affiche le `artifactPath` immutable et relit le fichier sur
  disque pour confirmer `kind = ENGAGEMENT`, DEC-033), puis interroge le
  serveur MCP en JSON-RPC sur stdio.
  Lancer via `./examples/principal-conductors/run.sh` (build + run) ou
  directement `node examples/principal-conductors/run.mjs` une fois le
  workspace buildé. Voir [`examples/principal-conductors/README.md`](./examples/principal-conductors/README.md).

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
- **Procédure de release et notes de sécurité** → [`docs/release.md`](./docs/release.md)
- **Prompt de handover Claude** → [`handover.md`](./handover.md)

## Convention

- Toute nouvelle exigence → ajouter dans `SPEC.md` (numérotation continue `REQ-NNN`).
- Toute nouvelle décision → ajouter dans `DECISIONS.md` (numérotation continue `DEC-NNN`, append-only).
- Tout renommage de concept → nouvelle DEC + bump version de `VOCABULARY.md`.

## Historique

Ce fichier a été refactoré le 2026-05-16 (DEC-011) à partir d'un `INTENT.md` initial qui mélangeait les trois couches. Le contenu original est intégralement préservé dans les 3 fichiers ci-dessus.
