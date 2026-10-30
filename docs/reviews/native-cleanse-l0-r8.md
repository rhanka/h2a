# PR #396 — L0, correction round 8

Spec : lot L0 « Baseline witnesses », SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Les deux revues de `f40d77204` identifient le même P2 : un choix global MCP
modifié reste masqué par le RED attendu pour une cible déjà périmée.

La preuve de chaque contrat MCP contient maintenant les entrées serveur,
les choix globaux natifs et leur état effectif observé. Claude conserve la
sélection du projet ; Gemini les listes allowed/excluded ; Vibe l'activation,
les filtres et permissions globaux ; OpenCode les règles globales et l'agent
sélectionné. Les autres adaptateurs conservent leurs choix dans leur entrée
de configuration utilisateur globale. Les objets ordonnés sont encodés en
listes d'entrées typées avant la canonicalisation du ledger : inverser deux
règles OpenCode reste une différence de preuve.
Le verdict et la preuve utilisent le même objet issu d'une unique lecture
de configuration : une modification vue à la première lecture reste dans
la signature même si le fichier change ensuite.

Les huit tests obligatoires de sélection couvrent désormais une route déjà
RED, dont le verdict reste false après mutation. Ils exigent un rejet pour
signature différente. Des contrôles supplémentaires couvrent les choix
masqués par une autre désactivation et l'ordre des permissions. Le test
d'installation empaqueté exécute également un contrôle négatif pour chacun
des huit adaptateurs, avec restauration de chaque configuration.
Ces contrôles utilisent les configurations périmées capturées avant
installation, puis restaurent les configurations observées après installation.
Une réparation MCP accompagnée de sa promotion GREEN reste ainsi acceptée.

Seules les huit empreintes de preuve MCP du ledger changent. Les **42 états
restent RED** ; aucun vérificateur, inventaire, budget CI, délai ou garde
d'isolation n'est assoupli. Les contrôles étendent des identités déjà
obligatoires dans l'inventaire npm et la trust root indépendante.

## Preuves ciblées

Prérequis : `npm run build -w @sentropic/track`, puis `npm run build:h2a`,
exit 0. Exécutions avec HOME/XDG/runtime privés ; candidats préparés,
prepackés et installés depuis les cinq tarballs de chaque source.

| Contrôle | Résultat observé |
|---|---|
| Ancien helper, reproductions empaquetées Claude/Gemini/OpenCode/Vibe | Chacune **48 PASS, gate 0** : faux GREEN reproduit avant correction. |
| Huit contrôles de sélection ajoutés, ancien helper | **4 PASS / 4 FAIL**, zéro skip/todo ; les quatre choix globaux sont omis. |
| Configuration modifiée à la première lecture puis rétablie, huit adaptateurs | Avant partage du snapshot : **0 PASS / 8 FAIL**, changement masqué ; après : **8/8 PASS**, zéro skip/todo. |
| Nouveau helper avant recalage du ledger | **40 PASS / 8 FAIL** : exactement les huit signatures MCP changent. |
| Mutation globale de chacun des huit adaptateurs sur le candidat installé, assertion locale neutralisée | Chacune **48 PASS enfants, gate 1** ; seul le contrat MCP de l'adaptateur change de signature, en restant RED. |
| Baseline, oracle et foreign-host, Node 24.18.0 | **94/94 PASS**, gate 0 ; **42 RED exacts**, zéro skip/todo. |
| Baseline et oracle, Node 22.22.1, reprise finale | **75/75 PASS**, gate 0 ; **42 RED exacts**, zéro skip/todo. |
| Oracle rejoué avec le MCP du vrai paquet installé | **27/27 PASS**, gate 0, zéro skip/todo. Métadonnées plugins des fixtures positives réparées artificiellement ; garde de réexécution active pour neutraliser l'auto-upgrade opt-in. |
| Gate, preuve d'exécution et cache npm | **120/120 PASS**, zéro skip/todo. |
| Ledger a/b/c, assertion locale neutralisée | Chacune **48 PASS enfants**, gates **1/1/1** ; réparation avec GREEN déclaré : **gate 0**. |
| Recovery, contention et foreign-host | **38/38 PASS**. |
| Terminal reset fonctionnel | **6/6 PASS**. |
| Dix répétitions sockets | **50/50 PASS**, zéro skip/todo. |
| Main `912dd3035` et rc.7 `8d588db05`, reconstruits séparément | Chacun **48/48 PASS**, gate 0 ; **42 RED exacts**. |
| Promotion future d'un MCP réparé, avant/après isolation du contrôle périmé | Avant : **16 PASS / 32 FAIL**, assertion `GREEN !== RED` puis observations non émises ; après : **48/48 PASS, gate 0**, contrat MCP déclaré GREEN accepté. |
| Baseline finale après cette isolation, Node 22 et Node 24 | Chacune **48/48 PASS**, gate 0 ; mêmes **42 RED exacts**. |

