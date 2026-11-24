# PTY B puis lots — spec EVOL v3 finale (résumé)
Livrables : SPEC_EVOL_PTY_B_BATCH_HANDOVER.v3.md (EN, remplace la v2) + changes-v3.md (FR, remarque → traitement). V2 et changes-v2.md conservés. Aucun code, aucun commit poussé, aucun test applicatif exécuté (rédaction seule).
Finalité owner : les sessions CLI survivent à l'upgrade h2a puis au redémarrage du process PTY, terminaux migrés par lots, même process CLI.
Revues finales appliquées : revpty3a-last.md (Astra max, 4 remarques) + revpty3s-last.md (Sol max, 3 remarques), toutes vérifiées sur origin/main 7670fbed6. Sept remarques confirmées, quatre racines corrigées. Historique des revues v1 : changes-v2.md. But, ordre des lots, plateformes et chiffrage v2 inchangés.

| Remarque restante | Traitement v3 |
|---|---|
| P1 — CAS et écrivains concurrents | D23/L3–L4 : exclusion stricte pour tous, aucun repli sans verrou ni vol par âge ; écrivains anciens non clôturés ⇒ différé ; transaction de tout le lot, aucun changement partiel |
| P1 — Entrées ACKées après snapshot | D22/D25/D26/L3 : garde ≠ copie préparée ; barrière d'admission, delta/frontières scellés validés avant commit durable/COMMIT, vidange avant route inscriptible |
| P1 — `.owner` et suppression du socket | D24/L4 : révocation du droit de nettoyage ; autorité contrôlée avant tout unlink partagé, callbacks retardés compris |
| P2 — Rollback sans ancien PID vivant | D28/B4 : cible compatible épinglée indépendamment des références vivantes, libérée après remplacement qualifié ou abandon B drainé |

| Phase | Lots | Résultat |
|---|---|---|
| B-Linux | B1, B2, B3, B4, B5 | Frontal remplaçable, frappes en vol exactement une fois (D21), upgrade rétentif, drain lf1 |
| B-macOS | BM puis gates macOS | Substrat produit macOS (publication, identité, confinement) + CI ARM64 |
| L | L1..L5 | Gardien parent réel, SCM_RIGHTS + snapshot par lots, rollback isolé, succession keeper |
| O1 optionnel | 1 lot | 2 propriétaires permanents — décision owner séparée requise |

| Chiffrage v2 re-dérivé (§9 spec) | h agent |
|---|---:|
| B (dont BM 16–28 ; Linux seul 66–106) | 82–134 |
| B + lots | 160–260 (10–16 tours) |

Corrections structurantes v2 : h2a upgrade existe et supprime l'ancienne install (rétention D28, B4) ; port macOS = lot BM (D27) ; frappes en vol = ACK/dédup (D21, B3) ; transfert = 2 FD + snapshot complet (D22, L3) ; propriété durable clôturée au commit (D23) ; succession du listener (D24) ; garde des files chez le cédant (D25) ; dépassement de file défini (D26).
Chaque lot : tests RED nommés d'abord, fichiers autorisés exacts (aucun générique), interdits, gate ciblée par plateforme (vitest / node --test ; skipped = 0 dans l'ensemble de la plateforme).
Non couvert : exactly-once si crash au commit, migration rétroactive, macOS avant BM, retour au fusionné sans drainage, plafond mesuré avant L5, pause max non fixée.
Marqué « proposition, not validated » dans la spec : topologie 2 process, C+N-API, bornes/timeout, fenêtre N↔N+1, format snapshot, succession du keeper, place du coordinateur.
RED supplémentaires prescrits : écrivain ancien repris après commit ; comparaison 2 échouée sans écriture partielle ; entrée ACKée après PREPARED puis commit/sortie normale, octets exacts ; nettoyage du cédant après succession ; anciens composants sortis → sweep → lancement réel du frontal de rollback. Aucun exécuté ici, aucune preuve verte produit revendiquée.
Écart v3/demande : aucun. Corrections limitées aux quatre racines des revues finales ; implémentation et qualification restent à faire dans B4/L3/L4.
