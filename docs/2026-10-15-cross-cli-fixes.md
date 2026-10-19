# Cross-CLI — corrections et limites de qualification

La phase 1 a été commitée et poussée dans `575dd12` avant toute correction
produit : 0 measured-OK, 5 measured-KO, 31 blocked. Sa table reste immuable.

| Correction | Preuve rouge | Preuve verte | Limite |
|---|---|---|---|
| Codex : chemin natif `config.toml` et traduction `[mcp_servers.h2a]` | Cellules phase 1 : aucun MCP ; oracle natif : configuration ignorée | `node --test scripts/xcli-native-config.test.mjs` : le vrai Codex découvre h2a | Le chargement de config ne prouve pas le réveil du modèle interactif |
| Claude : `.claude.json`, avec explication de `CLAUDE_CONFIG_DIR` | Oracle natif : configuration ignorée au chemin XDG indiqué auparavant | Même commande : le vrai Claude se connecte au serveur h2a source | Onboarding/trust et échanges modèle restent à qualifier |
| Gemini : profil exact accepté dans le registre strict et l’enrollment | Matrice simulée complète : 30 OK, 6 KO, tous les destinataires Gemini ; enveloppes livrées mais aucun wake ; test registre rouge | `claude:gemini` passe avec le même harness après correction : MCP, envoi signé, livraison, wake vérifié, lecture inbox et réponse | Modèle réel Gemini bloqué sur l’authentification dans la copie isolée |

Le correctif Gemini conserve une liste fermée : les outils inconnus restent
exclus. Il ne qualifie pas sa délégation, son throttle ni sa reprise : les
frontières existantes restent explicites, et le lancement des jobs Gemini
non qualifiés est refusé avant tout effet. Les champs purement descriptifs
des jobs peuvent porter un outil de session reconnu.

Le writer JSON refuse toujours TOML/YAML/JSONC, y compris avec `--force`.
Les oracles et le harness suivent la traduction native documentée ; aucune
réécriture permissive de configuration n’a été introduite. La configuration
centrale automatique Codex conserve un writer historique JSON : cette voie
complète de lancement reste non qualifiée par ces oracles.

| Commande observée | Résultat |
|---|---|
| `node --test scripts/xcli-native-config.test.mjs` | Rouge Codex, puis rouge Claude ; après correction : 2 pass, 0 fail, 0 skipped |
| `node --test scripts/xcli-gemini-registry.test.mjs` | Rouge avant profil Gemini ; après correction : 1 pass, 0 fail, 0 skipped |
| `node scripts/qualify-cross-cli.mjs --simulated --pair claude:gemini --timeout-ms 30000 --output docs/2026-10-15-cross-cli-gemini-green.json` | simulated-OK, exit 0 |
| `node scripts/xcli-source-tests.mjs packages/h2a/test/hosts-integration.test.js packages/h2a/test/host-mcp-scenario.test.js packages/h2a/test/mcp-central.test.js packages/h2a/test/evo-host-setup-wake.test.js` | 54 pass, 0 fail, 0 skipped après résolution complète des dépendances workspace |
| `node scripts/xcli-source-tests.mjs packages/h2a/test/pty-native-messaging.test.js` | 5 pass, 0 fail, 0 skipped |
| `TMPDIR=/tmp node packages/h2a/test/helpers/identity-isolated-typecheck.mjs` | track, remote-protocol, h2a, h2a-runtime : exit 0 |

Le builder initial omettait les dépendances imbriquées de h2a-runtime :
16 échecs de suite MCP centrale ont été conservés comme diagnostic, puis
résolus dans le builder sans modification du produit. Les deux peers de
chaque expérience partagent ensuite une vue des seuls PID qu’elle a créés,
afin que les verrous puissent vérifier leur vivant sans voir l’état réel.

Le premier budget de simulation de 15 s était inférieur au contrat d’identité
produit de 20 s, avant même la barrière inactive. La simulation réutilise
désormais le helper qui respecte l’échéance annoncée par le produit, avec le
budget de qualification par défaut de 30 s. L’échéance produit, les signatures,
le refus de cibles inconnues et les protections d’activité humaine sont
inchangés. Aucun retry ne transforme un échec en succès déclaré.

Les tests runtime existants contiennent des placeholders explicitement
déclarés non-tests dans `scripts/test-non-tests-0986.json`. Ils restent listés
comme non couverts ; tout autre skip/todo fait échouer le nouveau runner.

