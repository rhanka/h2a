# SPEC — Reprise (ré-absorption) de **remote + track** dans `h2a`

Status: SPEC (design-first ; ouvre la reprise SANS attendre l'architecte sur les lots additifs)
Date: 2026-06-27
Conducteur: claude:a2a-cli (h2a)
Décideur (PRINCIPAL): Fabien
Décision-cadre: **OPTION B (repoint complet)** — `h2a` = CLI + cadre d'org unique de sentropic ; `remote`/`track` = libs.
Sources: `2026-06-27-h2a-sentropic-resegmentation.md` (§8 consensus stabilisé), `2026-06-26-objective-loop-h2a-track-remote.md`.
Syntaxe CLI cible (NE PAS dupliquer ici, référence vivante): `2026-06-27-h2a-unified-cli-syntax.md`.

## 0. Cadrage en une phrase

La **surface CLI** de `remote` et `track` migre vers des verbes `h2a-cli` / `h2a-org` ;
leur **substance technique reste des libs** consommées par h2a au travers de **trois protocoles
neutres** (`session-protocol`, `governance-protocol`, `scope-gate`) qui forment la frontière
anti-cycle. Rien ne fusionne de modèle ; `track` reste record-only, `remote` reste plateforme autonome.

## 1. Périmètre

**Dans le périmètre**
- Définir ce qui, de `remote` et `track`, devient **lib-sans-CLI** vs **verbe h2a**.
- Définir les **3 protocoles neutres** comme frontière (interfaces + ownership), sans les implémenter ici.
- Cartographier les surfaces `remote-cli` et `track` CLI → verbes h2a (renvoi au doc syntaxe).
- Poser les invariants anti-cycle et les critères d'acceptation testables.
- Trancher (avec arguments) le **déplacement physique des packages npm**.

**Hors périmètre (gate O1 / ADR BR-42 requis)**
- Toute **dépréciation** ou rename public du binaire `stp` / `remote` / `track`.
- Le **repoint d'umbrella** lui-même (fédération `stp` → absorption h2a) — déjà tranché en principe (B),
  mais sa *réversion de BR-42* exige un ADR signé owner-non-h2a + Fabien.
- Le **déplacement physique** des repos npm (reco posée §6, exécution gated).
- L'agent offert (code + tout-type) — couvert par le doc syntaxe, traité ailleurs.

## 2. État des lieux (constaté, lecture seule)

| Brique | Réalité actuelle | Conséquence pour la reprise |
| --- | --- | --- |
| `@sentropic/track` v0.19.2 | DÉJÀ lib-first : lib (`.`/`./read`/`./ingest`/`./seam`) + `cli/` mince + `track-mcp` **read-only** + skills | « lib-sans-CLI » = garder lib+MCP-read, **plier les verbes CLI** dans h2a-org. Faible effort. |
| `remote` monorepo | DÉJÀ scindé : **7 libs** (`remote-protocol`, `k8s-orchestrator`, `terminal-transport`, `session-agent`, `secret-broker`, `approval-core`, `browser-bridge`) + **1 CLI UX** (`remote-cli`, `index.ts` ~311 KB, commander) | « lib-sans-CLI » = garder les 7 libs, **plier les verbes `remote-cli`** dans h2a-cli. |
| `@sentropic/h2a-cli` v0.75.0 | Porte DÉJÀ des verbes remote-ish (`remote serve/send`, `drive*`, `loop *`, `conductor-launch*`) + `runtime/{remote,drumbeat,governance,identity,loop,…}` | La reprise **consolide** une surface existante ; ce n'est PAS un greenfield. |

**Implication clé :** la segmentation lib/CLI est **déjà à 80 % faite** côté repos. Le travail neuf est
(a) **extraire les 3 protocoles neutres** de matériaux aujourd'hui éparpillés, (b) **rebrancher** h2a dessus,
(c) **plier** les surfaces CLI. Pas de réécriture de moteur.

## 3. Frontière : lib-sans-CLI vs verbe h2a (par brique)

### 3.1 track
- **Reste lib** : `@sentropic/track` (modèle Item/axes/Decision/Blocker/Acceptance/Priority), `./read`
  (TrackReader fail-closed `requireFresh`), `./ingest`, `./seam`, le **log append-only** + intégrité,
  et `track-mcp` **read-only** (parité CLI/MCP préservée).
- **Devient verbe h2a-org** : `item|decision|blocker|accept|priority|report|query|validate|branch` →
  surface humaine `h2a org …` (cf. doc syntaxe). h2a **enveloppe**, ne **mute pas** le modèle.
- **Invariant** : *record-only* tenu pour acceptance/provenance **ssi** ce sont des record-types **versionnés
  validés par JSON-schema**, interprétés HORS track (projecteurs en h2a-org). Pas de shadow-store h2a.

### 3.2 remote
- **Reste lib** : les 7 packages (orchestration K8s, transport terminal, session-agent Pod-side,
  secret-broker, approval-core, browser-bridge, remote-protocol). Secrets/gateway/runtime **library-owned**.
- **Devient verbe h2a-cli** : `run|attach|ls|status|stop|restore|layout|enroll|workspace|migrate|sync|diff|`
  `auth|secrets|refresh|plugin|h2a-bridge|install|config|connect|disconnect|check|delegate|wake` →
  surface `h2a agent …` / `h2a remote …` (cf. doc syntaxe). h2a est un **caller** des libs remote.
- **Invariant** : `remote` reste **plateforme autonome** capable de tourner sans h2a ; elle **transporte**
  `session-protocol` **sans connaître h2a**.

### 3.3 Ce qui ne bouge PAS
- Les **guards tmux / human-typing** restent dans `h2a-cli` (UX/policy), **jamais** dans la remote-lib.
- La logique **conductor / Objective Loop / RACI** vit en `h2a-org` (projecteurs), **persistée** via track.

## 4. La frontière par les 3 protocoles neutres

Règle de dépendance : **les libs n'importent que `*-protocol` ; h2a importe libs + protocoles ;
aucun protocole n'importe h2a ni une lib applicative.** Taxonomie figée : `h2a-cli` / `h2a-org` /
`@sentropic/*-protocol` — **jamais « h2a » comme nom de lib interne**.

### 4.1 `@sentropic/session-protocol` (anti-cycle O3)
- **Porte** : enveloppes, présence, adressage, **wake-intent**, **delegation-intent**, **capability-tokens**.
- **Matériau source à extraire** : `remote-protocol` (schemas/events/transport) + types envelope/presence/
  addressing de `h2a-cli` + le wake/drive existant (`drive*`, `wake-request`).
- **Ownership** : `@sentropic/remote` le **transporte** sans connaître h2a ; `h2a-cli` implémente
  **wake/delegate comme UX** au-dessus ; **guards tmux/human-typing exclus de la lib**.
- **Clé de bus** : présence/adressage keyés par **version de protocole**, PAS par la string `h2a`.

### 4.2 `@sentropic/governance-protocol` (O2)
- **Porte** : schémas RACI / decision / conductor / objective-loop (record-types versionnés).
- **Persistance canonique** : log append-only `@sentropic/track` — **aucune logique métier** dans track
  (validation JSON-schema + provenance + horodatage seulement). Projecteurs/workflows en `h2a-org`.
- **Effet** : record-only préservé ; ni shadow-store h2a, ni merge de modèle track.

### 4.3 `@sentropic/scope-gate` (O4)
- **Porte** : un **gate unique** appelé AVANT toute écriture track/statut/commit.
- **Vérifie** : règles de scope présentes, **verdict harness signé**, statut track cohérent. **Hard-fail**
  sans preuve. `--break-glass` écrit un **record auditable**.
- **Ownership stratifié préservé** : track = règles + statut ; harness = verdict-commit ; le gate orchestre,
  ne fusionne pas les ownerships.

## 5. Mapping des surfaces → h2a (renvoi au doc syntaxe)

> La **syntaxe normative** vit dans `2026-06-27-h2a-unified-cli-syntax.md`. Ci-dessous la **table de reprise**
> (origine → famille h2a → protocole-frontière), pas la syntaxe finale.

| Origine (CLI actuelle) | Famille h2a cible | Protocole de frontière |
| --- | --- | --- |
| `remote run/attach/ls/status/stop/restore/layout` | `h2a-cli` agent lifecycle | session-protocol |
| `remote delegate / conductor-launch / wake` | `h2a-cli` delegate/wake (UX) | session-protocol (intent) |
| `remote workspace/migrate/sync/diff` | `h2a-cli` workspace | session-protocol + remote-lib |
| `remote auth/secrets/refresh/plugin` | `h2a-cli` (caller de secret-broker/plugin libs) | remote-lib (library-owned) |
| `remote enroll/install/config/connect/disconnect/check` | `h2a-cli` connectivity | session-protocol |
| `remote h2a-bridge` | `h2a-cli` bus transport | session-protocol |
| `track item/decision/blocker/priority` | `h2a-org` backlog | governance-protocol (records) |
| `track accept/run/waive` | `h2a-org` acceptance | governance-protocol + scope-gate |
| `track report/query/validate` | `h2a-org` views (read) | track `./read` (inchangé) |
| `track branch import` | `h2a-org` provenance | governance-protocol + scope-gate |
| `stp <sub>` (fédération) | `h2a` front-door (registry de sous-verbes) | — (alias compat, gate O1) |

## 6. Reco — déplacement physique des packages npm

**Question :** déplacer `remote`/`track` (et les 3 protocoles) dans un monorepo h2a, ou les garder en place
versionnés à part ?

**Option A — Garder en place, versionner séparément (RECO).**
- *Pour* : (1) anti-cycle **garanti par la frontière repo** (une lib ne PEUT pas importer `h2a-cli`/`h2a-org`) ;
  (2) honore l'invariant « remote reste plateforme autonome » et « un seul plugin déployé = h2a, libs versionnées
  à part » (§4-6 + §8 staging du doc-cadre) ; (3) **réversible** et faible blast-radius ; (4) préserve les
  cadences de release indépendantes et les CI existantes.
- *Contre* : orchestration de **contract-tests cross-repo** ; gestion d'une **matrice de versions** ; boucle de
  dev locale plus lente (publish/`npm link`).

**Option B — Déplacer dans un monorepo h2a.**
- *Pour* : boucle de dev mono-repo, refactors atomiques, contract-tests co-localisés.
- *Contre* : **re-tente le cycle** (la proximité physique invite les imports de h2a depuis les libs) ; casse
  « remote autonome » ; **big-bang** (viole l'invariant #1) ; **peu réversible** ; confond « un plugin déployé »
  avec « un repo ».

**Recommandation :**
1. **remote + track : rester dans leurs repos actuels.** La surface **CLI** migre (verbes), pas les **packages**.
2. **Les 3 `*-protocol` : packages NEUTRES dans un emplacement neutre** (repo/workspace `sentropic-protocols`
   dédié, ou chacun son repo) — **ni** sous h2a **ni** sous remote, pour éviter la collision
   protocole/org/runtime/CLI (must-fix #6) et l'illusion d'ownership.
3. Une éventuelle **consolidation workspace** plus tard = **décision ratifiée séparée**, non bloquante, **après**
   que la frontière protocolaire + le no-cycle-lint soient verts (sinon on importe le cycle dans le monorepo).

## 7. Invariants anti-cycle (à enforcer en CI)

1. `*-protocol` n'importe **rien** d'applicatif (ni h2a, ni lib remote/track) — protocoles purs.
2. Libs (`remote-*`, `track`) importent **uniquement** `*-protocol` (+ leurs deps techniques).
3. `h2a-cli` / `h2a-org` importent libs + protocoles ; **jamais** l'inverse.
4. **Bus présence/adressage keyé par version de protocole**, PAS par la string `h2a`.
5. **Guards tmux/human-typing** confinés à `h2a-cli`.
6. **track record-only** : écritures gouvernance = record-types versionnés validés par schema, interprétés hors track.
7. **scope-gate obligatoire** avant toute écriture track/statut/commit ; `--break-glass` ⇒ record auditable.

## 8. Critères d'acceptation (testables)

- **AC-1 No-cycle** : un lint de graphe (dep-cruiser/madge) **échoue** si une lib importe `@sentropic/h2a-cli`
  ou `h2a-org`, ou si un `*-protocol` importe quoi que ce soit d'applicatif.
- **AC-2 Bus par version** : deux instances déclarant des strings d'org différentes mais **même version de
  `session-protocol`** s'adressent/se découvrent ; un mismatch de version **dégrade proprement** (test).
- **AC-3 scope-gate hard-fail** : un test de conformité **échoue** si une commande écrit track/statut/commit
  **sans** passer le gate ; `--break-glass` produit un record auditable vérifiable.
- **AC-4 record-only tenu** : toute mutation gouvernance via track est un **event versionné validé par
  JSON-schema** ; aucune logique métier dans track (test : track refuse un record non conforme, n'interprète pas).
- **AC-5 Matrice compat** : `h2a-cli@M` déclare `track-protocol@N..`, `session-protocol@N`, `remote-lib@N..`,
  `governance-protocol@N` ; les **contract-tests inter-lib gatent la release** h2a (rouge = pas de release).
- **AC-6 Compat surface** : `remote`, `track`, `stp` continuent de fonctionner (alias) **sans changement de
  sortie machine** ; un test de parité JSON le prouve avant tout retrait.
- **AC-7 remote autonome** : la suite de tests `remote` (libs) reste **verte sans h2a installé** (la lib ne
  dépend pas de h2a).
- **AC-8 transport neutre** : `@sentropic/remote` transporte une enveloppe `session-protocol` **sans importer**
  ni connaître h2a (test d'isolation d'import).

## 9. Risques & parades

| Risque | Parade |
| --- | --- |
| Cycle réintroduit par commodité | AC-1 en CI bloquante, protocoles en emplacement neutre (§6) |
| Merge implicite du modèle track | AC-4 + record-types versionnés ; projecteurs hors track |
| Big-bang | Lots additifs S0–S2 démarrables sans dépréciation ; retrait gated O1 |
| Collision de noms (`h2a` lib/org/proto) | Taxonomie figée §4 ; jamais « h2a » comme nom de lib |
| Guards de sécurité tirés dans la lib | §3.3 + AC-8 ; guards confinés h2a-cli |
| Self-validation de h2a (conflit d'intérêt) | Gate O1 : réversion BR-42 = ADR signé owner-non-h2a + Fabien |

## 10. Dépendances vers le PLAN

Le découpage en lots, le 1er pas réversible, les gates par lot et la frontière
**démarrable-maintenant vs attend-l'ADR-O1** sont dans `2026-06-27-remote-track-reprise-plan.md`.

---

## Consensus amendments (Opus-4-8 + Codex 5.5 xhigh — 2026-06-27)

Verdict des deux pairs = **AMEND** (convergent). Doivent entrer dans la SPEC/AC **avant** de lancer S0.

### M1 — PAS-0 non-canonique + conformité golden-fixtures (bloquant; sans lui ne pas démarrer)
Le skeleton de protocole dérivé crée une **double source de vérité** qui diverge. PAS-0 doit :
- marquer chaque paquet protocole `status: experimental / non-authoritative` ;
- porter la **provenance** vers les shapes sources (remote-protocol / h2a-cli) ;
- inclure un **test de conformité golden-fixtures** : de vraies enveloppes/presence capturées, diffées contre le schéma ; la divergence **échoue en CI** ;
- **interdiction d'être consommé** par un caller tant que l'ownership canonique n'est pas ratifié (M3).

### M2 — Anti-cycle mécanique (pas un nom)
- **Test build clean-room** : chaque `*-protocol` se build/installe avec **zéro h2a/remote/track présent**.
- **Lint d'imports** couvrant runtime + **type-only** + devDeps + `package.json` exports (pas seulement les imports runtime).
- **DAG explicite** des protocoles : interdire les cycles protocole↔protocole ; **trancher le sens `scope-gate → track`** (le gate lit le statut track → dépendance dirigée déclarée, jamais l'inverse).

### M3 — Ownership & ratification des protocoles (COI d'autorat — remonte à Fabien)
Le COI n'était nommé que pour BR-42. Or h2a écrit les 3 protocoles à partir de ses propres types → « neutre » non relu. Exiger :
- un **owner explicite non-h2a par protocole** ;
- un **AC de ratification** : les schémas `session/governance` doivent être **ratifiés par un owner non-h2a** (architecte/remote/track) avant de devenir canoniques ;
- **semver strict + `peerDependencies`** sur les protocoles + **single-version enforcement** (anti-diamant ; npm peut dédupliquer 2 majors en silence).

### M4 — Durcir les critères d'acceptation
- AC-2 « dégrade proprement » → redéfinir en **comportement observable** (rejet / warn / refus de découverte explicite), sinon non-testable.
- AC-3 (scope-gate) → exige une **instrumentation centralisée des write-paths** (sinon « aucune écriture sans gate » est improuvable).
- AC-4 → distinguer **validation schema** vs **interprétation métier**.
- AC-5 (matrice compat) → **fichier machine-readable + CI matrix**, pas un tableau de doc ; au moins **un round-trip vert dès S0** (un contract-test perpétuellement rouge se fait désactiver).
- AC-6 → lister explicitement les **sorties machine contractuelles**.
- AJOUTER AC : (i) sens scope-gate→track ; (ii) acyclicité protocole↔protocole ; (iii) single-version ; (iv) conformité schéma↔réel (golden-fixtures).

### M5 — Bus : dual-key transitionnel, pas un re-key (corrige le PLAN S2)
Re-keyer la présence/adressage vivant par version **change le comportement machine** (deux agents en vol peuvent cesser de se découvrir au cutover). → **dual-key transitionnel** : ancien + nouveau en parallèle, bascule progressive. Ce lot n'est **ni purement additif ni réversible** → de facto **gated** (pas « maintenant »).

### Frontière maintenant/O1 — corrigée
- **Démarrable maintenant (sans architecte)** : skeletons **non-canoniques** + golden-fixtures + lint clean-room + scope-gate **mode-rapport** + matrice machine-readable + harnais de tests. Aucune publication de paquet, aucun nom/version de protocole **consacré**.
- **Attend gate O1 / ratification owner** : extraction effective des schémas gouvernance **canoniques**, re-key bus (dual-key), hard-fail scope-gate sur chemins publics, dépréciation/rename des binaires, repoint d'umbrella.

**Statut : AMENDÉE par double consensus. M1–M5 sont des pré-requis S0.**

---

## Gouvernance anti-COI — comment on sort de « neutre écrit par le bénéficiaire » (2026-06-27, validé Fabien)

M3 est **renforcé** : on ne corrige pas le conflit d'intérêt par déclaration de bonne foi, mais par **structure**.

### G1 — L'AUTORAT des protocoles quitte h2a
Par la règle « sentropic = libs », les 3 protocoles (`session-protocol`, `governance-protocol`, `scope-gate`) sont des **libs sentropic** → **owned par l'architecte (owner du lib layer)**, PAS par h2a.
- h2a fournit un **draft de départ** (il a le contexte de la couture) ; il **n'est pas owner**, **ne ratifie pas**, **n'est pas signataire décisif**.
- **L'architecte peut pousser ses propres préconisations** sur les schémas (il est auteur/owner, pas relecteur passif).
- Auteur/owner (sentropic/architecte) ≠ bénéficiaire (h2a-la-CLI). Le COI se dissout mécaniquement.

### G2 — L'architecte fait SON PROPRE double consensus
Les préconisations protocole de l'architecte doivent passer **son** double consensus (**au moins opus-4-8 max** + un 2ᵉ pair). h2a **ne pilote pas** la review de l'architecte (sinon h2a recapture le processus). C'est l'architecte qui lance et réconcilie son double consensus.

### G3 — Quorum de ratification non-h2a
Un schéma de protocole ne « land » qu'avec **≥2 signatures d'owners non-h2a** : **architecte + le consommateur concerné (remote et/ou track)**. La signature de h2a seule ne valide jamais un protocole. h2a **déclare son conflit d'intérêt** sur la négociation (traçable).

### G4 — Neutralité FALSIFIABLE (pas affirmée)
- **golden-fixtures** = vrai trafic capturé à la frontière remote↔track↔h2a → le protocole DÉCRIT le contrat existant, n'invente pas celui que h2a préfère ;
- **build clean-room** : le protocole compile avec zéro h2a/remote/track présent ;
- **preuve du 2ᵉ consommateur** : un appelant non-h2a peut piloter remote/track via le protocole. Sinon = capturé, pas neutre.

### G5 — Dogfood de l'anti-COI h2a
Ce chantier est le cas-test de la couche gouvernance : `declare-interest`/`conflict-posture` (h2a déclare son COI), `negotiate requiredSigners` (quorum non-h2a enforced), `attest-comprehension` (les ratificateurs attestent comprendre, pas tamponner). Si h2a ne sait pas contraindre son propre auteur avec ses propres outils, la thèse « gouvernance centrée humain » échoue. C'est la preuve par l'exemple.

**Conséquence sur le plan** : l'extraction *canonique* des protocoles est désormais gated par (architecte draft+push → son double consensus → quorum non-h2a + golden-fixtures). h2a peut continuer le **draft non-canonique** (PAS-0 `experimental`) sans rien consacrer.

---

## Ratification architecte — préconisations indépendantes + son propre double consensus (2026-06-27)

L'escape anti-COI a fonctionné : l'architecte (owner non-h2a) a écrit SES préconisations (`sentropic spec/SPEC_DECISION_PROTOCOL_LIBS_BOUNDARY.md`), lancé SON propre double consensus (Opus-4-8 max ACCEPT_WITH_CONDITIONS + Codex 5.5 xhigh NEEDS_DESIGN_FIRST), et **a trouvé des trous que le draft « neutre » de h2a cachait**. Ces fixes **supersèdent** M1–M5 là où ils sont plus tranchants.

**Frontière confirmée (decision structurante #1)** : gateway/MCP/transport/k8s/crypto/identité restent libs `@sentropic/*` consommées par la CLI h2a unique ; les 3 protocoles rejoignent cette couche comme **packages owned-architecte** ; anti-cycle enforcé **mécaniquement en CI**.

### Binding fixes (pré-requis avant schémas canoniques)
- **P2 — `gateDecision` est FORGEABLE → EvaluationReceipt SIGNÉ** : prouver que le JSON porte le champ ≠ prouver que le gate a tourné. Remplacer par un reçu **signé par scope-gate** liant `inputsDigest = hash(scopeRules ‖ harnessVerdictSig ‖ trackStatusCursor ‖ recordContentHash) + evaluatorVersion + nonce`. Track **vérifie la signature ET re-dérive `inputsDigest`** à l'admission ingest. Le gate reste **PUR** (calcule + signe, n'écrit jamais). [supersède mon scope-gate]
- **P1 — governance-protocol SPLIT en deux** : (a) `/track` = **extraction** des record-types déjà validés par track (Decision/Acceptance/Blocker/Priority/Provenance + RACI-en-champs, vérifié sur le vrai repo) ; (b) `/projection` = conductor + objective-loop **NON owned par track** → schémas **NET-NEW**, owner non-track séparé, **pas de claim "0-change"**. Direction SEAM corrigée : **track PUBLIE ses schémas, le protocole les PIN** (pas d'import track→protocole). [corrige ma fausse claim "0-change"]
- **P4 — CODEOWNERS par-path = quorum non-h2a MÉCANIQUE** : garder `sentropic/packages/*` (pas de repo neutre séparé), mais **CODEOWNERS per-path + branch-protection** rend le quorum non-h2a (G3) **mécanique, pas social** + clean-room CI + interdiction des path-imports + release-gate séparé. [supersède mon "emplacement neutre"]
- **P5 — CapabilityToken ABSTRAIT** : l'audience RFC 8707 (BR-39) est **non-construite** (MCP hardcode l'audience à userinfo) → P5 = **dépendance gatée sur BR-39l**, pas réutilisation. session-protocol porte une **interface CapabilityToken abstraite** maintenant.
- **P3/P6 — endossés** : DAG dirigé (seul edge `scope-gate→governance-protocol`), clean-room build + import-lint type-only + single-version peerDeps ; bus dual-key transitionnel gate (= M5).

### Démarrable maintenant vs owner-gated (architecte)
- **Maintenant (co-signé frontière P0/P3/P6)** : lots PAS-0 **non-canoniques** (`experimental`), clean-room CI, import-lint, harnais golden-fixtures, matrice machine-readable, scope-gate mode-rapport, CODEOWNERS posés.
- **Owner-gated (NEEDS_DESIGN_FIRST)** : les 3 schema-decisions (P1 split, P2 receipt, P5 token) ratifiées **seulement après** golden-fixtures + clean-room + **receipt-verification harness verts**, **avec quorum ≥2 owners non-h2a** (architecte + remote/track). L'architecte **a demandé le quorum** à remote+track.
- **NON signé par l'architecte** : la réversion BR-42 (O1) → **ADR owner-gated Fabien**. h2a reste en COI déclaré, non-signataire décisif.