Commandes : `node "$TMPDIR/gate.mjs" packages/h2a/test/native-cleanse-{baseline,oracle}.test.js`,
`node --test packages/h2a/test/{run-test-gates,gate-execution-evidence,prepared-npm-cache}.test.js`,
et les drivers privés `reproduce.mjs`, `mutations.mjs`, `history.mjs`, `repeat.mjs`.
Le driver ciblé utilise le vrai step `tests`, le reporter et le vérificateur
de `scripts/run-test-gates.mjs`, sans exécuter la suite complète.

Deux installations ont rencontré un ETARGET npm sur des dépendances AWS.
La relance avec les métadonnées complètes du registre a réussi, sans
modification des dépendances ni des lifecycles produit. Une première
campagne concurrente échoue sur la disponibilité native et les vingt
transcripts de restore ; ses sorties sont conservées avant reprise en série.
Le rejeu en série donne 48/48 pour les cinq contrôles restants et rc.7.
La campagne Node 22 concurrente termine à 74/75 sur une sonde de hook ;
le test concerné passe seul en 1,5 s, puis la campagne complète passe
75/75 en 150 s, sans changement de code. Le rejeu MCP installé dure 609 s,
sous le budget npm existant de 21 minutes ; aucun budget CI augmenté.
Un premier oracle a dépassé le plafond privé de 240 s ; la reprise utilise
le budget existant du step npm, sans changement des timeouts du dépôt.

## Portée et limites

### Réparation des deux blocages CI sur `503c52f8d`

Ce head termine à 17/19 succès : tous les témoins L0 passent, avec les
42 RED exacts sous Node 22 et 24 ; les deux jobs échouent ailleurs.

Le nonce aléatoire partagé des tests d'enrôlement peut commencer par `--`.
Le parseur de `--nonce` l'interprète alors comme une option : les deux
assertions CLI échouent avec « nonce required ». Les fixtures de preuve
copiable et de clé corrompue passent maintenant le challenge intact par la
route publique JSON `--challenge`. Aucune valeur aléatoire n'est exclue et
les assertions cryptographiques, de contenu et de non-divulgation restent
identiques. Avec un nonce valide forcé à commencer par `--` : **0/2 avant**,
**2/2 après** ; fichier complet **44/44** sous Node 22 et 24, zéro skip/todo.
La syntaxe directe `--nonce` n'est pas modifiée dans ce lot.

Le journal de diagnostic a un drain best-effort de 100 ms. Un writer froid
peut ne pas être prêt avant la sortie du host : un chargement retardé de
400 ms reproduit le timeout de 5 s, avec host réellement sorti à 1 et journal
vide. Le test de classification prépare désormais le vrai coordinateur et
son thread I/O, attend un acquittement réel puis retire son événement de
contrôle privé avant de provoquer l'erreur d'option du vrai host compilé.
Les assertions restent exactement `startupError`, `exit`, erreur redacted,
code 1 et cause `startupError`. Le cas est rejoué **10/10** sur chaque Node,
avec puis sans le retard contrôlé de 400 ms. Aucun timeout, budget, retry ou
code de production n'est modifié.

Le replay local du journal extrait uniquement ce cas et ses helpers sans
changer les assertions ; il n'exécute pas le canary existant qui écrit dans
`/tmp`. La CI exécute de nouveau le fichier complet. Logs :
`ci-node{22,24}-503.log`, `nonce-leading-flags-{red,green}.tap`,
`nonce-actual-node{22,24}.tap`, `journal-cold-red.log` et
`journal-fixed*-node{22,24}.log` dans les preuves r8.

Les rounds 1–7 sont couverts par les témoins empaquetés et l'oracle : formats
rc.7, deux endpoints et I/O, restore de vingt UUID via dispatcher/flock,
lock-id et humains/inconnus préservés, MCP/hooks/plugins/caches, activation,
filtres, constructeurs, identités et overrides des huit adaptateurs ; courses
ENOENT et descripteur procfs fermé. L'incident exact du 28/10 reste non
démontré ; les fixtures ne qualifient pas les CLI fournisseurs vivants.

Binding PTY précompilé fourni par preload privé : aucun Python invoqué ;
recompilation native locale non qualifiée. Aucun état propriétaire ni
binaire h2a propriétaire utilisé. L1–L6 restent séparés. Pas de suite complète
locale ou de nouveau consensus de pairs revendiqué : le dispatch installé
est interdit par le confinement et aucun MCP h2a autorisé n'est disponible.

Preuves : `tmp/h-cond/fix-native-cleanse.r8-*`. TMPDIR privé :
`/home/antoinefa/.cache-tmp/h2a-test/run-hGaJSE`, supprimé après suivi CI.
