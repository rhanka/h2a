# Réestimation après MH-L0

Unité : jours-ingénieur de réalisation **et de preuve**, hors durée calendaire.
Ce sont des jugements de programme, pas une extrapolation du temps d'une session
agent. Les qualifications REL ne sont pas remplacées par les tests L0.

| Lot restant | v7 | Révisé | Motif tiré de L0 |
|---|---:|---:|---|
| MH-L1 | 3–5 | 4–6 | Base .6 non figée ; graphe dynamique à transformer, malgré faisabilité native positive |
| MH-L2 | 7–11 | 8–12 | Récupération de domaine, vrais netns/UID, contrôle d'entrée aux fenêtres critiques |
| MH-L3 | 8–12 | 8–13 | Formats/vecteurs disponibles ; ACK de preuves, connexions et chevauchement G0/G1 restent à qualifier |
| MH-L4 | 7–10 | 7–11 | Sections métier des checkpoints et fermeture des writers hérités |
| MH-L5 | 8–12 | 9–14 | Pair réseau amorcé ; vrais source/shims, dists et toutes les coupures restent à raccorder |
| MH-L6 | 15–26 | 18–30 | BX confirmé : politique d'entrée et guards supplémentaires ; fermeture transitive/paquetage réel |
| MH-L7 | 6–9 | 6–9 | Aucun retrait du gateway ni preuve gateway nouvelle dans L0 |
| MH-L8 | 7–11 | 8–13 | Node 20/22, payload publié, gel .6, vrais Claude et campagnes REL distinctes |
| **Reste** | **61–96** | **68–108** | +7–12, sans cacher ces tâches dans la réserve |

Avec 20 % de réserve : **81,6–129,6**, arrondi **82–130** pour les lots restants.
En conservant MH-L0 à **6–9** (révision Opus intégrant BX), l'enveloppe globale
indicative passe de **66–103** à **74–117**, soit **89–141** avec réserve.
La charge restante est le chiffre utile au conducteur après cette livraison.

Les deux compilations directes node-pty, digest identique et vraie PTY diminuent
le risque de faisabilité sans Python sur le profil local Node 22. Elles ne
justifient pas une baisse du coût de release : toolchain/sysroot épinglés,
Node 20, shrinkwrap et probes sur les payloads publiés restent nécessaires.
L'audit source S6 produit 289 fichiers et 17 dépendances externes après inclusion
conservatrice des entrées runtime/status tardives. Il signale 10 sites dynamiques,
dont les imports de paquets déjà bornés par ces racines et les chargements de
module de déploiement/focus à qualifier. Une copie du dist ne prouve pas une image close.

L'enveloppe MH-L6 suppose une protection de l'entrée au moins équivalente aux
trois checks BX, et une décision QF avant gel. Une politique sans routeur doit
financer une défense équivalente ; QF peut donc modifier ce chiffrage. QC, QD,
QE, QG, tag .6 final et qualification VM restent des dépendances explicites.
La première bascule vivante, le vérificateur ajout seul, les bearers durcis,
la propriété PTY et ingress demeurent hors de cette enveloppe .7.
