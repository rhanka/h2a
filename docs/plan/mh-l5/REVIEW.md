---
status: selection-failed
review-author:
  host: codex
  model: unavailable
  effort: unavailable
target-ref: 7a8129ea4120e6202e5f825ebbc5101289090daf..16edafa
observed-failure: Owner confinement forbids installed h2a review dispatch; exact author model and effort metadata are not exposed. No peer was dispatched and no consensus verdict is claimed.
---

La revue indépendante appartient au conducteur. Le diff de réalisation est figé
dans les trois commits `0a5a45c`, `ae40247`, `16edafa` ; le commit suivant conserve
les preuves et ce dossier sans changer les octets exécutés.

| Angle demandé | Pièces et points adversariaux |
|---|---|
| Contrat et sûreté | T9 exact et conservé dans le backoff ; pas d'autostart devant v1 ; pas d'autorité dérivée d'un marker hérité sans provenance ; endpoint fixed/discovered et token leurre |
| Réalisation des fautes | Séparer le noyau compilé avec close de fixture des trois fautes sur le vrai central ; contrôleur indépendant mort, ACK perdu et deux starters ; compensation réelle sans rouvrir G0 |
| Oracles et charge | Vérifier contentHash/chaînes et acquittements externes, mutations des sept domaines et zéro enfant ; la charge M17 utilise des drivers backend synthétiques, pas huit parcours clients complets simultanés |
| Frontière .8 | Pair séparé, progression signée de fixture sur transport G0 réel, source/shim réels ; aucun coordinateur vivant produit, vérificateur sémantique ou preuve réelle .7 → .8 |

Les commandes, sorties rouges/vertes, premiers diagnostics et hashes exacts sont
liés depuis [README.md](README.md) et [proof-audit.json](proof-audit.json).
Ne pas transformer cette qualification en verdict de release ou de fusion.

La revue Argon de `4a4ca76c` a confirmé cette insuffisance M17. Sa fermeture
suivant l'alternative autorisée par l'owner est documentée dans [ARGON.md](ARGON.md) :
le défaut de verrou englobant est corrigé et la campagne complète est déclarée
dans [le plan MH-L8](../mh-l8/BRANCH.md), comme gate release obligatoire et non
comme une acceptation M17. Le producteur H4 de M18 est suivi en
[MH-L6](../mh-l6/BRANCH.md). Aucun verdict de nouvelle revue n'est revendiqué.