La première exécution élargie de la fixture historique utilisait son ancien
`npm install` avec scripts actifs : l’absence de Python n’est pas attestée
pour cette exécution. La fixture impose désormais `--ignore-scripts` pour
install/pack et compile le binding N-API directement avec g++. Le candidat
installe les tarballs source concordants runtime/core/Track, sans dépendre
d’une version Track qui n’est pas encore publiée. Ses trois tests sont
ensuite passés, sans skip, dans le préfixe temporaire.

Des campagnes locales parallèles ont également atteint l’échéance d’identité
produit, avec une dernière phase `identity_keys`. Ces échecs restent conservés
comme bloquants et ne sont pas excusés comme aléas de modèle. La course de
teardown d’une CLI déjà quittée possède sa propre preuve rouge sur `575dd12`
et verte sur le harness corrigé : la génération/incarnation doit encore
correspondre et la vue des PID détenus doit confirmer leur sortie.

Les simulations utilisent les APIs natives de production et des modèles
déterministes. Leurs configurations émulées ne sont pas les six parseurs CLI
réels. Elles ne prouvent ni les logins des sièges réels, ni leurs modèles, ni
le lanceur `h2a run` complet, ni l’ensemble des fonctions hors messagerie.

| Vérification complémentaire | Résultat observé |
|---|---|
| CI `38851219130`, Node 22 et 24, `qualify-cross-cli --simulated --timeout-ms 30000` puis `xcli-ci-check` | Chaque version : `simulated-OK:36, simulated-KO:0, blocked:0` ; `cells:36, outcome:simulated-round-trips-proven` |
| Même CI, `node scripts/xcli-runtime-tests.mjs` | Chaque version : 34 suites, 688 entrées, 684 pass, 0 fail, 2 skipped + 2 todo déclarés non-tests |
| `node --test` lab/proxy/simulation/cleanup/registre/namespace/terminal | 12 pass, 0 fail, 0 skipped ; le contrôle négatif livre sans réaction puis fait refuser la qualification |
| Source-consumers supplémentaires, première copie temporaire | 53 pass, 4 fail (sources/docs absents), 12 todo déclarés ; exit 1 |
| Même suite `cli-command-map.test.js` après copie sources/docs | 20 pass, 0 fail, 0 skipped, 0 todo ; exit 0 |
| Rejeu réel Codex après réponses VT de démarrage | 2 réponses terminal observées ; MCP toujours absent, `measured-KO`, exit 2 |

Les reçus CI archivés portent leur source/harness propres ; ils ne prouvent
pas automatiquement un commit ultérieur. Voir le rapport final pour le résultat
du nouveau lanceur et des neuf suites supplémentaires.

L’audit des producteurs historiques a ensuite identifié des lecteurs procfs
antérieurs au mécanisme de PID détenus. Leurs exécutions antérieures, locales
et CI, n’avaient pas de preuve de confinement procfs : c’est un écart aux consignes, distinct de
l’absence de preuve Python déjà signalée. Leur exécution exige désormais
un espace PID privé avec procfs remonté. L’essai initial, avec Node en PID 1,
a échoué sur 7 collectes de processus (677 pass) ; le lanceur corrigé utilise
un init C++ qui récolte les seuls descendants de cet espace. Ses tests refusent
un espace inchangé et toute exécution de l’init hors PID 1. Aucun délai ni
assertion produit n’a été assoupli.

Le run `38853536274` confirme ensuite les 36/36 simulations et les 684 tests
runtime exécutés sur Node 22 et 24, avec l’init privé. Ses neuf suites source
supplémentaires donnent 92 pass, 2 fail et 12 todo déclarés : les deux appels
MCP `h2a_run` sont refusés parce que leur workspace est sous `/tmp`. Le runner
source utilise désormais un mkdtemp dans `/home/runner/work/_temp`, strictement
réservé au runner GitHub hébergé, avec la frontière `.q` du helper inchangé.
La garde de workspace durable du produit reste intacte. Le run `38854531546`
confirme ensuite, sur les deux versions de Node : 94 source pass, 0 fail,
12 todo déclarés. Le workflow ciblé est vert : 36 cellules, 793 tests exécutés
par version (13 harness + 2 oracles + 684 runtime + 94 source). Les 16 non-tests
déclarés ne sont pas comptés comme couverture. Les commandes exactes et sorties
des suites sont archivées dans `2026-10-15-cross-cli-ci/3ef2030e/node*/suites.json`.

Le rejeu réel Claude avec le même terminal corrigé reste `blocked
(onboarding-or-trust)`, exit 2. Les gates globaux npm-test/release restent non
qualifiés et doivent fournir le confinement PID de la fixture avant merge.
