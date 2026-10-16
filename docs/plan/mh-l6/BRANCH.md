# MH-L6 — frontière H4 issue de M18

Responsable : réalisateur H4/bootstrap MH-L6.
État : **à réaliser avant gel MH-L6** ; dépendance explicite de la campagne
M17 convergée [MH-L8](../mh-l8/BRANCH.md).

Argon finding 3, spec v7 F01 / §6.3 / §12 : les marqueurs v1 .5/.6 ne portent
ni identité de naissance complète ni bootId. La seule mort du PID ne constitue
pas une preuve durable. `mh-l5-v1.test.js` impose donc toujours
`owner_liveness_unknown`, sans réclamation ni fabrication de provenance.

- [ ] Produire et persister la preuve H4 externe de fermeture maintenue des
  admissions héritées, dans le chemin réel d'activation/bootstrap MH-L6.
- [ ] Après cette preuve vérifiée, permettre l'activation .7 et le retour
  d'éligibilité du store ; conserver le refus avec une preuve absente, invalide
  ou non concordante. Ne jamais assimiler PID absent à provenance durable.
- [ ] Tester les vrais dists .5 et .6 : arrêt froid, marqueur v1 résiduel,
  fermeture d'admission maintenue et démarrage .7 autorisé par la preuve H4.
  Exiger un rouge/vert par garde, commandes/sorties, zéro skip/enfant restant,
  uniquement des espaces temporaires ; aucun état réel de l'owner.

Ce fichier suit le besoin d'intégration ; il ne prétend pas que le producteur
H4 ou son chemin CLI est déjà livré par MH-L5.
