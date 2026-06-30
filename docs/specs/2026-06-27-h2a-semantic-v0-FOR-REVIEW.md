# Sémantique h2a v0 — POUR REVUE

> **But du doc.** Consolider en UN seul endroit la sémantique de `h2a` issue de 8 specs éparses
> (re-segmentation, grammaire CLI, naming `agent`, reprise remote/track, design+knowledge,
> agent-stats, canevas EVO-4, ADR BR-42). **Ce doc NE VERROUILLE RIEN** : il sépare ce qui est
> **DÉCIDÉ** de ce qui reste **À-VALIDER-PAR-FABIEN**, pour relecture à froid, à ton rythme.
>
> Statut : SYNTHÈSE pour validation humaine · Date : 2026-06-27 · Décideur : Fabien (PRINCIPAL)
> · h2a = signataire NON décisif (COI déclaré sur la re-segmentation).

---

## 1. Le modèle en une page

- **h2a = LA CLI de sentropic.** Un cadre d'**organisation centré humain** pour agents
  **conversationnels ET de code**. Axe de segmentation = **CLI/ORG vs LIBS** (décision **B**,
  « repoint complet » : la clé de voûte passe de `stp` à `h2a`).
- **sentropic = les libs techniques** (`@sentropic/*`) : gateway, LLM-mesh, MCP/auth, transport/
  session, identité/crypto/NHI, k8s/deploy, design-system. **Elles n'importent JAMAIS h2a**
  (anti-cycle dur, enforcé en CI).
- **Un seul plugin déployé = h2a.** Les libs restent versionnées/publiées à part.
- **h2a offre UN agent** : faire du **code** (≈ Claude Code) **et** des **tâches de tout type**
  (≈ délégation « Hermes » de remote). MVP = `h2a agent run|attach|delegate|logs|wake`, capabilities
  explicites, journalisation track, **pas d'auto-conductor complet** au départ.
- **Frontière par 3 protocoles neutres** owned-architecte (anti-cycle + anti-COI) :
  `session-protocol` (enveloppes/présence/adressage/wake-intent/delegation-intent/capability-token),
  `governance-protocol` (RACI/decision/conductor/objective-loop), `scope-gate` (gate de write).
- **Rien ne fusionne de modèle.** track reste **record-only**, remote reste **plateforme autonome**.

```
            ┌──────────────────────────── h2a (LA CLI + cadre ORG) ────────────────────────────┐
  HUMAIN ── │  h2a-cli (agent lifecycle, wake, delegate)   h2a-org (track UX, gouvernance, canevas) │
            └──────────┬───────────────────────────────────────────────┬───────────────────────┘
                       │ importe (one-way)                              │ dispatch (additif)
        ┌──────────────▼──────────────┐                ┌────────────────▼─────────────────┐
        │  sentropic LIBS @sentropic/* │                │  PRODUITS ADDITIFS (gardent leur CLI) │
        │  remote(7 libs) · track · …  │                │  design · knowledge(graphify) · agent-stats │
        │  + 3 *-protocol (architecte) │                └───────────────────────────────────┘
        └──────────────────────────────┘     ⚠ les libs/produits N'IMPORTENT JAMAIS h2a (anti-cycle)
```

---

## 2. Carte des namespaces / verbes (grammaire stabilisée par double consensus)

Grammaire **2 tiers**, à la Hermes : `h2a <verbe>` (Tier 1, le quotidien) ou
`h2a <namespace> <verbe>` (Tier 2, le spécialiste). On compose ~13 verbes × ~13 namespaces au lieu
de mémoriser ~160 noms. Principe : **un verbe = un sens** ; le *namespace* change l'objet, pas l'acte.

### Verbes bare (Tier 1) — propriétaires figés (après amendement double consensus)

