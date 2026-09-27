# Lot 4 — CONCEPTION v2.1 (complète) : verrou par succession partagé (upgrade + binding d'identité), fencing CAS, reprise réconciliée #291

- Date : 2026-09-26. Remplace v2 + le delta v2.1. Document COMPLET (les deux revues touchent beaucoup de sections).
- Artefact de référence : `ec09dac9` (v0.97.9). Toutes les lignes citées sont re-vérifiées sur cet artefact.
- Revues intégrées : gemini v2c (BUILDABLE-WITH-FIXES, 2 BLOCKER + 3 MAJOR + 2 MINOR restants) et muse (BUILDABLE-WITH-FIXES, 6 BLOCKER + 6 MAJOR + minors), rédigées indépendamment et CONVERGENTES. Arbitrages conducteur (8 points) intégrés.
- Principe directeur : **en cas de doute, un détenteur n'est JAMAIS déclaré mort.** Un blocage borné + échappatoire opérateur est récupérable ; une fausse mort (double détenteur) ne l'est pas.

---

## 0. État des lieux (vérifié) et corrections d'erreurs de la v2

1. **#288 (verrou commité) + #291 (reprise bornée) ont changé le point de départ.** Vérifié : C5 déjà intégré (index.ts:803 ns-null→undecidable, :791 host-mismatch→undecidable, :798-799 boot-diff→dead, readTimeNs :532, startSource :612, :825-826) ; sweeps à préfixe strict (:1053-1056, :1080-1093, :1163-1183) ; reprise #291 (identity-state.ts:38 MCP_IDENTITY_RETRY_MIN_MS, :56 TRANSIENT={identity_timeout}, :329/:452 retryable, :447-459 retry(), :307 failedAtNs).
2. **CORRECTION (mon erreur) : placement = Option C, pas A.** `@sentropic/h2a-runtime` est une **peerDependency** de h2a (h2a/package.json:61-63 ; règle « h2a ne dépend jamais en dur de h2a-runtime » : canevas/adapter.ts:2, loop/engine/tick.ts:6, decision.ts:3 ; chargement paresseux cli.ts:3751-3758, mcp-central.ts:73-79). h2a-runtime est lourd (node-pty/aws-sdk/hono). Le verrou est sur le CHEMIN CHAUD SYNCHRONE (upgrade, bindings.ts:34/166/241, locks.ts, worker enfant) → il doit rester une feuille dans h2a, jamais derrière un resolver paresseux.
3. **CORRECTION (mon erreur) : cull.ts:456 = `writePacketFile`** (écriture paquet de preuve, containment), PAS le verrou. Le vrai verrou identity/.lock = `acquireCanonicalBindingFence` (cull.ts:1047-1075 ; openSync O_CREAT|O_EXCL puis writeFileSync+fsync ; fenceIsHeld :1033-1043 avec `pid===process.pid` incompatible succession ; release inconditionnel :1072-1075), atteint par `verifyHeldDescriptorCas` (:1084-1107, acquisition :1089 = même chemin `identity/.lock` que bindings.ts:67-69). **Aucun appelant prod** de verifyHeldDescriptorCas/acquireCanonicalBindingFence/verifySingleWriterPrecondition ; seul chemin prod = refuseCullExecution (index.ts:2699, toujours EXECUTION_DISABLED_PENDING_SEPARATE_OWNER_GO cull.ts:929) + runIdentityCullDryRun. → verrou cull INERTE en prod.

---

## 0bis. Tableau de clôture (chaque finding des deux revues)

