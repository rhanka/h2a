# BX — amendement mesuré et dossier QF

Statut : **BX reproduit et contrat L0 corrigé ; décision QF en attente avant gel
de l'entrée et de MH-L6.** Le texte externe de la spec v7 reste inchangé.
Ce document remplace sa prémisse npm erronée pour cette branche.

## 1. Décision à prendre

Choisir, avant gel MH-L6, A (lanceur externe), B (routeur npm), ou A+B (bootstrap
externe puis routeur npm), et la politique après installation externe ≤.6.
L0 prépare les preuves et gardes ; il ne tranche ni ne livre le routage produit.

## 2. Faits et inconnus

[FACT] npm **11.17.0**, Node **22.22.1**, Linux x64 glibc, préfixe/cache/HOME/XDG
privés, paquets synthétiques sans dépendances ni scripts, tarballs locaux ;
`npm update` utilise uniquement un registre HTTP loopback démarré par le test.
Le faux paquet porte le nom @sentropic/h2a, mais aucun h2a réel n'est installé,
exécuté ou désinstallé. Les commandes exactes et sorties sont conservées dans
`red-green-evidence.json`, entrées `npm-red-reproduced` et `npm-green`.

| Action, paquet déjà enregistré | Code mesuré | Lien P/bin/h2a |
|---|---:|---|
| Install supérieur .7 → .8 | 0 | Remplacé par le bin npm |
| Install inférieur .7 → .6 | 0 | Remplacé par le bin npm |
| Réinstallation .7 depuis tarball | 0 | Remplacé par le bin npm |
| `npm update -g` .7 → latest local .8 | 0 | Remplacé par le bin npm |
| Install avec `--force` | 0 | Remplacé par le bin npm |
| `npm uninstall -g` | 0 | Supprimé |
| Install avec paquet absent, lien externe présent | 1 / EEXIST | Conservé |
| Même cas absent avec `--force` | 0 | Remplacé |

[FACT] Dans tous ces cas, le lanceur et le témoin d'image sous I restent intacts.
La version sélectionnée H4 n'est pas un résultat de npm. Le lien canonique est
cependant perdu même sans force. Le rouge vérifié est `0 !== 1` face à l'attente
EEXIST v7 ; le test corrigé confirme le comportement réel et les refus des guards.

[FACT] Aucun tag v0.98.6 n'est présent lors de L0. Les garanties contre des
tarballs publiés .5/.6 et les autres versions npm ne sont pas qualifiées ici.
[JUDGMENT] Les décisions Astra et Opus divergent parce qu'Astra reconduisait la
prémisse EEXIST ; le nouveau résultat invalide cette prémisse, pas les besoins de
préserver les chemins hérités. Aucune nouvelle double revue du dossier n'est
revendiquée : il reste incomplet pour une ratification de politique produit.

## 3. Enjeux et amendements normatifs proposés

| Cible v7 | Correction à appliquer au gel |
|---|---|
| RF4 (§3.3) | Un paquet enregistré permet à npm de retirer le bin avant checkBin ; seul le cas absent montré ici donne EEXIST. Qualifier chaque version npm annoncée. |
| §1.4 et §8.7 | npm direct peut désadopter silencieusement l'entrée même sans force. Distinguer survie des images, sélection H4 et exécution par PATH. |
| §8.2 / QF | Un préfixe écrit par plusieurs UID ou appartenant à un autre UID est refusé par le prototype ; un repli partagé exige une décision et une qualification distinctes. |
| U09 | Utiliser la matrice ci-dessus, plus état H4/images inchangés, dérive visible et guards à préparation/barrière/juste avant commit-stop. |
| §4.6 / §8.4 | Les checks d'entrée ne clôturent pas les admissions npm. `legacy_installer_unfenced` reste un report tant qu'une exclusion réelle n'est pas démontrée. |
| §14 | Risque = remplacement/suppression silencieux du lien, pas seulement EEXIST. Installation ≤.6 retire la défense future : aucun arrêt froid sur cette dérive. |

`entry.js` fournit un instantané dev/ino/lien/cible et un prédicat conservateur
pour `prepare`, `barrier`, `commit-stop`. Après chaque mutation npm mesurée,
les trois phases rendent `allowed:false, reason:external_install_detected`.
Cela **ne prouve pas** le scénario d'un vrai arrêt froid et ne remplace pas
l'exclusion des installateurs ; MH-L6 doit consommer ces checks dans G0.

