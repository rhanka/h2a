# Évaluations de compatibilité — librairie de use-cases organisationnels

> **Rôle** : tester le modèle `h2a` contre des organisations réelles avant de figer la spec détaillée.
> **Méthode** : pour chaque use-case, mapper acteurs → rôles, contrats, policies, controls, engagements, flux d'escalade, schéma, et gaps.
> **Statut** : tracks lancés le 2026-05-17 ; refondus en librairie `evaluations/*.md` le 2026-05-25. Les conclusions sont des hypothèses de travail.

## Use-cases

| # | Use-case | Topologie | Fichier |
|---|---|---|---|
| A | Entreprise traditionnelle | hiérarchie | [a-enterprise.md](./a-enterprise.md) |
| B | Écosystème multi-entreprises | fédération pair-à-pair | [b-ecosystem.md](./b-ecosystem.md) |
| C | Gouvernement / citoyen | autorité publique | [c-government-citizen.md](./c-government-citizen.md) |
| D | 1 PRINCIPAL / 15 CONDUCTORS (sans médiateur) | étoile sans médiateur | [d-principal-15-conductors.md](./d-principal-15-conductors.md) |
| E | Organisation SAFe à delivery agentique (modèle octo) | train agile + squads | [e-safe-octo.md](./e-safe-octo.md) |

Chaque fichier suit la même structure : schéma Mermaid, mapping, contrats vs policies, cas multi-acteurs, gaps, hypothèse de compatibilité.

## Source machine-readable

Depuis **DEC-041**, le mapping A/B/C est aussi exposé en machine-readable par `H2A_ABC_MODEL_PROFILES` et vérifié par `auditAbcModelCompatibility(modelId)` (`packages/h2a/src/abc.ts`, tests `packages/h2a/test/abc.test.js`). Ces use-cases narratifs restent la **source de conception** ; les profils exécutables en sont dérivés. Toute évolution d'un track doit mettre à jour un DEC + les tests.

## Grille commune

Chaque évaluation répond aux mêmes questions :

1. **Acteurs** : quelles INSTANCE tiennent quels rôles (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE`) ?
2. **Scopes** : frontières entre mini-organisation, engagement, fédération, activité d'ensemble ?
3. **Autorité / mandat / signature** : qui signe, pour quelle partie, sur quel scope, avec quel mandat ?
4. **Contrats** : `CONTRACT`, `ENGAGEMENT`, `POLICY`, ou artefact externe référencé ?
5. **Obligations / droits / clauses** : obligations, droits réservés, disclosure, recours, termination.
6. **Controls / enforcement** : domaines à contraintes/audits cross-tree, niveau de disclosure.
7. **Escalades / recours** : qui déclenche `advise`/`decide`/`alert`, vers quelle autorité de scope.
8. **Audit** : traces prouvant responsabilité, consentement, conformité, exceptions, décisions.
9. **Deadlocks / précédence** : règles quand deux policies/contracts/autorités sont incompatibles.
10. **Gaps protocole** : concepts manquants ou à renforcer.

## Recherche Q9 — CONTRACT / POLICY / ENGAGEMENT

Hypothèse retenue (modèles entreprise, écosystème, gouvernement) :

- **CONTRACT** : conteneur normatif applicable à des parties/scopes, signé par les autorités mandatées. Peut mélanger clauses durables, obligations, droits, policies, preuves, signatures, contrôle/escalade, engagements dérivés.
- **POLICY** : règle durable applicable à un scope. Autonome (règlement, loi) **ou** clause d'un CONTRACT. Déclare `sourceAuthority` + `adoptionMode` (`ratified`/`contractual`/`imposed`/`acknowledged`). **POLICY n'est pas une 5ᵉ couche linéaire** (DEC-018) — c'est l'un des trois artefacts normatifs.
- **ENGAGEMENT** : contrat opérationnel exécutable (mission, service, livraison) avec charter, rôles, critères de succès, journal. *A* un scope, n'*est* pas le scope.
- **ENFORCEMENT_PLAN / ESCALADE** : plan d'application — vérifie le respect, détecte les violations, produit la preuve, bloque/alerte/escalade.

## Contre-audit 2026-05-17 (points figés)

- Un `SCOPE` ne signe jamais ; une INSTANCE mandatée signe pour une PARTY ou un SCOPE.
- `ENGAGEMENT` n'est pas le scope : il *a* un scope.
- `CONTROL` est un rôle ; le plan d'application est `ENFORCEMENT_PLAN`.
- `MANDATAIRE` n'est ni médiateur, ni arbitre, ni tribunal.
- L'escalade cible l'autorité compétente du scope, pas seulement le PRINCIPAL local.
- Sans médiateur inter-contrat : ledger, états terminaux, base hash, signatures, règles de stale proposal.
- Le droit d'audit cross-organisation est minimisé : redaction, evidence packages, attestations, hashes.
- Les modèles exigent obligations récurrentes, droits réservés, recours, précédence et disclosure contrôlée.

## Synthèse des besoins transverses

- **Scope first-class** : chaque rôle/policy/engagement/trace attaché à un scope explicite.
- **Policy first-class** : durable, versionnée, par scope, avec source authority + adoption mode, distincte de l'engagement.
- **External authority** : un acteur externe peut imposer une policy sans être subordonné à l'organisation.
- **Controls forts mais minimisés** : audit, veto, alerte, validation de policy, exception, preuve — sans accès excessif.
- **Contracts-cadres vs engagements** : un CONTRACT durable génère plusieurs engagements opérationnels.
- **Héritage et conflit** : policies locales, fédérées, contractuelles, publiques peuvent se contredire.
- **Accountability multi-niveaux** : PRINCIPAL local, EXECUTIF global, CONTROL, autorité externe auditables simultanément.
- **Mandat et signature** : un scope ne signe pas ; une instance mandatée signe pour une partie ou un scope.
- **Négociation déterministe** : ledger, états, hashes, signatures, stale proposal.

## Questions à instruire

1. Schema minimal de `CONTRACT` (parties, scopes, policies, obligations, droits, engagements dérivés, signatures, preuves, amendements) ?
2. Contrat-cadre durable = `CONTRACT` sans engagement immédiat, ou templates d'engagement ?
3. Autorité externe obligatoire : CONTROL externe, EXECUTIF public, ou rôle dédié ?
4. Précédence entre policy interne / contractuelle / fédérée / publique ?
5. Niveau minimal d'audit pour taxes, régulation, actionnaires, investisseurs ?
6. Schema minimal de `MANDATE` et `SIGNATURE` ?
7. Quels conflits bloquent une signature en V1 ?
8. Rôle d'adjudication/recours canonique, ou AUTHORITY externe suffit-elle ?