| Finding | Traitement v2.1 | § |
|---|---|---|
| gemini v1 B1–B3, M1–M3, m1 ; muse B2, gemini M1/m2 | FERMÉS (code ou spec) — confirmés par les deux revues | 0 |
| muse B1 / gemini BLOCKER 2 (placement) | Option C : module en `h2a/src/runtime/local-files/succession-lock.ts`, import direct fichier | 1 |
| muse B6 / gemini M3 (cull, même chemin 2 protocoles) | Pas de migration ce lot ; **test de garde « aucun appelant prod »** (décision, §1) ; règle « un seul acquéreur pour identity/.lock » ; constante+migration → Lot 5 | 1 |
| muse B2 / gemini BLOCKER 1 (host fort inencodable) | Champ `hostKind:"machine-id"|"weak"` posé dans makeLockRec, testé dans classifyLiveness AVANT toute sonde ; host faible → undecidable | 2 |
| muse B3 (image clonée / jail) | Option (b) : Lot 4 = même machine, Linux/darwin, machine-id fort ; tout le reste → undecidable ; UUID par-instance → Lot 5 | 2 |
| muse B4 / gemini MAJOR 3 (invariant legacy) | Règle opérationnelle ESRCH+ns-partagé+host-fort→dead, sinon live/undecidable ; classifieur succession EXCLUSIF (fini locks.ts:214 kill-only) ; token legacy `legacy-`+sha256(octets) ; échappatoire dans le MÊME lot | 3, 5 |
| muse B5 / gemini MAJOR 1 (mint unique) | `mintMemo` unique partagé candidat-hors-verrou (live.ts:666-722) ↔ corps CAS ; ≤1 mint/appel ; beforePublish réentrant ; erreurs → famille identity_timeout | 4 |
| muse M1 / gemini B2/B3 (contrats tailLatest/scanBindings + crash) | Contrats figés + ligne tronquée ignorée + rescan pred frais + ino/troncature + `\n` figé par vecteur + kh sur host de clé | 4 |
| muse M2 / gemini (durabilité fd) | O_APPEND+writeSync+fsync(fichier)+fsync(dir) ; roll-forward sous verrou idempotent ; GC après double fsync | 4 |
| muse M3 / gemini M1 (rayon GC/sweep) | LISTE D'INTERDITS + 1 test par interdit ; slot GC seulement ce kh, après durable+visible | 4 |
| muse M4 (chaîne post-rupture opérateur) | Spécifiée ; T-operator découpé en 3 | 5, 7 |
| muse M5 (readFirst « ne décide jamais ») | Intégré | 3 |
| muse M6 / gemini (retryAfterMs) | Follow-up hors Lot 4 (item track), avec accesseur | 6 |
| gemini MAJOR 2 (markSlotMaterialized inexistant) | Remplacé par unlinkOwnSlot(slot,token) ; nettoyage sur chemin reclaim | 4 |
| muse minors (citations, granularité, transition) | Citations corrigées (§9) ; étapes 2/3 découpées (§8) ; gate transition = risque résiduel tracé (§8) | 8, 9 |

---

## 1. Placement (Option C) + cull inerte + règle de chemin

