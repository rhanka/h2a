# Évaluations de compatibilité — modèles organisationnels

> **Déplacé** : ce document a été éclaté en une librairie de use-cases (un fichier par modèle, avec schéma Mermaid) le 2026-05-25.
>
> → **[`evaluations/`](./evaluations/README.md)** : index, grille commune, Q9 CONTRACT/POLICY/ENGAGEMENT, contre-audit, synthèse transverse.

## Use-cases

| # | Use-case | Topologie | Fichier |
|---|---|---|---|
| A | Entreprise traditionnelle | hiérarchie | [evaluations/a-enterprise.md](./evaluations/a-enterprise.md) |
| B | Écosystème multi-entreprises | fédération pair-à-pair | [evaluations/b-ecosystem.md](./evaluations/b-ecosystem.md) |
| C | Gouvernement / citoyen | autorité publique | [evaluations/c-government-citizen.md](./evaluations/c-government-citizen.md) |
| D | 1 PRINCIPAL / 15 CONDUCTORS (sans médiateur) | étoile sans médiateur | [evaluations/d-principal-15-conductors.md](./evaluations/d-principal-15-conductors.md) |
| E | Organisation SAFe à delivery agentique (modèle octo) | train agile + squads | [evaluations/e-safe-octo.md](./evaluations/e-safe-octo.md) |

Source machine-readable du mapping A/B/C : `H2A_ABC_MODEL_PROFILES` + `auditAbcModelCompatibility` (`packages/h2a/src/abc.ts`, DEC-041).
