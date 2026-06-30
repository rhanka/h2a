# ADR — Réversion de BR-42 (fédération `stp` → CLI unique `h2a`)

> **Statut : APPROUVÉ Fabien (PRINCIPAL) + CO-SIGNÉ architecte (owner non-h2a) — quorum O1 satisfait. Dépréciation stp IMMÉDIATE (inutilisée → LTS/2-minors/gate de retrait DROP). Repoint TOPOLOGIQUE go ; SÉMANTIQUE CLI h2a (grammaire/verbes) EN ATTENTE de validation Fabien — NE PAS figer les verbes. h2a non-décisif.
> Ce draft N'EST PAS présenté par h2a. Il doit être **ré-cadré et présenté à Fabien par l'architecte**
> (owner non-h2a), avec la **dissidence de stp** attachée. h2a est **signataire non-décisif** (COI déclaré,
> posture `conflit-declarable` sur `neg:h2a-sentropic-resegmentation-20260627`). Signature requise :
> **Fabien (PRINCIPAL) + 1 owner non-h2a**. Enregistrement : `track decision`.

## Contexte
BR-42 (documenté : `SPEC_EVOL_STP_FEDERATION.md`) pose une **fédération de 8 sous-commandes pairs** sous
l'umbrella `stp` = `@sentropic/cli` ; h2a y est **une sous-commande parmi 8**. Direction documentée =
*fédération de pairs, pas absorption*.

La décision PRINCIPAL (Fabien, 2026-06-27) = **OPTION B** : h2a devient **LA CLI / cadre-org unique** de
sentropic (cadre humain-centré pour agents conversationnels + de code), sentropic = libs. Cela **renverse**
la direction documentée BR-42.

## Décision demandée
Acter la **réversion de BR-42** : h2a = front-door unique + cadre-org ; la **fédération `stp` devient un
alias compat déprécié** (retrait seulement après critères LTS) ; les briques techniques deviennent libs
`@sentropic/*` consommées par h2a.

## Pourquoi maintenant (évidence)
- **5 doubles consensus réels** convergents (re-segmentation, syntaxe CLI, spec+plan reprise, naming `agent`,
  + **le double consensus indépendant de l'architecte**) — tous AMEND/ACCEPT_WITH_CONDITIONS, design-first.
- **stp (la partie dépréciée) VALIDE B** + critères LTS, et a relevé un **dé-risque majeur** : les 6 entrées
  de la fédération sont **déjà non-fonctionnelles** (silently skipped) → critère « 0 caller externe » déjà
  satisfait en pratique. Réverser BR-42 est **à faible risque**.
- L'**architecte (owner non-h2a)** a confirmé la frontière (decision structurante #1) et **amélioré le design**.

## Conséquences
- **h2a** = CLI/org unique, un seul plugin déployé. `stp` = alias compat (warnings), **retrait gated LTS**
  (2 releases mineures sans rupture, 0 caller externe non-aliasé, docs+CI migrées, contract-tests verts).
- **Protocoles** (`session/governance/scope-gate`) = libs **owned-architecte**, ratifiés par **quorum ≥2
  owners non-h2a** ; h2a non-décisif. Neutralité falsifiable (golden-fixtures + clean-room + receipt-vérif).
- **track/remote** = libs (CLI absorbée à terme) ; **design-system + graphify** = additifs (gardent leur CLI).

## Alternatives considérées
- **A — Scinder / différer** (reco Opus-4-8) : avancer le réversible, différer la mort de la fédération.
  Écartée par le PRINCIPAL au profit de B (assumant le risque), mais **A reste le fallback** si la dissidence
  stp ou un owner non-h2a bloque.
- **C — Garder la fédération** (statu quo BR-42) : **dissidence à fournir par stp** (le meilleur argument
  « pourquoi garder la fédération de pairs »), attachée à cette ADR avant présentation.

## Réversibilité
- **Réversible** (pas besoin de cette ADR) : tous les lots PAS-0 **non-canoniques**, skeletons, lint, golden-
  fixtures, CODEOWNERS, scope-gate mode-rapport.
- **Irréversible / gated par cette ADR** : dépréciation + rename des binaires, repoint d'umbrella effectif,
  bascule hard-fail par défaut, retrait de la fédération.

## Signature
- **Fabien (PRINCIPAL)** — attestation de compréhension réelle (non mintée par un agent).
- **+ 1 owner non-h2a** (architecte, ou track/remote) — co-signature ed25519 via `h2a negotiate sign`.
- **h2a** : NON-signataire décisif (COI déclaré).
- Présenté par : **l'architecte** (pas h2a). Dissidence : **stp**.

---

## Annexe A — Dissidence stp (steelman Option C, fournie par la partie dépréciée)
1. **COI structurel non réparable par process** : `stp` était un dispatcher SANS domaine propre → sans COI intrinsèque. h2a-umbrella fait d'un participant le portail de TOUS les autres ; nommer le COI (ADR + co-signataire non-h2a) n'élimine pas l'incitation long-terme à favoriser les idiomes h2a.
2. **Les 6 must-fix sont le PRIX de l'absorption, pas de la fédération** : le modèle fédéré évite cycles/dépendances structurellement (chaque lib n'importe que ses contrats, jamais l'umbrella).
3. **Les contrats `./cli` n'ont jamais été implémentés — réparable** : 0 entrée connectée ≠ fédération non-viable ; finaliser `{run,version}` dans h2a/graphify/remote/track serait moins cher que les 4 nouveaux packages de B.
4. **Légibilité externe** : `stp` est intelligible sans contexte h2a ; sous absorption, chaque brique devient une « capability h2a », opacifiant les libs sentropic.
> Position personnelle stp = **reste Option B** (auto-dépréciation honnête) car 0 caller réel + Objective Loop déjà coordinateur de facto + protocoles neutres utiles aussi au modèle fédéré. Le steelman ci-dessus est l'argument adverse le plus fort, fourni honnêtement.

## Annexe B — Co-signature stp (CONDITIONNELLE)
stp accepte d'être co-signataire non-h2a, conditionné à : **C1** `h2a app` (équiv. `stp app`/build-cli) confirmé avant le shim alias ; **C2** les 6 must-fix implémentés OU avec ADR de chantier tracé dans track ; **C3** le scan 0-caller joint à l'ADR. Logique : « je co-signe ma dépréciation = je certifie qu'elle est justifiée et que le chemin est propre ».

## Annexe C — Scan 0-caller (preuve LTS, exécuté par stp)
Méthode : `\bstp\b` dans CI/Makefile/scripts/package.json/README/docs/specs sur sentropic + remote + graphify + a2a-cli + track + mcp-wave.
**Verdict : 0 invocation réelle de `stp`** (CI 0, Makefile 0, scripts = seule la def `bin`, le reste = doc/aspirationnel). Le binaire est publié mais **l'écosystème n'a jamais bâti dessus**. Critère LTS « 0 caller externe non-aliasé » **satisfait sans action**. Seule exception : `stp app` référencé en doc → migration doc une fois `h2a app` livré/redirigé.

## Réponses du conducteur aux conditions stp
- **C1** : cible = **`h2a app`** (via plugin h2a, conforme B), tracé comme chantier ; jusqu'à sa livraison, **`stp app` reste autonome (exception documentée)** — le scan confirme 0 caller fonctionnel, donc migration doc, pas blocage.
- **C2** : les 6 must-fix sont tracés (reprise-spec + SPEC_DECISION_PROTOCOL_LIBS_BOUNDARY architecte = ADR de chantier).
- **C3** : scan joint (Annexe C). ✅ Les 3 conditions sont adressables ; co-signature stp valide sous leur vérification.