- **Module :** `packages/h2a/src/runtime/local-files/succession-lock.ts`. Feuille (`node:fs/os/crypto/child_process` seulement). Importé DIRECTEMENT par fichier (`upgrade/index.ts`, `local-files/locks.ts`, `identity/bindings.ts`), **jamais via `local-files/index.ts`** (qui tire store/presence/lease, index.ts:1-65). Extraction INTRA-paquet → étape 1 neutre.
- **cull NON migré dans le Lot 4.** DÉCISION (h-cond #1) : **test de garde structurel « aucun appelant de production »** de `verifyHeldDescriptorCas`/`acquireCanonicalBindingFence`/`verifySingleWriterPrecondition` (git-grep hors tests = vide). POURQUOI pas l'erreur typée `CullFenceDisabledError` : la faire lever « seulement hors tests » exige une détection de contexte de test à l'exécution (env/NODE_ENV) — hack qui pollue le chemin prod (viole « aucun env en prod ») ET casserait les tests de cull qui appellent ces fonctions. Le test de garde enforce EXACTEMENT l'invariant dont dépend l'Option C (verrou cull inerte en prod) sans toucher au runtime de cull ni casser ses tests ; si quelqu'un ajoute un appelant prod, le test échoue et force la migration Lot 5 d'abord.
- **Règle de chemin (écrite) :** `identity/.lock` a EXACTEMENT UN acquéreur = le protocole de succession. La migration de cull sur ce protocole + la dé-duplication de la constante fence (bindings.ts:42 + cull.ts:149, octet-identiques) = **précondition explicite du GO owner de cull = Lot 5**. Le passage fence-v1→v2 dans h2a NE casse PAS cull (il garde v1 tant qu'inerte ; ses tests restent verts).

---

## 2. Identité machine (précède TOUT branchement de reprise d'identité)

Arbitrage h-cond #2 = muse option (b). Le Lot 4 est limité à : **même machine, Linux ou darwin, `machine-id` fort**. **Toute autre combinaison → `undecidable`** (donc détenteur vivant, jamais repris) :
- host faible (repli hostname ou `unknown-host` : index.ts:452-466, live.ts:151-160) ;
- boot différent sans instance unique prouvée (image clonée `/etc/machine-id` gelé — gemini BLOCKER 1) ;
- plateforme hors Linux/darwin ;
- jail (readPidNs off-Linux = "host", index.ts:515, faux co-location).

**Encodage :** champ `hostKind: "machine-id" | "weak"` dans l'enregistrement, posé à `makeLockRec` (index.ts:642-655), TESTÉ dans `classifyLiveness` **AVANT toute sonde kill/start** : si un côté est `weak` → `undecidable` immédiat. L'UUID par-instance (pour départager des clones) passe au **Lot 5**. Test **T-machine-id** RED d'abord (autre machine-id → undecidable ; hostname-only → undecidable ; boot-diff sans instance unique → undecidable). **Cette règle est livrée AVANT tout câblage de la reprise d'identité** (muse : « step 2 must land it before any identity reclaim is wired »).

---

## 3. Prédicat de vivacité (extrait + extensions) et invariant legacy

Extraction mécanique du bloc « Prefix lock v4 » de `upgrade/index.ts` (types, identité process, enregistrements, `classifyLiveness`/`isCertainlyDead`, protocole succession, constantes) vers `succession-lock.ts`, en généralisant `prefix` → `dirname(lockPath)` (filtre `basename` conservé). Extensions :

- **Invariant legacy (muse B4, formulation opérationnelle) :**
  - (i) **ESRCH dans un ns partagé CONNU + host FORT → `dead`** (absence de PID conclusive, pas besoin de start).
  - (ii) Tout le reste → `live`/`undecidable`, JAMAIS `dead` : PID présent, EPERM, toute erreur ≠ ESRCH, ns null (index.ts:803), ns différent (:804), host mismatch (:791), host faible (§2), start legacy/non-parsable (:825).
  - (iii) Le verrou d'identité passe **EXCLUSIVEMENT** par le classifieur de succession : **la reprise « kill seul » de `locks.ts:214-221` est INTERDITE pour le verrou de binding une fois migré** (aujourd'hui locks.ts:162-179+214-221 reprend un legacy sur kill+hostname seuls → réutilisation de PID = fausse mort).
  - (iv) **Token synthétique legacy** (gemini MAJOR 3) : un legacy lu → `HolderView{kind:"legacy", token:"legacy-"+sha256(octets bruts)}` → toujours `undecidable`, mais le token permet `breakLockAsOperator(expectToken)`.
- **T7a** : `makeLockRec` (index.ts:642-655) déjà propre (jamais `hostname`/`startedAt`) ; figer par test ; le chemin identité ne réutilise JAMAIS la forme legacy `locks.ts:186-191`.
- **readFirst (muse M5) :** requis (anti-tempête fsync), mais « ne décide JAMAIS » : il peut seulement SAUTER une publication (LOCK présent, détenteur live/undecidable → attendre) ; une mort passe TOUJOURS par un `readLockRecord` + `classifyLiveness` frais immédiatement avant `succeedDeadToken`.
- **stillHeld / breakLockAsOperator** : nouveaux (voir §5).

---

## 4. CAS de commit côté identité (`bindings.ts`)

**Mint unique (muse B5 / gemini MAJOR 1) :** un SEUL `mintMemo` partagé entre le candidat publié HORS verrou (`live.ts:666-722`, `publishIdentity` :670-700, candidat :720) et le corps CAS. Au plus UN mint par appel externe (jamais par tour CAS). `beforePublish` RÉENTRANT sur le MÊME `mintResult` (même `(kh, instance)` → écritures keyring octet-identiques ou skip-si-présent sous verrou). Réutiliser le plumbing `mint`/`mintMemo` existant (`live.ts:643-655`).

**decideAndCommit (corrigé — align. v2.1 : `beforePublish` DANS la boucle après le test reclaim ; `mint()` mémoïsé ; nettoyage slot avant reclaim-après-roll-forward) :**
```ts
function decideAndCommit(root, key, deps, held, o): ReclaimOrMintResult {
  let mintMemo;                                    // deps.mint() AU PLUS une fois, mémoïsé (partagé avec le candidat hors-verrou live.ts:666-722)
  const mintOnce = () => (mintMemo ??= deps.mint());
  for (let round = 0; round < ROUNDS; round++) {
    const snap = scanLatest(root, key);            // dédup PREMIÈRE-occurrence, octets bruts
    if (snap.binding && deps.verifyProof(snap.binding)) {
      gcMaterializedSlots(root, keyHash(key), snap); // gemini MA2 : nettoie un slot roll-forward AVANT le reclaim
      return reclaim(snap.binding);                // aucune écriture ; clés non référencées d'un mint éventuel → ramassées par le cull
    }
    const pred = snap.rawLine ? lineId(snap.rawLine) : "genesis";
    const slot = commitSlotPath(root, keyHash(key), pred);
    const pending = readExclusive(slot, parseSlot);
    if (pending === "corrupt") throw new BindingCommitCorruptError(slot);
    if (pending !== "absent") { appendRowDurable(root, pending.rawLine); continue; } // roll-forward → re-teste reclaim au tour suivant
    const mintResult = mintOnce();                 // ≤1 mint/appel (mintMemo)
    const line = rowLine(key, mintResult, deps.now());
    const res = { action:"mint", instance:mintResult.instance, agentUuid:mintResult.agentUuid };
    o.beforePublish?.(res, { identity:true });     // align.2 : APRÈS le test reclaim ; réentrant/idempotent (kh,instance)
    if (!held.stillHeld()) throw new BindingFenceStaleError(held.token);
    const p = publishExclusive(slot, slotBody(pred, line, held.token), held.token);
    if (p === "exists") continue;
    if (p !== "ok") throw storageError(p);
    const now = tailLatest(root, key, snap);       // contrat B2
    if (now === line) { unlinkOwnSlot(slot, held.token); return res; } // déjà roll-forward ailleurs
    if (now !== snap.rawLine) { unlinkOwnSlot(slot, held.token); continue; }
    appendRowDurable(root, line);                  // O_APPEND+writeSync+fsync(fichier)+fsync(dir)
    gcMaterializedSlots(root, keyHash(key), snap); // après durable+visible ; liste d'interdits
    return res;
  }
  throw new BindingCommitConflictError(key);
}
```
*Note align.2 : le mint est mémoïsé mais `beforePublish` (écriture keyring) n'a lieu qu'APRÈS le test reclaim de chaque tour, donc un binding apparu ne provoque plus de clés/alias orphelins que dans la fenêtre bornée d'un seul tour ; ces clés non référencées sont ramassées par le cull. La publication keyring reste AVANT `publishExclusive` (fermeture de fenêtre T5 : aucune ligne visible dont le keyring ne serait pas prouvable).*
- **markSlotMaterialized supprimé** (gemini MAJOR 2) → `unlinkOwnSlot(slot, token)` (relit, supprime seulement si token concorde, ignore ENOENT — muse m1). Sur le chemin RECLAIM après roll-forward, nettoyer le slot via `unlinkOwnSlot`.
- **Contrat `tailLatest(root,key,snap)` (gemini B2, muse M1) :** lit `[snap.size, EOF)` ; **filtre STRICT sur la clé K** ; aucune ligne de K → retourne `snap.rawLine` (undefined si genesis) ; garde `ino` + `size<snap.size` → rescan complet, qui **repart avec un `pred` frais** (pas de comparaison au `snap` périmé) ; **ligne tronquée finale ignorée** (crash mid-append), jamais parsée, jamais un conflit.
- **Dédup première-occurrence (gemini B3, muse B4) :** `scanBindings` garde les OCTETS BRUTS ; `seen.has(rawLine)?drop:keep`. `lineId=sha256(octets bruts)` avec le `\n` **figé** (dans ou hors du hash) par un vecteur de prod **T-B4** (format d'append = `JSON.stringify+"\n"`, bindings.ts:173-174).
- **kh (muse M1-v)** : `kh=sha256(host \0 providerSessionId)[:32]` où `host` = le host de la **CLÉ DE BINDING** (un label type `agent`, per live.ts), PAS le machine-id (sinon slots éclatés par machine pour une clé par-conversation). À énoncer.
- **Durabilité (muse M2) :** `appendRowDurable` = open O_APPEND → `writeSync` → `fsyncSync(fd)` → close → open `dirname` fd → `fsyncSync(dir)`. Roll-forward de démarrage **sous verrou**, idempotent (deux démarreurs appendent la même ligne gagnante → dédup absorbe), GC jamais avant les deux fsync confirmés. **T-B6** couvre distinctement slot-présent/ligne-absente et ligne-présente/slot-présent.
- **Mapping erreurs (muse B5) :** `BindingFenceStaleError`/`BindingCommitConflictError` → dans `worker.ts` classify (worker.ts:50-68) → famille **`identity_timeout`** (contention, retry dans le budget), PAS `identity_worker_failed`.
- **Liste d'interdits GC/sweep (muse M3, gemini M1) :** (i) sweep débris ne touche QUE `${basename(lockPath)}.succ.*` / `${basename(lockPath)}.tmp.*` ; (ii) slot GC ne touche QUE `identity/commits/<kh>.<pred>.json` pour CE kh, après ligne durable ET visible via tailLatest, ou pred strictement plus ancien que la ligne confirmée de CETTE clé ; (iii) **jamais** `bindings.jsonl`, `aliases.jsonl` (migration.ts:99), les `commits/` d'autres clés, `<root>/keys/` (live.ts:143-146), le registre, ni aucun `.stale-*` (renommages manuels, aucun code n'y touche) ; (iv) nettoyage au démarrage prend le verrou d'abord. **Un test par interdit** (tente la suppression, échoue si touché).

---

## 5. Échappatoire au blocage (LIVRÉE dans le Lot 4) + rupture opérateur

muse B4 : le fail-closed « legacy = vivant tant que non prouvé mort » PEUT bloquer un legacy derrière l'outil opérateur ; l'échappatoire doit être livrée **dans le même lot**, sinon on recrée le blocage du 24/09.
- **Compteur `legacy-record`** + **diagnostic typé** nommant la commande.
- **`h2a identity unlock`** (alias de `h2a lock break --path <lock> --token <g> [--assert-dead]`) via SUCC.
- **`breakLockAsOperator(lockPath,{expectToken,assertDead})` :** détenteur `live` → refus (pid affiché) ; `dead` → succession normale ; `undecidable` → exige `assertDead`, publie `SUCC(g){operator:true}`, **relit `LOCK==expectToken` juste avant `unlink(g)`**, retire g SANS republier LOCK.
- **Chaîne post-rupture (muse M4) :** un successeur auto tenant `SUCC(g)` après retrait opérateur de g : son `retireDeadToken` relit LOCK, voit absent, publie frais (index.ts:1001-1007) — acceptable, à ÉNONCER + tester. `SUCC(g){operator:true}` reste `target===g` pour la marche de chaîne (:931-936). **L'opérateur NE tue PAS de PID par défaut** : pour l'identité, tuer un worker depuis la CLI est destructif → confirmation explicite, jamais par défaut.
- **T-operator découpé en 3** (RED d'abord) : live-refusé / dead-normal / undecidable-exige-`--assert-dead`+relecture. Plus **T d'intégration « rupture opérateur pendant un `retry()` »** (gemini MINOR 2) : jamais deux détenteurs, jamais suppression du LOCK du gagnant.

---

## 6. Reprise réconciliée avec #291

- Le reclaim fait réussir le PREMIER `retry()` (le mort est repris au 1er sondage) → la « reprise 3 tentatives espacées » de la v1 est inutile en nominal ; on garde #291 comme filet pour les causes transitoires non-verrou.
- **`identity_worker_failed` NON ajouté** aux causes reprenables (décision, confirmée par les DEUX revues) : worker.ts classify route déjà la contention verrou vers `identity_timeout` (reclaimable) ; crash/fork/IPC/faute → `identity_worker_failed` terminal. Le reprendre en boucle = risque fork-loop + keypairs orphelines, aucun gain.
- **`retryAfterMs` (muse M6) : follow-up HORS Lot 4** (item track), avec accesseur `nextEligibleInMs` (aujourd'hui server.ts:318-326 renvoie la constante, ignore l'override env identity-state.ts:289-292 et l'écoulé).

---

## 7. Tests (RED d'abord ; un par extension)

T-extract (déplacement neutre, tests upgrade v4 verts) ; T-machine-id (§2, avant reclaim) ; T-legacy (les 4 `.stale-*` réels dont pid 2910836 → undecidable ; token synthétique) ; T7a (jamais hostname/startedAt) ; T-B4 (vecteur figé octets bruts + `\n`) ; T-B2-tailLatest (filtre K, queue vide→snap.rawLine, ino/troncature, ligne tronquée ignorée) ; T-B3-dedup (première-occurrence) ; T-B6 (durabilité, 2 cas crash) ; T-gemini-B1 (une seule paire de clés/appel sous EEXIST) ; T-zombie ; T-tué-tenant-verrou (identity_ready<2s) ; T-reclaim-retry ; T-GC-interdits (un test par interdit) ; T-operator×3 + T-operator-pendant-retry ; T-readFirst-ne-décide-pas ; T-guard-cull (aucun appelant prod) ; T-structurel (aucun process.env dans succession-lock.ts ; aucun site prod ne passe hooks) ; T-prédicat (`__test.livenessOf`).

---

## 8. Séquençage (PR/CI verte par étape, RED-first, builder≠relecteur)

1. **Extraction neutre INTRA-paquet** (T-extract). Diff = déplacement + imports + export.
2. **Extensions, DÉCOUPÉES une par PR** (muse minor granularité) : (2a) `hostKind` machine-id + T-machine-id — **avant tout reclaim** ; (2b) lecteur legacy + token synthétique + T-legacy/T7a ; (2c) `readFirst` (ne décide jamais) ; (2d) `stillHeld` ; (2e) `breakLockAsOperator` + échappatoire (§5) + T-operator×3.
3. **CAS commit, DÉCOUPÉ** : (3a) scanBindings octets-bruts + dédup + lineId (T-B4/T-B3) ; (3b) slots + decideAndCommit + mint unique (T-gemini-B1) ; (3c) tailLatest contrat + crash (T-B2) ; (3d) durabilité (T-B6) ; (3e) GC + liste d'interdits (T-GC-interdits).
4. **Réconciliation reprise #291** (T-reclaim-retry) + T-operator-pendant-retry.
5. **Test de garde cull** (inertie ; pas la migration).

**Risque résiduel tracé (hors Lot 4) :** gate de transition multi-version (un écrivain legacy sans slot + violation d'exclusivité simultanée = fourche hors Lemmes D/E/F). Pas seulement un compteur : un GATE de version (le nouveau binaire refuse, ou au moins avertit, s'il voit des appends sans slot d'un ancien binaire dans la fenêtre) + séquence opérateur documentée → Lot 5.

---

## 9. `unverified` + citations corrigées

- `unverified` (à lever au build) : isolation pid réelle de chaque bac à sable de la flotte ; comportement macOS réel (start/boot) ; durée de la transition multi-versions.
- **Citations corrigées (muse) :** `cull.ts:456` → `1047-1075` (+ `1033-1043` fenceIsHeld) ; `worker.ts:159-167` → `worker.ts:50-68` (+ identity-state.ts:201-255,421-431) ; `locks.ts:284` → `285` et `327` (unlink inconditionnel dans les `finally` :280-290/:322-332).
