# MH-L2 — livraison auteur

Base : 5cb66f7e ; branche : feat/0.98.7-mh-l2. Reprise après reboot du premier run, sans refaire ses commits ni ses campagnes rouges terminées.

| Livrable | Réalisation |
|---|---|
| Autorité | Feuille proc-identity .6, préclaim abstrait sans héritage enfant, refus vivant/inconnu, CAS génération/epoch/inode, ownership durable séparé du rendezvous temporaire. |
| Authentification | Secret privé distinct du leurre, challenge lié au socket avant corps, requêtes/réponses/SSE signées, caches expirants/bornés, UTF-8 fragmenté conservé. |
| Starters / QF | Sélection absolue vérifiée, routeur npm en même processus, pause et réservations communes ; run/restore/shim/serve/contrôleur raccordés. |
| Administration / arrêt | Étapes durables et idempotentes, conflit digest, barrière/drain, STOP_COMMITTED interne irréversible, ACK perdu réconcilié, pause opérateur durable et arrêt différé armé. |
| Successeur | Budget partagé ≤3 avant spawn, vivant/inconnu bloquant, SUCCESSOR_FAILED explicite, pins conservés, compensation sous nouvelle autorité et transaction. |

[Contrat et frontières](CONTRACT.md), [ratifications owner](RATIFICATIONS.md), [preuves : commandes et sorties](evidence/README.md).

Validation après reboot : 15/15 tests MH-L2 sous Node 22.22.1 et 15/15 sous Node 24.21.0 ; fail 0, skip 0. Régressions ciblées L0/L1 : 18 pass sous Node 22, shim 2 pass sous Node 24. Contrats CLI ciblés : 3 pass sous Node 22. Le fixture L1 utilisait un préfixe de worktree 775 : rouge prefix_owner_mismatch, puis préfixe privé f.dir et vert, assertions inchangées. Typecheck ciblé : tsc -b packages/h2a packages/h2a-runtime --pretty false sous Node 22/24, code 0, aucune sortie.

Les rouges nominaux unitaires constatent le module encore absent ; les mutations prouvent les gardes sur code existant. Le journal image nommé nominal-red était vert : il est conservé sans le compter comme rouge ; successor-readiness-red est un échec effectif. Aucun test ignoré ne compte comme succès.

| Non couvert / gate restante | Responsable |
|---|---|
| Pièces jointes non vides : ownership/freeze/checkpoint/replay métier complets, bascule G0/G1 du pair | MH-L3/L4/L5 ; refus participant_checkpoint_unqualified en L2 |
| Bootstrap externe QF A, installation/adoption/npm/H4, image release close et fallback diagnostique | MH-L6 |
| Vrais Claude U07/U11, release Node/native, VM/profils et endurance | MH-L8 |
| Gel final .6 et suite globale d’intégration | Conducteur |
| Revue tierce confinée du SHA final | Conducteur, R4 ; aucun consensus indépendant revendiqué ici |

Pas de version bump/publication, main/Track inchangés, pas de gateway ni de coordinateur vivant. bwrap ne démarre pas : commandes autorisées exécutées avec escalade contrôlée ; tous les tests gardent HOME/XDG/store temporaires. Aucun état/binaire h2a installé ni processus tiers consulté ou signalé.

Estimation restante : revue et corrections MH-L2 0,5–1,5 h d’agent, 1–2 tours ; MH-L3/L4/L5/L6/L8 et intégration 18–38 h cumulées, 1–2 tours par lot puis 1–2 d’intégration. Estimation provisoire calée sur les durées L0/L1 et les commandes mesurées ; disponibilité des vrais clients hors temps actif.
