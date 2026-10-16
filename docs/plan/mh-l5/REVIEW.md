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

Réserve de couverture M17 à arbitrer en revue : la campagne compte huit processus
et les vrais writers conformes, mais les rôles sont des drivers backend. Pour
qualifier les huit surfaces ensemble, le conducteur devra exiger un fichier ciblé
faisant coexister un central, le pair, quatre stdio, le janitor et la CLI réels sur
le même store, avec au moins 10 000 mutations par domaine, réconciliation des ACK,
chaînes valides, zéro double effet et refus préalable des admissions héritées.
Estimation : 4–8 heures-agent et 1–2 tours, distincts de la revue du présent diff.
