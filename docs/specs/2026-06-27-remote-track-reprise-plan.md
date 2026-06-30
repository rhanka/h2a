# PLAN — Reprise de **remote + track** dans `h2a` (exécutable)

Status: PLAN (initie l'exécution des lots ADDITIFS sans attendre l'architecte ; gate O1 isolé)
Date: 2026-06-27
Conducteur: claude:a2a-cli (h2a)
SPEC liée: `2026-06-27-remote-track-reprise-spec.md`
Cadre: `2026-06-27-h2a-sentropic-resegmentation.md` (§8 staging stabilisé)
Syntaxe cible (référence): `2026-06-27-h2a-unified-cli-syntax.md`

## 0. Principe directeur

Tout ce qui est **additif et réversible** (extraire des protocoles neutres, brancher h2a dessus, plier des
verbes en ADDITION des anciens) **démarre maintenant**. Tout ce qui est **irréversible/public** (déprécier
`stp`/`remote`/`track`, repoint d'umbrella, déplacement physique de packages) **attend le gate O1**
(ADR de réversion **BR-42**, signé par un owner non-h2a + Fabien). h2a **porte l'exécution, ne s'auto-valide pas**.

## 1. Lots (S0 → S4)

> Adaptés du staging stabilisé du doc-cadre, focalisés remote+track.

### S0 — Frontière & échafaudage neutre (ADDITIF, démarrable maintenant)
- **S0.1** Figer le langage de frontière dans `docs/specs` + READMEs (`h2a-cli`/`h2a-org`/`*-protocol`). Aucun rename public.
- **S0.2** **Nommer + échafauder** les 3 packages neutres (skeleton : noms, JSON-schemas, **constantes de version**,
  zéro logique) :
  - `@sentropic/session-protocol` — extrait des shapes de `remote-protocol` + types envelope/presence/addressing
    de `h2a-cli` + wake/delegation-intent + capability-tokens.
  - `@sentropic/governance-protocol` — record-types RACI/decision/conductor/objective-loop (versionnés).
  - `@sentropic/scope-gate` — interface du gate (entrées : règles scope, verdict harness signé, statut track ;
    sortie : pass/hard-fail + record `--break-glass`).
- **S0.3** **No-cycle CI lint** (dep-cruiser/madge) : règle bloquante « lib ⇏ h2a », « protocol ⇏ applicatif » (AC-1).
- **S0.4** **Matrice compat-versions** (doc machine-lisible) : `h2a-cli@M` × `{session,governance,track,remote}-proto@N`.
- **S0.5** **Harnais de contract-tests inter-lib** (squelette rouge tant que non câblé) gatant la future release h2a.
- **S0.6** **Table de reprise des verbes** remote/track → familles h2a (renvoi au doc syntaxe), revue, non publiée.

### S1 — Gouvernance → `governance-protocol` (ADDITIF)
- Déplacer **uniquement** les **schémas/records** de gouvernance vers `governance-protocol`.
- `track` reste **API stable** ; il **persiste** les records (validation JSON-schema + provenance, zéro métier).
- Projecteurs RACI/decision/conductor branchés en `h2a-org` **en lecture** des records.
- *Gate* : AC-4 (record-only tenu), parité `track validate`/`report` inchangée.

### S2 — `session-protocol` + remote-lib (ADDITIF)
- Introduire `session-protocol` ; faire **transporter** l'enveloppe par `@sentropic/remote` **sans import h2a** (AC-8).
- `h2a-cli` **consomme remote-lib** ; `wake`/`delegate` restent **UX CLI dans h2a** (guards tmux/human-typing confinés).
- Bus présence/adressage **re-keyé par version de protocole** (AC-2).
- *Gate* : AC-2, AC-7 (remote vert sans h2a), AC-8.

### S3 — façade `h2a-org` + harness via `scope-gate` (ADDITIF)
- Ajouter `h2a-org` comme façade des verbes track (backlog/decision/acceptance/provenance/canevas).
- Brancher `scope-gate` AVANT toute écriture track/statut/commit ; harness fournit le **verdict-commit signé**.
- *Gate* : AC-3 (hard-fail + break-glass auditable), ownership stratifié préservé.

### S4 — Compat & convergence (GATED O1)
- `stp`/`remote`/`track` deviennent **alias compat** (warnings structurés, **sortie machine inchangée**, AC-6).
- **Retrait** seulement après : 2 mineures sans rupture, 0 commande externe non-aliasée, docs+CI migrées,
  contract-tests verts via anciens chemins, fenêtre LTS annoncée.
- Déplacement physique éventuel des packages = **décision ratifiée séparée** (SPEC §6 : reco = garder en place).

## 2. Premier pas concret, réversible (à faire en premier)

**PAS-0 : créer le skeleton de `@sentropic/session-protocol` (additif pur).**
- Nouveau package neutre : `package.json` + JSON-schemas d'enveloppe/présence/adressage + `PROTOCOL_VERSION`,
  **dérivés des shapes EXISTANTS** (`remote-protocol` + types h2a-cli) — **sans toucher** un seul caller.
- Y adjoindre le **no-cycle CI lint** (S0.3) en mode rapport, et un **contract-test** « une enveloppe
  `session-protocol` round-trip valide » (rouge→vert).
- **Réversibilité** : supprimer le package = no-op (aucun caller modifié, aucune sortie publique changée).
- **Pourquoi celui-là d'abord** : il matérialise la frontière anti-cycle (must-fix #1), il est 100 % additif,
  et il débloque S2 sans rien déprécier. C'est le plus petit incrément qui prouve la direction.

## 3. Dépendances inter-lots

```
S0 (frontière + 3 skeletons + no-cycle-lint + matrice + harnais)
 ├─► S1 (governance-protocol : a besoin du skeleton + du harnais contract-test)
 ├─► S2 (session-protocol : a besoin du skeleton + no-cycle-lint + re-key bus)
 └─► S3 (h2a-org + scope-gate : a besoin de S1 records + S2 transport)
        └─► S4 (alias compat + retrait) ── GATED O1 (ADR BR-42)
```
- S1 et S2 sont **parallélisables** après S0 (governance vs session sont disjoints).
- S3 dépend de S1 (records) ET S2 (transport).
- S4 dépend de S3 **et** du gate O1.

## 4. Tests / gates par lot

| Lot | Gate bloquant |
| --- | --- |
| S0 | No-cycle lint actif (AC-1) ; matrice compat publiée ; harnais contract-test présent (rouge OK) |
| S1 | AC-4 record-only ; parité `track validate`/`report` inchangée ; governance records validés par schema |
| S2 | AC-2 bus par version ; AC-7 remote vert sans h2a ; AC-8 transport neutre (isolation d'import) |
| S3 | AC-3 scope-gate hard-fail + `--break-glass` auditable ; ownership scope stratifié préservé |
| S4 | AC-5 contract-tests inter-lib verts ; AC-6 parité sortie machine des alias ; **gate O1 signé** |

## 5. Démarrable MAINTENANT (sans architecte) vs attend l'ADR O1

### Démarrable maintenant (additif, réversible, design-first)
- **Tout S0** : nommage/figeage frontière, **3 skeletons de protocole**, **no-cycle CI lint**,
  **matrice compat**, **harnais contract-test**, **table de reprise des verbes** (docs).
- **S1 extraction** : déplacer les **schémas** gouvernance vers `governance-protocol` (track reste stable).
- **S2 introduction** : créer `session-protocol` et le faire **transporter** par remote-lib **en addition**
  (les anciens chemins restent).
- **S3 façade en addition** : exposer les verbes `h2a-org`/`h2a-cli` **à côté** de `track`/`remote`, brancher
  `scope-gate` en **mode rapport** d'abord, puis hard-fail derrière un flag.
- **PAS-0** (§2) en particulier.
> Justification : aucun de ces pas ne déprécie, ne renomme publiquement, ni ne déplace de package. Ils sont
> tous réversibles et ne touchent **ni** `remote`/`track`/`sentropic` en écriture destructive **ni** la sortie
> machine. Ils respectent « pas de big-bang » et « anti-cycle ».

### Attend le gate O1 (ADR de réversion BR-42, signé owner-non-h2a + Fabien)
- **Repoint d'umbrella** effectif (fédération `stp` → absorption h2a) au-delà du design.
- **Dépréciation / alias** des binaires `stp`, `remote`, `track` (S4) et tout **rename public**.
- **Bascule hard-fail par défaut** de `scope-gate` sur les chemins externes (vs mode rapport).
- **Déplacement physique** des packages npm (reco SPEC §6 : garder en place — mais toute décision contraire
  est elle-même une décision ratifiée).
- **Retrait** des anciens entrypoints et de la fédération `stp`.
> Justification : ce sont les actes **irréversibles / cross-owner / public-surface** que le consensus
> (objection O1) réserve à un ADR signé par un owner non-h2a + Fabien, h2a ne pouvant pas s'auto-valider.

## 6. Négociation parallèle (non bloquante pour S0–S2)

- Présenter la SPEC + ce PLAN via h2a à `stp` (claude:sentropic:1ac787684c04) et à l'architecte
  (claude:architect:ed8bbd8bf573) pour la **frontière fine libs↔CLI** (Q2) et le **calendrier S4**.
- Le **gate O1** (signature ADR BR-42) revient à **Fabien**. Tant qu'il n'est pas signé, on s'arrête à la
  frontière S3-en-mode-rapport ; rien de public ne bascule.

## 7. Definition of Done de la reprise

- Les 3 protocoles neutres existent, versionnés, testés, **sans cycle** (AC-1).
- h2a expose les surfaces remote+track comme verbes `h2a-cli`/`h2a-org`, **en consommant les libs** via protocoles.
- `track` reste record-only (AC-4) ; `remote` reste autonome (AC-7) et transporte neutre (AC-8).
- Bus keyé par version (AC-2) ; `scope-gate` enforce (AC-3) ; matrice + contract-tests gatent la release (AC-5).
- Alias compat sans régression machine (AC-6), retrait planifié derrière O1 + critères LTS.