| Verbe bare | Sens / objet par défaut | Statut |
|---|---|---|
| `ls` | énumère les pairs/sessions vivants | bare OK |
| `status` | inventaire agents/sessions (jamais mute) | bare OK (= inventaire) |
| `report` | roll-up état travail (track, dérivé read-only) | bare OK (= travail) |
| `find` | résout un pair par nom/rôle/scope (présence-aware) | bare OK |
| `send` | livre une enveloppe à une cible | bare OK — **resolve-before-send + liveness-gate** |
| `run` / `attach` / `stop` / `logs` | lifecycle d'instance agent | bare OK |
| `wake` | nudge signé d'un pair calé/idle (drive + relance + wake-request) | bare OK |
| `delegate` | confie une tâche → job id (alias de `agent delegate`) | bare OK (alias) |
| `decide` | **scindé** : bare = décision **track uniquement** | bare OK (track-only) |
| `verify` | **namespace-obligatoire** (PAS de bare) | interdit en bare |
| `block` / `check` | **namespace-obligatoire** (modèles distincts) | interdit en bare |

**Décisions de réconciliation appliquées (§11 grammaire + §8 naming) :**
- `verify` **jamais bare** : `h2a dev verify` (gate), `h2a sysml verify`, `h2a nego comp verify`,
  `h2a track scope`. Un bare `verify` = faux-pass silencieux pour un user track → **interdit**.
- `decide` **scindé** : bare `h2a decide` = décision track ; `h2a job decide` = réponse à un job.
  Pas d'union.
- `block` distinct : `h2a block`/`impediment` (pair, EVO-3) ≠ `h2a track blocker` (dépendance
  travail). Pas de `--kind` qui enterre la différence de modèle.
- `check` non transverse : `h2a dev check` ≠ `h2a sess/host check`.
- **Pas de flip `--json`** (Q7 = NON) : on **garde DEC-034 machine-first**. Ajout `--human` + env
  `H2A_OUTPUT=json|human`. Tout flip human-on-TTY = nouveau DEC + **major bump** (fragile en
  tmux/ssh/pane capturé).
- `send` **ne devine pas le transport** : résolution canonique + vérif de présence AVANT envoi ;
  `--url` explicite pour le distant (invariant addressing, npm 0.60.0).

### Taxonomie `agent` STRICTE (DÉCIDÉ Fabien) — le trou central résolu

`agent` = **uniquement les INSTANCES RUNTIME que JE lance/supervise**. Les autres populations
gardent leurs namespaces distincts (sinon `agent` collisionne avec pair-de-bus / NHI / sub-registry).

| Concept | Surface | N'est PAS `agent` |
|---|---|---|
| Instance runtime que JE lance (interactif/headless/local/Pod) | `h2a agent run/ls/attach/logs/stop/wake/inspect` | — |
| Tâche déléguée (contrat + résultat + supervision) | `h2a agent delegate` crée ; **type `job`** supervise (`h2a job ls/decide/conduct`) | distinct du lifecycle |
| Pair découvert sur le bus (présence) | `h2a find` / `h2a ls` | **pas** `agent ls` |
| Identité non-humaine | `h2a nhi …` | |
| Subagent délégué enregistré | `h2a sub …` | |

