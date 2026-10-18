<!-- Synthetic contextual report; language=fr. Human semantic acceptance pending. -->
<!-- Historical references track-report-contextual.md and track-report-raw.txt are unchanged. -->
**2026-10-11T12:00:00.000Z → 2026-10-18T12:00:00.000Z** · c-new · 2/15 (13%)
coverage: 14 → 12 · outside-wp: 7

## FAIT

| scope | avancement | dernières actions |
| --- | --- | --- |
| global | 2/15 (13%) | La livraison enregistrée permet la reprise dans l’environnement référencé ; le lien de déploiement et la recette à c-new en sont les appuis. |
| WP2 · UAT Beta | 2/3 (67%) | La livraison enregistrée permet la reprise dans l’environnement référencé ; le lien de déploiement et la recette à c-new en sont les appuis. |

## À-FAIRE

| WP | av. | étape | statut | à faire | bloqué | prochaine action |
| --- | --- | --- | --- | --- | --- | --- |
| hors WP ; rattachement à instruire | n/a | [1.1] — | [1.1] — | [1.1] Rendre le choix hors ligne répondable (outside-wp; hors WP ; rattachement à instruire) | options non enregistrées | Enregistrer les options conserver/abandonner le point de reprise hors ligne et leurs conséquences. |
| WP1 · UAT Alpha | 0% | [2.1] dev<br>[2.2] spec<br>[2.3] dev<br>[2.4] dev<br>[2.5] dev<br>[2.6] spec | [2.1] — non qualifié<br>[2.2] — retiré<br>[2.3] 🔴 bloqué<br>[2.4] 🔵 décision attendue<br>[2.5] — non qualifié<br>[2.6] — retiré | [2.1] Reprendre une session interrompue<br>[2.2] Retrait ancien avec dépendance active — motif non enregistré<br>[2.3] Rétablir la lane de reprise<br>[2.4] Choisir le partage de connexion<br>[2.5] Reprendre après une reconnexion<br>[2.6] Retrait : périmètre déjà couvert par la lane ancienne | D1 · dépendance | Rejouer le contrôle de reprise après redémarrage de la lane dépendante ; conserver le journal du résultat. |
| WP2 · UAT Beta | 67% | [3.1] dev | [3.1] — non qualifié | [3.1] Qualifier la reprise sans perte | — | Définir le cas « interrompre puis reprendre sans perdre le dernier message » et enregistrer son résultat. |
| WP1.1 · UAT Alpha.1 | 0% | [4.1] dev | [4.1] — non qualifié | [4.1] Reprendre après une reconnexion | — | Exécuter le cas de reconnexion avec le même identifiant de session et comparer le dernier message. |
| WP3 · phase only | 0% | [5.1] spec | [5.1] — non qualifié | [5.1] Définir le résultat de la phase (outside-wp; hors WP ; rattachement à instruire) | spec | Écrire le résultat attendu de cette phase pour une reprise après interruption. |
| S1 · stream only | 0% | [6.1] spec | [6.1] — non qualifié | [6.1] Définir le résultat du flux (outside-wp; hors WP ; rattachement à instruire) | spec | Documenter quel point de reprise ce flux doit conserver avant de le rattacher à un WP. |
| hors WP ; rattachement à instruire | n/a | [7.1] spec<br>[7.2] spec<br>[7.3] spec<br>[7.4] spec<br>[7.5] spec | [7.1] — non qualifié<br>[7.2] — non qualifié<br>[7.3] — non qualifié<br>[7.4] — non qualifié<br>[7.5] — non qualifié | [7.1] Préparer le prérequis historique (outside-wp; hors WP ; rattachement à instruire)<br>[7.2] Préparer le prérequis de la lane (outside-wp; hors WP ; rattachement à instruire)<br>[7.3] Rattacher la reprise isolée à son WP (outside-wp; hors WP ; rattachement à instruire)<br>[7.4] Préserver le point de reprise (outside-wp; hors WP ; rattachement à instruire)<br>« Quiero reanudar mi sesión sin perder el último mensaje » (demand-raw)<br>[7.5] Restaurer la session (outside-wp; hors WP ; rattachement à instruire)<br>« Quiero reanudar mi sesión sin perder el último mensaje » (demand-raw) | — | Vérifier le livrable des deux prérequis et proposer le WP de rattachement des demandes isolées. |

## DÉCISIONS

| # | sujet | alternatives | préco |
| --- | --- | --- | --- |
| D1 | Partager la connexion utilisée pour reprendre une session ? | A Partager — une connexion<br>B Isoler — deux connexions | A<br> |

[D1](https://example.test/dossier/share)

## RECOMMANDATION

Sans réponse : qualifier la conservation du dernier message, vérifier la reconnexion et instruire les demandes isolées. Le retrait ancien garde sa dépendance ; son motif manque.

Rejouer le contrôle de reprise après redémarrage de la lane dépendante ; conserver le journal du résultat.

D1 A : partage une connexion et libère le choix de reprise ; D1 B : isole les connexions, avec deux connexions à maintenir. Préconisation A : moins de connexions.

Réponds « vas y » pour les travaux sans décision, ou « D1 A » pour autoriser le partage.


```text
track report --period last-week --now 2026-10-18T12:00:00.000Z --commit c-new --expect-events 55 --expect-head sha256:44f138a8a9445eeda256bb853c8528124c8887cf350f16bd9f6d1688c65cb7f6 --resolve <handle>
1.1	01M57000000000000000000092
2.1	01M57000000000000000000007
2.2	01M57000000000000000000019
2.3	01M57000000000000000000041
2.4	01M57000000000000000000049
2.5	01M57000000000000000000029
2.6	01M57000000000000000000079
3.1	01M57000000000000000000057
4.1	01M57000000000000000000029
5.1	01M57000000000000000000064
6.1	01M57000000000000000000068
7.1	01M57000000000000000000022
7.2	01M57000000000000000000044
7.3	01M57000000000000000000060
7.4	01M57000000000000000000073
7.5	01M57000000000000000000074
D1	01M57000000000000000000052
Q1	01M57000000000000000000092
```
