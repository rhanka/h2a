GO-CODE
Reviewer: astra-max

Re-revue finale limitée au P2 restant de `review-r3-astra.md` et aux régressions des retouches v4. SHA-256 vérifié : `96b93512a722c9acfb6146985b7a0e907cc75a4bd0a2307664bc1e6bd176de13`. Base code : `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`.

`SPEC:ligne` = `docs/specs/pty-restore-injection/SPEC_EVOL_PTY_RESTORE_INJECTION.md`.

- **Astra R3 n°1, P2 — corrigé.** D6(iii), `SPEC:657`, exige désormais une preuve positive de lecture d'une nouvelle commande au prompt principal, sans continuation, here-document, lecture imbriquée ni commande en cours. Elle est liée au challenge, à la génération et à la frontière, invalidée dès l'acceptation d'une ligne et renouvelée seulement au retour principal attesté (`SPEC:670`). Ni ligne readline vide, ni texte du prompt, ni marqueur reset ne suffisent. Drainage, consommation et revalidation atomique des deux preuves au commit restent requis (`SPEC:689`).
- **Régression exigée et chemin positif conservé.** L1b (`SPEC:1043`, acceptation `SPEC:1091`) et L2 (`SPEC:1229`, acceptation `SPEC:1304`) couvrent la quote inachevée avec ligne courante vide après consommation et expiration du délai : zéro octet de reprise, commande humaine intégralement préservée, puis exécutée sans ajout. Le succès au vrai prompt principal vide reste obligatoire. Le mécanisme Bash et son invalidation doivent être démontrés avant code (`SPEC:1188`) ; une défaillance entraîne une qualification incomplète, pas une acceptation de L1b par simple refus systématique.

**Aucun nouveau finding P1/P2/P3 démontré dans les retouches v4.** Le raccord au capital reste cohérent : `packages/h2a-runtime/src/tmux.ts:127` fournit le hook existant, `:131` lance Bash ; `packages/h2a-runtime/src/native-terminal/host.ts:1025` consomme le marqueur sans attester l'état du parseur. Les listes de fichiers autorisent déjà l'adaptateur et ses preuves ; les questions Q1–Q5 restent ouvertes.

Aucun test/build exécuté : les preuves dynamiques restent à produire en L2/L1b. Seul ce rapport est écrit ; aucun état h2a réel consulté, aucun Python, aucun commit.