Règle : `h2a agent ls` = **mes instances lancées**, jamais les pairs du bus. `--remote` =
**placement** (Pod/k8s), pas identité ; `--remote-url` séparé. `delegate` reste un **verbe**
(création d'un job avec contrat), PAS un mode-flag de `run`.

### Namespaces (Tier 2) — roster cible (~13)

| Namespace | Possède | Origine |
|---|---|---|
| `agent` | lifecycle des instances que je lance | ex-`remote run`/wrappers |
| `job` | supervision de délégation (decide/conduct/queue) | ex-`remote jobs` |
| `track` | état de réalisation (item/decision/blocker/accept/scope/report) | ex-`track` (lib) |
| `dev` | discipline harness (check/verify/brainstorm/plan/test/debug/review/branch) | ex-`harness` |
| `nego` | négociation + trust ledger (open/sign/stabilize/dossier/trust/comp) | h2a |
| `msg` | mailbox + threads | h2a inbox/outbox |
| `key` · `nhi` · `sub` | clés ed25519 · identités non-humaines · subagents | h2a |
| `cond` · `drum` | élection conductor · drumbeat anti-stall (gardés séparés, pas de `gov`) | h2a |
| `host` | wiring MCP/hook + **plomberie de déport** (workspace/sync/migrate/forward/tunnel) + `mcp`replié | h2a + ex-remote infra |
| `bus` | transport HTTP (ex-`h2a remote serve/send`, alias legacy `h2a remote`) | h2a |
| `canevas` | écran focus de décision (compose nego+design+track) | NOUVEAU (EVO-4) |

À AJOUTER (outillage migration, non négociable) : `h2a help map`, `h2a explain <ancienne-cmd>`,
`h2a alias/compat`, `completion`, `which`. Les ~160 noms legacy restent appelables **avec warning
de dépréciation**.

---

## 3. Ce qui entre, et COMMENT

Deux modèles d'intégration radicalement différents — **ne pas les confondre** :

| Brique | Modèle | Garde sa CLI ? | Surface h2a | Anti-cycle |
|---|---|---|---|---|
| **track** | **ABSORBÉ** (lib-sans-CLI) | non → alias legacy | `h2a track …` / `h2a report` (h2a **enveloppe**, ne mute pas ; record-only) | h2a → lib track |
| **remote** | **ABSORBÉ** (lib-sans-CLI ; 7 libs déjà scindées) | non → alias legacy | `h2a agent …` (lifecycle) + `h2a host …` (déport) + `h2a bus …` | h2a → libs remote |
| **harness** | **MÉTHODE** (kernels, supplante superpowers) | folded | `h2a dev …` ; `scope` stratifié (track=règles, harness=verdict, track=statut) | via `scope-gate` |
| **design** (DS) | **ADDITIF** (fédéré) | **OUI** (`design`/`sentech-design`) | `h2a design …` (dispatcher mince) | DS n'importe jamais h2a |
| **knowledge** (graphify) | **ADDITIF** (fédéré) | **OUI** (`graphify`) | `h2a knowledge …` (dispatcher mince) | graphify n'importe jamais h2a |
| **agent-stats** | **ADDITIF** (lib consommée) | **OUI** (`agent-stats`) | `h2a agent stats <id>` (instance-scoped) | h2a → `agent-stats-core` |
| **stp** | **DÉPRÉCIÉ immédiat** (0 caller réel) | alias compat → retrait gated LTS | `h2a` front-door = ex-umbrella | — |

**Détail des surfaces additives (gardent leur binaire, dispatch + normalisation `--json`/exit) :**

- **`h2a design …`** (owner-validé, verbes réels) : `lint`→`audit`/`audit:visual`/`audit:parity` ·
  `check` (gate 0-100) · `build`/`align`/`polish`/`init` (dispatch direct) · `fidelity` = alias de
  `audit:parity` (preuve a11y/WCAG-AA) · `tokens`/`theme clone`/`views` = wrappers fédérés (sources ≠
  binaire). Contrat de vues = `@sentropic/design-system-views` (**owner DS, versionné semver**) =
  seam de rendu de TOUS les canevas.
- **`h2a knowledge …`** : `ingest`/`query`/`graph`/`ontology`/`export`/`agents`. Nom = l'objet
  (knowledge), pas la marque graphify. Re-expose le MCP read-only `graphify serve`.
- **`h2a agent stats <slug|id>`** (instance-scoped, recommandé) : projection read-only des
  tokens/cost/quota **de l'instance que j'ai lancée**, en déléguant à `agent-stats-core`. Rejeté :
  `h2a agent-stats` (verbe-marque) et `h2a stats` bare (revendiquerait l'analytics cross-vendor).

**stp (DÉPRÉCIATION immédiate, ADR approuvé) :** scan Annexe C = **0 invocation réelle** de `stp`
(CI/Makefile/scripts) → critère LTS « 0 caller externe » déjà satisfait. Retrait après 2 minors
sans rupture + docs/CI migrées + contract-tests verts. `stp app` = exception documentée jusqu'à
livraison de `h2a app`.

---

## 4. Gouvernance (anti-COI mécanique, pas déclarative)

Le problème central : **h2a écrit des protocoles « neutres » à partir de ses propres types →
juge et partie.** Résolution = structure, pas bonne foi.

**Anti-COI sur les 3 protocoles (G1–G5, validé Fabien) :**
- **G1 — l'autorat quitte h2a** : les 3 `*-protocol` sont des libs sentropic → **owned-architecte**.
  h2a fournit un *draft* (il a le contexte de couture) ; il n'est **pas owner**, **ne ratifie pas**.
- **G2 — l'architecte fait SON propre double consensus** (opus-4-8 max + 2ᵉ pair). h2a ne pilote pas.
- **G3 — quorum de ratification ≥2 owners non-h2a** (architecte + remote et/ou track). h2a seul ne
  valide jamais. h2a **déclare son COI** (traçable).
- **G4 — neutralité FALSIFIABLE** : golden-fixtures (vrai trafic capturé), build clean-room (zéro
  h2a/remote/track présent), preuve du 2ᵉ consommateur (un appelant non-h2a pilote remote/track).
- **G5 — dogfood** : `declare-interest`/`conflict-posture`/`requiredSigners`/`attest-comprehension`
  contraignent h2a avec ses propres outils. Si la gouvernance ne sait pas se contraindre, la thèse
  « centrée humain » échoue.

**Ratification architecte (binding fixes, supersèdent le draft h2a là où plus tranchants) :**
- **P1** — `governance-protocol` **SPLIT** : `/track` = extraction de record-types déjà validés
  (Decision/Acceptance/Blocker/Priority/Provenance) ; `/projection` = conductor+objective-loop
  **NET-NEW, owner non-track**. Seam corrigée : **track PUBLIE, le protocole PIN** (pas d'import
  track→protocole).
- **P2** — `gateDecision` est **FORGEABLE** → remplacé par **EvaluationReceipt SIGNÉ** par scope-gate
  (`inputsDigest = hash(scopeRules ‖ harnessVerdictSig ‖ trackStatusCursor ‖ recordHash)`). Track
  **vérifie la signature ET re-dérive** à l'ingest. Le gate reste **PUR** (calcule + signe, n'écrit
  jamais).
- **P4** — **CODEOWNERS per-path + branch-protection** = quorum non-h2a **mécanique** (pas de repo
  neutre séparé ; `sentropic/packages/*`).
- **P5** — `CapabilityToken` **ABSTRAIT** (l'audience RFC 8707 / BR-39 est non-construite → dépendance
  gatée, pas réutilisation).
- **P3/P6** — DAG dirigé (seul edge `scope-gate → governance-protocol`), clean-room + import-lint
  (type-only inclus) + single-version peerDeps ; bus **dual-key transitionnel** (pas un re-key brutal).

**Canevas EVO-4 — l'écran focus de décision (la pièce manquante) :** une surface réutilisable qui
prend une décision/ADR, la **présente à un humain par une partie NON conflictée**, avec la
**dissidence attachée**, et capture une **vraie signature**. Trois couches séparées (non-négociable) :

| Couche | Possède | Vit dans | Ne fait JAMAIS |
|---|---|---|---|
| **SÉMANTIQUE** | modèle `decision-canevas` + dérivations COI/confiance | h2a-org (`h2a canevas`) | rendre des pixels ; minter une signature |
| **RENDU** | l'écran focus (vue Svelte embeddable) | design-system (`design views`) | importer h2a ; décider |
| **SIGNATURE** | attestation humaine + quorum | **la clé du HUMAIN** (`attest-comprehension` + `negotiate sign`) | être produite par un agent à la place du humain |

Garanties mécaniques : **présenter ≠ bénéficiaire** (`presenterBias` blocking sur la surface) ·
**dissidence obligatoire** si une partie est lésée · **l'agent ne peut pas fabriquer la signature**
(clé privée du humain requise ; MCP-as-API ne fait que **relayer** une attestation déjà signée) ·
**décideur ≠ relai** (le canal MCP n'est jamais enregistré comme le décideur humain). Surface
candidate : `h2a canevas open|show|present|sign|status`.

---

## 5. DÉCIDÉ vs À-VALIDER-PAR-FABIEN

### ✅ DÉCIDÉ (acté, ne pas rouvrir sans raison)

- **Décision B** — repoint complet : h2a = LA CLI/cadre-org unique de sentropic ; sentropic = libs.
- **ADR BR-42 réversion** — **APPROUVÉ Fabien + CO-SIGNÉ architecte** (quorum O1 satisfait).
- **Dépréciation `stp` immédiate** — 0 caller réel prouvé (Annexe C) ; retrait gated LTS.
- **Taxonomie `agent` stricte** (DÉCIDÉ Fabien) — `agent` = instances que je lance ; `find` = pairs ;
  `nhi` = NHI ; `sub` = registre. Garder le mot `agent` (pas `instance`/`run`).
- **design / knowledge / agent-stats = ADDITIFS** — gardent leur CLI, dispatch + anti-cycle one-way.
- **Anti-COI G1–G5** + autorat protocoles owned-architecte + quorum ≥2 non-h2a + neutralité
  falsifiable. h2a = signataire NON décisif.
- **Invariants durs** : anti-cycle CI ; track record-only ; remote autonome ; un seul plugin déployé ;
  guards tmux/human-typing confinés à h2a-cli ; bus keyé par version de protocole (pas la string `h2a`).
- **Pas de flip `--json`** (DEC-034 machine-first préservé) ; `send` resolve-before-send + liveness-gate.

### ❓ À-VALIDER-PAR-FABIEN (la SÉMANTIQUE CLI n'est PAS figée — l'ADR le dit explicitement)

> L'ADR BR-42 acte le **repoint topologique** mais laisse la **sémantique CLI (grammaire/verbes) EN
> ATTENTE de validation Fabien — NE PAS figer les verbes.** Les points ci-dessous en découlent.

- **La grammaire de verbes fine** : le roster bare exact, `verify`/`block`/`check` namespace-only,
  `decide` scindé — adjugés par double consensus, **pas encore validés Fabien**.
- **Le nom du bus HTTP** : `h2a bus` (vs garder `h2a remote`) — prérequis avant de réutiliser/retirer
  le mot `remote` pour la plomberie de déport.
- **L'agent-stats estate-wide ORPHELIN** : `h2a agent stats <id>` ne couvre QUE mes instances ; la vue
  cross-vendor reste dans `stp agent-stats` — **mais stp est déprécié**. Où va la surface estate-wide ?
- **La frontière exacte de quelques namespaces** : plomberie de déport sous `host` vs `deploy` ;
  `cond`/`drum` séparés vs `gov` ; `mcp` replié dans `host` ; `canevas` top-level vs `nego canevas`.
- **`init` scope** : `h2a init` = h2a-core par défaut, `--all` opt-in pour `.track`+profil dev (pas de
  seed multi-store silencieux) — à confirmer.
- **Périmètre MVP de l'agent offert** : réutilise la délégation remote (façon Hermes) ou nouveau ?
- **Le nom `knowledge`** vs `graph` vs garder `graphify` (question owner, Q-K5).

---

## 6. Tensions résiduelles (honnêtes)

1. **COI structurel non réparable par process (dissidence stp, la plus forte)** : faire d'un
   participant (h2a) le portail de TOUS les autres crée une incitation long-terme à favoriser ses
   idiomes ; nommer le COI ne supprime pas l'incitation. Le fallback **A (scinder/différer)** reste
   ouvert si un owner non-h2a bloque.
2. **L'agent-stats estate-wide orphelin** par la dépréciation de stp (cf. §5) : la vue cross-vendor
   n'a plus de maison claire une fois `stp agent-stats` retiré.
3. **Double source de vérité protocolaire** : les skeletons dérivés des types h2a peuvent diverger du
   réel → mitigé par golden-fixtures + statut `experimental/non-authoritative` tant que non ratifiés,
   mais le risque demeure jusqu'à la ratification owner.
4. **Re-key du bus = non purement additif** : deux agents en vol peuvent cesser de se découvrir au
   cutover → dual-key transitionnel obligatoire, donc **gated** (pas « maintenant »).
5. **Vélocité vs design-first** : les pairs notent que B est plus lent que le statu quo fédéré ; B
   tranche, mais tout est gaté par les contract-tests + golden-fixtures + receipt-verif verts.
6. **`canevas` introduit un namespace top-level de plus** (~13→14) alors que la pression est à
   « minimal » (Hermes) ; arbitrage learnability vs découvrabilité ouvert.

---

*Sources consolidées (toutes sous `docs/specs/`, 2026-06-27) : `h2a-sentropic-resegmentation.md`,
`h2a-unified-cli-syntax.md`, `h2a-agent-naming-brainstorm.md`, `remote-track-reprise-spec.md`,
`h2a-design-knowledge-integration.md`, `h2a-agent-stats-integration.md`,
`h2a-canevas-evo4-decision-screen.md`, `ADR-br42-reversal-DRAFT.md`.*
