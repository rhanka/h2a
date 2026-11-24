# Table des changements — SPEC_EVOL_CROSS_CLI_MESSAGING v1 → v2

| Champ | Valeur |
| --- | --- |
| v1 révisée | `SPEC_EVOL_CROSS_CLI_MESSAGING.md`, SHA-256 `13ae1e0bbe64f514ee0c5abebf94dbd9d1cbdb8b1312c693f3ebdb589fdefef8` (vérifié par `sha256sum` : identique au SHA cité par les deux revues) |
| v2 produite | `SPEC_EVOL_CROSS_CLI_MESSAGING.v2.md`, SHA-256 `8f2ef6efb27796eea97c45703d040b676428920ec53d52330efde303af3137a9`, 2 158 lignes (v1 : 1 435) |
| Revues appliquées | `rvxsa-last.md` (Astra max, 3 P1 + 6 P2) et `rvxss-last.md` (Sol max, 3 P1 + 3 P2), verdict commun `CORRECTIONS-REQUISES` |
| Périmètre | Documentation seule. Aucun code, aucun commit, aucun push, aucune exécution de la suite du dépôt |
| Méthode | Chaque constat revérifié en lecture seule contre les sources avant application (voir « Vérifications contre les sources ») |

## Résultat par constat (15 items, 10 corrections distinctes)