## 4. Options équilibrées

| ID | Choix | Meilleur argument pour | Meilleur argument contre | Coût / retour arrière | Ce qui le ferait gagner |
|---|---|---|---|---|---|
| A | Lanceur externe seul | Bootstrap avant remplacement ; protection de l'arbre vivant ; entrée autonome | npm ordinaire reprend le lien ; une défense et un parcours de réadoption distincts sont indispensables | Bootstrap/launcher déjà nécessaires ; maintenance d'une défense externe supplémentaire ; désadoption conditionnelle | Une défense équivalente mesurée peut maintenir les admissions fermées sans routeur |
| B | Routeur npm seul | npm gère son bin ; routage .7 vers sélection vérifiée ; moins de liens en concurrence | Premier remplacement arrive avant protection ; versions ≤.6 échappent au routeur | Modifier bin livré et qualifier anciennes activations ; premier passage non réversible rétroactivement | Le premier passage risqué est accepté/qualifié séparément et les chemins vivants protégés autrement |
| A+B | Bootstrap externe puis routeur npm .7 | Protège le premier passage ; garde une défense après npm .7 ; sélection contrôlée | Deux points d'entrée et adoption à réconcilier ; ≤.6 reste une désadoption externe | Surcoût d'implémentation/qualification inclus en MH-L6 ; unmanage conditionnel conserve pins/images | Préservation avant remplacement et défense après npm sont toutes deux exigées |

## 5. Recommandation conditionnelle

[JUDGMENT] Préparer **A+B**, comme Opus, mais reporter le choix et le gel à QF.
Un routeur .7 validant l'adoption, chargeant l'image dans le même PID et signalant
une installation externe supérieure sans changer la sélection serait la seconde
défense. Aucun mécanisme de ce type n'est installé par L0.
Le meilleur argument contre est son coût opérationnel : deux entrées, opt-out,
réinstallation/désinstallation et le retour ≤.6 restent à réconcilier.
Une défense A équivalente, qualifiée sans modifier le bin npm, renverserait cette
recommandation. QF peut aussi imposer le respect strict d'une désadoption ≤.6.

## 6. Coût, réversibilité et pré-mortem

[JUDGMENT] MH-L6 passe de 15–26 à 18–30 jours ; cette enveloppe inclut le routage
ou une défense équivalente, les trois contrôles et leurs scénarios concurrents.
Les modules L0 ne modifient aucune installation ; leur retrait reste un revert.
Une politique adoptée devra garder bootstrap absolu, pins et sortie unmanage.

Six mois plus tard, le choix aurait échoué si une installation ≤.6 avait
réactivé des starters anciens après le dernier check, ou si le routeur avait
choisi une version sans transaction durable. Les parades doivent donc être des
refus dans le participant et une autorité de sélection, pas un scan opportuniste.

L'option A serait plus simple pour l'agent auteur. L'intérêt owner est différent :
préserver les chemins des processus vivants, conserver l'accès diagnostique et
ne pas annoncer de continuité lors d'une désadoption non maîtrisée.

## 7. Attendus owner

| Critère | Source | Couvert par L0 | Reste |
|---|---|---|---|
| Aucun host natif redémarré | OWNER | Aucun accès/service/signal natif | U03/U07/U11 produit |
| Premier passage protégé | v7 §8.6 | Layout et probe réel | Bootstrap et QC |
| Aucun choix silencieux de sélection | v7 §8.7 | npm ne modifie pas le témoin géré ; guards de dérive | Routeur/status/H4 réels |
| npm réel plutôt que prémisse EEXIST | Opus BX | Matrice ciblée complète npm 11.17.0 | Autres profils/versions annoncés |
| Politique bornée après ≤.6 / plusieurs UID | Opus QF | Refus conservateur de préfixe | Ratification et qualification |

## 8. Choix attendu avant MH-L6

QF : A avec défense équivalente, B avec premier passage distinct, ou A+B ; puis
respecter la désadoption externe ≤.6 ou permettre une réadoption automatique
explicitement autorisée. Le conducteur pourra présenter ce dossier avec la
double revue de la politique retenue. Aucun choix owner n'est inventé dans Track.
