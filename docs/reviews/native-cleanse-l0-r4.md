# PR #396 — L0, correction round 4

Portée : lot L0 « Baseline witnesses » de la spec native cleanse,
SHA-256 `bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Aucun correctif produit L1–L6 ni changement de version.

| Finding round 3 | Correction et preuve |
|---|---|
| P1 Astra/Sol : RED absorbés, retour GREEN→anciens bytes accepté | Ledger commité `scripts/native-cleanse-contracts.json` : 42 contrats, tous RED à L0, chacun avec nom/code/opérateur/actual/expected/message et digest de preuve exact. Le helper émet le résultat observé ; le reporter le transporte ; le vérificateur du step `tests` de `scripts/run-test-gates.mjs` vérifie les 42 entrées. Aucun flag d'environnement ne décide du verdict. |
| P1 : progrès silencieux ou raison RED différente | GREEN→RED, RED→signature différente et RED→GREEN non déclaré échouent. Une réparation exige le passage de l'entrée à GREEN dans le même changement. Chaque cas a son contrôle négatif dans la trust root CI indépendante, même avec `success:true` et tests annoncés PASS. Les résultats absents/doublonnés/inconnus et une assertion avalée sont également rejetés. |
| P2 Astra : premier --workspace validé, dernier exécuté | Refus des options dupliquées, inconnues ou incomplètes ; contrôle négatif des options host/workspace/session-store pour Muse/Agy. Muse sans --workspace reste ancré à son workspace enregistré. |
| P2 Astra : activation Agy ignorée | L'observation de l'import inclut le statut vendor enabled. Les sélections initialement activée et désactivée sont testées ; leur inversion échoue. |
| P2 Sol : MCP du plugin actif jamais résolu | La déclaration MCP du plugin Claude sélectionné résout le véritable exécutable dans le PATH privé et échange initialize/tools/list avec le candidat. Un MCP direct sain ne masque plus un plugin dont h2a PATH sort 64. |

Le ledger conserve un digest canonique de la preuve : seuls le chemin aléatoire
de la fixture, le chemin Node et la version du candidat synthétique sont
normalisés. Les bytes historiques de hooks embarqués dans l'ancien cache sont
stables, sans chemin aléatoire caché dans leur digest. Le contenu binaire reste
hashé en bytes bruts. Les anciennes règles knownMissing et H2A_CLEANSE_STRICT
ont été retirées.

## Commandes et sorties

Toutes les commandes utilisent le TMPDIR privé
`/home/antoinefa/.cache-tmp/h2a-test/run-xyfAMY` et
`H2A_TEST_QUALIFICATION_ROOT=$TMPDIR` ; les fixtures créent leurs HOME/XDG/npm.
Prérequis : `npm run build -w @sentropic/track && npm run build:h2a`, exit 0.

| Commande ciblée / reproduction | Résultat |
|---|---|
| Anciens helpers 925c4f821, trois nouveaux contrôles hôtes | 0/3 PASS, 3 échecs attendus : options dupliquées, activation Agy, MCP plugin. |
| Ancien vérificateur de main, `node --test --test-name-pattern='L0 ledger gate: a ' packages/h2a/test/run-test-gates.test.js` avec les trois nouveaux contrôles | exit 1 ; 0/3 PASS, trois défauts reproduits. |
| `node --test packages/h2a/test/native-cleanse-oracle.test.js` après correction | exit 0 ; 9/9 PASS. |
| `node --require "$TMPDIR/precompiled.cjs" --import ./packages/h2a/test/helpers/native-isolation.js --test` avec reporters TAP/npm, baseline + oracle | exit 0 ; 57/57 PASS, 42 résultats RED exacts transmis ; vérificateur réel du step tests : `[]`. |
| Même commande, baseline seule sur copies de main 912dd3035 et rc.7 8d588db05 | Chacun exit 0 ; 48/48 PASS, 42 résultats RED exacts ; vérificateur réel : `[]`. |
| `node --test packages/h2a/test/run-test-gates.test.js` | exit 0 ; 48/48 PASS, dont les trois contrôles de transitions du ledger. |
| `node --test packages/h2a/test/gate-execution-evidence.test.js packages/h2a/test/prepared-npm-cache.test.js` | exit 0 ; 72/72 PASS. |
| Inventaire/déclarations ; `git diff --check` | `[]` ; exit 0. |

Zéro skip/todo dans ces résultats. Les 48 PASS de la baseline signifient que
les six parcours passent et que chacun des 42 résultats respecte le ledger ;
ils ne signifient pas que les contrats produit sont GREEN. Premier résultat
RED : `claude installed skill bytes (L3+L4)`, false contre true.

Rejeu rounds 1–3 : prepare/prepack/pack/install globaux réels, cinq tarballs
locaux vérifiés ; formats rc.7 valides (UUID v4, maps tabulées/flock, claims
SHA-256, registre complet) ; vrais run frais/reprise sur deux endpoints et
restore de vingt UUID uniques avec dispatcher/flock et acquittements PTY ;
préservation lock-id, humains/inconnus et barrière non attribuable. Les anciens
faux GREEN version/echo, hooks fictifs, helpers/ressources absents, cache Codex
non sélectionné et collision binaire sont rejoués par l'oracle.

Les premiers essais sans H2A_TEST_QUALIFICATION_ROOT ont été refusés par le
garde d'isolation ; ils ne sont pas comptés comme RED produit. Un premier
contrôle de signatures mutait également sa référence par alias ; les résultats
de contrôle sont désormais clonés indépendamment du ledger.

Limites : la disponibilité réussit aussi sur rc.7 ; aucune panne exacte du
28/10 n'est donc prouvée. L1 doit rendre GREEN les huit contrats de récupération,
L3 les trois contrats paquet, L3/L4 les 31 contrats hôtes. L2, L5 et L6 restent
séparés. Binding node-pty précompilé fourni par preload privé pour respecter
l'interdiction de Python ; lifecycle npm produit actif, compilation native
locale non qualifiée. Suite complète locale et nouveau consensus de pairs non
revendiqués. Aucun état propriétaire ni binaire h2a installé utilisé.

Logs conservés dans `tmp/h-cond/fix-native-cleanse.r4-*`.
Le TMPDIR privé sera supprimé après le suivi de CI. Aucun merge/tag/trailer.