| # | Revue | Sev | Ancre v1 | Constat (court) | Vérif. sources | Correction v2 (section, lot) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Astra | P1 | §3.3, l.309 | L3 laisse passer un récepteur qui ignore le wake et lit par polling lent après le wake ; `drive ok` prouve l'injection, pas la consommation | Fondé | V2-1 : §3.3 réécrit (protocole wake retenu en 3 phases, contrôles périodes × phases, borne de garantie énoncée), §5.3, lot L3 |
| 2 | Astra | P1 | L11, l.1151 | « Toutes fonctions, toutes combinaisons » sans plan : boucle/négociation en « follow-up lots » inexistants ; « representative triples » §5.1 ≠ N×N | Fondé | V2-2 : dénominateurs exacts §5.1 (S : paires 36, triples 120), scénarios nommés au manifeste, lots L12–L15 créés, jalon partiel ≠ F3 final §5.4 |
| 3 | Astra | P1 | L11, l.1162 ; §13 | Campagne `blocked` acceptée comme GREEN et branche « merge-ready » sans campagne réelle, contre §5.4/§7.1 | Fondé | V2-3 : reçu de campagne + contrôle sans secrets §7.1, GREEN de L11 réécrit, jalon renommé §13, fusion vers `main` impossible sans reçu exact-SHA |
| 4 | Astra | P2 | §6.4, l.649 | Le plafond compte des appels MCP affichés, pas les tours consommés ; aucun arrêt au plafond D2 | Fondé, traduit (voir note A) | V2-4 : §6.4 réécrit (unité = session lancée débitée avant spawn + plafond appels MCP/session + temps ; précontrôles et reprises débités ; registre persistant), lot L8 RED (e) |
| 5 | Astra | P2 | l.1001 | L5 autorise « preserve the root » : logins conservés après échec | Fondé | V2-5 : effacement des secrets séparé de la récupération processus, inconditionnel (§3.2, §6.6, lot L5) ; seuls les diagnostics filtrés survivent |
| 6 | Astra | P2 | l.969 | L4 conserve un identifiant sur sa seule *forme* avant identification ; un canari de cette forme passe | Fondé | V2-6 : aucun identifiant retenu sans corrélation à une identité témoignée (§6.3, lot L4) ; canari en forme d'instance ajouté au RED |
| 7 | Astra | P2 | §8.3, l.828 | L6 manque un descendant Python transitoire terminé avant le contrôle au nettoyage | Fondé | V2-7 : journal d'exécutions de toute la cellule §8.3, RED descendant transitoire (1/10/100 ms), sinon garantie explicitement bornée et F8 `partial`, lot L6 |
| 8 | Astra | P2 | §8.2, l.807 | D1 rouvre QO4, décision owner acquise ; V-A devient le défaut contre cette décision | Fondé | V2-8 : QO4 = règle en vigueur (§8.2), interdiction d'exécution = proposition nouvelle, absence de backend Vibe sans Python maintenue comme constat, D1 fermée §13, lot L7 sans porte de décision |
| 9 | Astra | P2 | l.888 | Le RED/GREEN de L2 lance Vitest en direct : corriger `run-test-gates.mjs` ne peut pas le rendre vert | Fondé | V2-9 : RED/GREEN via `runGates()`/`STEPS` avec preuve d'exécution du vrai step ; invocation directe gardée comme contrôle négatif du garde PID, lot L2 |
| 10 | Sol | P1 | §3.3, l.309 | Même faux positif de polling lent ; `inbox-wake ok` atteste l'appel driver, pas la consommation | Fondé (doublon de #1) | V2-1, idem #1 |
| 11 | Sol | P1 | L11, l.1151 | Couverture complète sans lots exécutables ; alternative : laisser F3 ouvert jusqu'à décision owner de livraison partielle | Fondé (doublon de #2) | V2-2, idem #2 ; l'alternative est aussi inscrite : F3 reste ouvert après le jalon partiel, toute livraison à ce stade exige une décision owner explicite (§5.4) |
| 12 | Sol | P1 | §7.1, l.710 | Aucun contrôle obligatoire de PR, sans secrets, vérifiant la preuve de campagne de confiance pour le SHA candidat ; refus à tester (absente, périmée, incomplète, bloquée) | Fondé, portée précisée (voir note B) | V2-3 : `xcli-receipt-check` §7.1 avec les 7 cas de refus testés au lot L11 ; requis sur la PR branche→`main` et la release, en mode rapport seul sur les PR de lots |
| 13 | Sol | P2 | §6.4, l.641 | Plafond de quota sans mécanisme d'application ; inclure préflights et retries ; RED d'arrêt au plafond | Fondé, traduit (note A) | V2-4, idem #4 (préflights, retries et reprises explicitement débités ; RED (e) du lot L8) |
| 14 | Sol | P2 | L5, l.1001 ; §6.6 | Le nettoyage défaillant autorise la conservation des logins, y compris en campagne locale ; récupération/destruction du confinement à définir | Fondé (doublon de #5, angle local ajouté) | V2-5, idem #5 + procédure de récupération du confinement §6.6 (runner éphémère détruit ; en local, racine nommée, campagne non reprenable tant que l'effacement n'est pas prouvé) ; RED vérifiant la disparition des copies |
| 15 | Sol | P2 | §8.3, l.828 | Descendant Python transitoire manqué ; RED avec descendant inoffensif ou garantie qualifiée non exhaustive | Fondé (doublon de #7) | V2-7, idem #7 (les deux branches de l'alternative sont prévues : journal événementiel, sinon borne énoncée) |

## Vérifications contre les sources (lecture seule, branche `97f93e72` sauf mention)

| Source vérifiée | Fait établi | Constats concernés |
| --- | --- | --- |
| `scripts/qualify-cross-cli.mjs:294`, `:268`, `:443` | `woke = received && noPostSendHarnessInput` ; le prompt récepteur dit « do not poll » (instruction, pas preuve) ; JSON worker invalide → ligne `blocked` fabriquée sans `cleanupFailed` et la campagne continue | #1, #10, #5, #14 |
| `packages/h2a/src/runtime/drive/inbox-wake.ts` (log `drive ok/failed`), `runtime/mcp/notifications.ts` (`onInboxArrival` à chaque tick), `runtime/mcp/stdio.ts` (`H2A_NOTIFY_INTERVAL_MS`) | `drive ok` = ligne signée injectée dans le PTY ; le handler n'avance `seen` qu'en cas de drive réussi et retente au tick suivant → un wake retenu au niveau de l'hôte privé est relâchable sans toucher au produit | #1, #10 (base du protocole §3.3 v2) |
| `scripts/qualify-cross-cli.mjs` (bloc `finally`, suppression conditionnée à `!cleanupFailed`, `privateCleanupRoot`) | Le code actuel conserve la cellule — logins inclus — précisément en cas d'échec de nettoyage | #5, #14 |
| `scripts/xcli-proxy.mjs:88` | `instance: request.args?.instance` retenu verbatim, y compris en échec | #6 |
| `scripts/xcli-lab.mjs:200-205` | Regex `python\d*(?:\s\|$)` : `python3.14` et les wrappers passent ; rien sur les descendants | #7, #15 |
| `scripts/run-test-gates.mjs` (sur `origin/main` : step `h2a-runtime`, `vitest` direct, `verifyExecution`, exports `runGates`/`STEPS`) | Le dispatch réel est testable de façon ciblée via `runGates([step réel])` ; l'invocation directe de Vitest ne traverse pas le correctif | #9 |
| Registre des décisions owner (`DECISIONS-owner.md`, l.9) | QO4 consignée comme **consensus adopté** : runtime Python fournisseur admis, tout ce que nous livrons à 0 Python | #8 |
| Registre des décisions owner (12/10 ~09:20) | Paires N×N partout (message, indisponibilité, boucle, négociation) avec vrais binaires ; rien d'annoncé sans preuve | #2, #11 |
| `packages/h2a/src/mcp.ts` + suites existantes (`loop-*.test.js`, `cli-negotiate*.test.js`, `gov-conductor*.test.js`, `drive-consent-*.test.js`, `cross-cli-cooperation.test.js`) | 45 noms `h2a_*` distincts au grep ; la sémantique boucle/négociation/conductor/consentement est prouvée en processus, jamais entre CLI — les lots L12–L15 partent de ces suites comme entrées, pas comme substituts | #2, #11 |
| `scripts/check-no-python.sh` | Présent sur `origin/main` (donc sur la branche après L1), absent de la base de la branche : la v2 le cite comme tel (§8.2) | #8 |
| Aucune occurrence d'un compteur d'usage/tours dans `xcli-proxy.mjs` / `qualify-cross-cli.mjs` | Aucun signal uniforme de tours modèle n'est témoigné aujourd'hui | #4, #13 (note A) |

## Points où la demande du relecteur est traduite ou bornée (pas d'erreur de fond relevée)

Aucun des 15 items n'est factuellement faux sur son constat central ; les ancres citées disent ce que les relecteurs en disent. Trois demandes portent sur un signal ou une porte que les sources ne fournissent pas sous la forme littérale demandée ; la v2 les applique sous une forme bornée et étiquetée, au lieu d'inventer le signal :

| Note | Demande | Pourquoi la forme littérale n'existe pas dans les sources | Forme retenue en v2 |
| --- | --- | --- | --- |
| A | « Signal fiable » des tours modèle consommés, arrêt au plafond D2 (#4, #13) | Aucun compteur de tours/usage témoigné par le harnais ; les transcriptions fournisseur sont un état privé que §6.3 interdit de persister ou d'analyser comme preuve. Plafonner des « tours modèle » sur 6 produits fermés serait une affirmation sans source | Unités plafonnées observables et applicables : session lancée (débit avant spawn), appels MCP par session (frein anti-boucle), temps horloge ; signal d'usage structuré par famille = item d'inventaire du lot L8, `source-gap` nommé par famille (§6.4, §12) |
| B | Check PR exact-SHA sur toute PR (#12) | Exiger une campagne réelle complète à chaque commit de lot dépenserait le quota partagé à chaque push sans rien prouver de plus ; le constat vise la fusion/release (Astra : « avant fusion et release ») | Check requis sur la PR de la branche vers `main` (tête gelée, campagne de confiance sur ce SHA) et sur la release ; sur les PR de lots vers la branche, mode rapport seul affichant `qualification: open`. Avant L11, aucune fusion vers `main` (§7.1) |
| C | Preuve distinguant wake consommé et polling (#1, #10) ; observation exhaustive des exécutions (#7, #15) | Produits fermés : aucune instrumentation interne disponible ; une preuve logique absolue de causalité, ou un journal d'exec garanti sur toute plateforme, n'est pas dans les sources | Wake : protocole de rétention à l'hôte privé (le produit retente si `drive` échoue — fait vérifié), exclusion déterministe des périodes ≤ `W1`, réplications à phases imposées au-delà, borne écrite dans la preuve. Python : journal événementiel exigé, sinon garantie bornée étiquetée et F8 reste `partial` (§3.3, §8.3, §12) |

## Autres changements de cohérence induits (hors constats directs)

| Changement | Motif |
| --- | --- |
| §3.5 : les fenêtres `W0+W1+D` doivent tenir dans le budget cellule, sinon `wake-window-unfunded` | Conséquence du protocole §3.3 ; empêche de « financer » un vert en raccourcissant les fenêtres |
| §6.5(b), §7.4, lot L9, §11 (ligne Vibe), §3.4, §6.1 : suppressions/renvois des mentions « §8 à décider » / « D1 d'abord » / budgets figés à 60 s | Cohérence avec D1 fermée et le nouveau §3.3 |
| §7.2 : les campagnes locales du conducteur deviennent un étage de **diagnostic** sans valeur de reçu de fusion | Conséquence de V2-3 (la v1 admettait un « équivalent local » au GREEN de L11) |
| §12 : ajout de quatre non-couvertures explicites (wake en forme absolue, consommation modèle par famille, descendant transitoire sans observation événementielle, F3 ouvert jusqu'à L15) | Les bornes des notes A/C doivent rester visibles dans les statuts |
| Estimations : L3 2–3 h → 3–5 h, L6 1–2 h → 2–4 h, total « branche remediée » ~15–25 h → ~16–27 h ; ajout L12 ~3–5 h, L13 ~4–6 h, L14 ~4–6 h, L15 ~3–6 h par sous-lot (5 sous-lots), quota de campagne en sus | Le point de rétention wake, le journal d'exécutions et les lots L12–L15 n'existaient pas en v1 |
| Appendices A/B/C : fichiers à créer nommés, commandes `xcli-receipt-check` / scénarios / dispatch de gates ajoutées, traçabilité L12–L15 | Les nouveaux lots doivent être atteignables depuis les appendices |
| `summary.md` (compagnon v1) : **non modifié** (hors tâche) ; il devient inexact aux endroits où la v2 change un défaut (D1, porte de fusion, plafond, L12–L15) | Signalé dans l'en-tête de la v2 et dans le rapport final ; à régénérer si le conducteur le demande |

## Écarts par rapport à la tâche

| Point | État |
| --- | --- |
| Révision en `SPEC_EVOL_CROSS_CLI_MESSAGING.v2.md` | Fait (ce fichier la décrit) |
| Tous les P1/P2 d'Astra et de Sol appliqués | Fait : 15/15 (table ci-dessus) ; 3 sous forme bornée motivée (notes A–C) |
| « Dire pourquoi si un relecteur a tort » | Aucun constat central infirmé par les sources ; les trois écarts de forme sont motivés aux notes A–C avec les faits qui les imposent |
| Table des changements en français | Le présent fichier |
| Aucun code | Respecté : seuls ces deux fichiers `.md` sont produits ; aucune touche au dépôt `h2a` (lectures `git show`/`grep` uniquement), aucun test lancé, aucun processus démarré |
