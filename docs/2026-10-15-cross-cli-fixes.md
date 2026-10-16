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
