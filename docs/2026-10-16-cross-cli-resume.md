# Reprise cross-CLI — 16 octobre 2026

La [table initiale](2026-10-15-cross-cli-phase1.md) reste inchangée : 0 measured-OK, 5 measured-KO, 31 blocked. Elle a été poussée avant les corrections. Les résultats suivants sont des rejeux ciblés de phase 2.

| Cellule réelle | MCP | Envoi/livraison | Réception live/réponse | Résultat |
|---|---|---|---|---|
| Claude → Claude | Oui, deux identités | Oui, enveloppe signée corrélée | Oui, sans entrée harness après barrière ; réponse signée livrée | **measured-OK** |
| Codex → Codex | Non avant échéance | Non mesuré | Non mesuré | measured-KO |
| AGY → Claude | Oui | Aucun envoi observé | Non mesuré | measured-KO |
| AGY → AGY | Non avant sélection de login | Non mesuré | Non mesuré | blocked : authentication-required |
| Muse → Claude | Non côté Muse | Aucun envoi | Non mesuré | measured-KO |
| Muse → Muse | Non | Non mesuré | Non mesuré | blocked : cli-exited-before-ready |
| 30 autres cellules | Pas rejouées ici | Pas qualifié par ces cellules | Pas qualifié | Relevé initial uniquement |

Preuves : [Claude rouge](2026-10-16-cross-cli-resume-claude-drive-red.json), [Claude vert](2026-10-16-cross-cli-resume-claude-drive-green.json), [Codex](2026-10-16-cross-cli-resume-codex-processes.json). Les JSON conservent la commande, les empreintes du build et du harness, les étapes observées et le nettoyage. Le SHA de base est 8b9c0fbb ; les empreintes identifient les modifications non commitées lors des mesures. Claude → Claude ne prouve aucune autre paire.

| Correctif | Preuve rouge → vert |
|---|---|
| Démarrage Claude | Le dialogue 2.1.301 masque les index et met le focus sur Cancel. Le harness attend la stabilité puis choisit explicitement Yes par navigation normale dans son workspace vide. Il attend la disparition du dialogue sans retaper. Fixture sur 8b9c0fbb : blocked ; nouvelle fixture : round trip signé. CLI réelle : MCP non chargé → chargé et envoi signé observé. |
| Soumission native du wake | Le pilote annonçait drive ok mais le wake restait composé : wakeDraft=true, aucune activité ou lecture inbox. Le produit envoie désormais la ligne validée puis une unique Entrée dans un burst distinct après 100 ms, sous le même lease. La validation anti-contrôles et la protection contre l’activité humaine restent actives. Test fonctionnel : 0/1 → 1/1 ; cellule réelle : live-receive-not-observed → measured-OK. |
| Preuves de wake et nettoyage | Compteur et résultat ok/failed extraits d’un format fermé ; aucun texte libre de stderr conservé. Reçu explicite après arrêt vérifié des seuls enfants possédés et suppression de l’état CLI privé. Test de non-conservation des corps maintenu. |

La fenêtre modèle du rejeu réel Claude passe de 30 à 60 s. À 30 s, l’envoi avait consommé 27 s et le polling inbox produit vaut 5 s. Le KO a aussi été reproduit à 60 s avant correction : le vert ne repose pas sur le seul délai. Les délais produit d’identité et les gardes restent inchangés. Aucune suite globale locale exécutée.

| Commande ciblée | Sortie observée |
|---|---|
| `XCLI_STARTUP_BASELINE=8b9c0fbb node --test scripts/xcli-startup.test.mjs` | tests 1 ; pass 0 ; fail 1 ; skipped 0 ; exit 1, onboarding-or-trust |
| `node --test scripts/xcli-proxy.test.mjs`, avant puis après instrumentation | 0/1 puis 1/1 ; aucun corps privé conservé |
| `node scripts/xcli-runtime-tests.mjs packages/h2a-runtime/src/native-terminal/drive.functional.test.ts` | Rouge : 0 pass, 1 fail ; vert : 1 pass, 0 fail ; pending 0 |
| `node --test --test-concurrency=1 scripts/xcli-lab.test.mjs scripts/xcli-proxy.test.mjs scripts/xcli-terminal.test.mjs scripts/xcli-cleanup.test.mjs scripts/xcli-simulation.test.mjs scripts/xcli-startup.test.mjs` | tests 11 ; pass 11 ; fail 0 ; skipped 0 ; exit 0 |
| `node scripts/xcli-runtime-tests.mjs packages/h2a-runtime/src/native-terminal/drive.functional.test.ts packages/h2a-runtime/src/native-terminal/op.test.ts packages/h2a-runtime/src/native-terminal/terminal-modes.functional.test.ts` | tests 19 ; passed 19 ; failed 0 ; pending 0 ; exit 0 |
| `node scripts/xcli-source-tests.mjs packages/h2a/test/native-process-view.test.js packages/h2a/test/native-spawn-guard.test.js packages/h2a/test/pty-native-messaging.test.js packages/h2a/test/drive.test.js packages/h2a/test/cli-contract.test.js` | Avant copie des fixtures : 144 pass, 4 fail ; après : 148 pass, 0 fail, exit 0. Un placeholder keepalive déclaré par le propriétaire est exclu de la couverture. |

Les quatre échecs du build source étaient des fixtures absentes : assets Focus, bundle skills et configurations des runners. Le runner copie désormais ces fichiers versionnés sans les modifier. Assertions et manifeste propriétaire des non-tests inchangés. Aucun skip d’absence d’état réel n’est accepté.

Reçus dans [le dossier local](2026-10-16-cross-cli-local/). Les commandes réelles figurent intégralement dans leurs JSON. Les résultats supplémentaires et CI seront ajoutés après exécution.

| Limite ou essai réfuté | État |
|---|---|
| Codex | Consigne visible comme brouillon, aucun MCP initialisé. Une Entrée avant barrière ne change rien : essai retiré. Les trois descendants observés étaient en état S puis ont été collectés. Aucun support réel annoncé. |
| AGY | [Rejeu vers Claude](2026-10-16-cross-cli-resume-agy-claude.json) : deux MCP chargés, mais aucun envoi AGY en 60 s ; écran avec choix Select non traité. Aucun échange réel qualifié. |
| Gemini | Authentification initiale non résolue ; pas de nouveau rejeu. |
| Muse | Schéma corrigé et accepté par le vrai parseur ; la session interactive quitte encore avec code 1 après Trust. Le précontrôle isolé exec quitte aussi avec code 1 sans diagnostic reconnu. Ce résultat ne permet pas d’attribuer le blocage à l’authentification. |
| Vibe | Lanceur Python interdit : 11 cellules impliquant Vibe bloquées. Aucun Python lancé dans cette reprise. |
| Revue formelle | `harness-review` impose « Launch only through the installed h2a MCP server's h2a_run tool ». Route interdite par le propriétaire : aucun lancement, aucun consensus revendiqué. Voir le dossier de revue existant. |
| CI et gates globaux | Résultats détaillés ci-dessous. Aucun gate global local exécuté. L’intégration de l’entrée globale au confinement PID reste ouverte. |

## Muse : configuration et isolation du lanceur

La [documentation primaire Muse](https://meta-models.github.io/muse-code-sdk/next/guides/extend/mcp-servers/) impose `schema_version: 1` à la racine de settings.json. Les snippets h2a l’omettaient. Le vrai `muse config status`, sans login ni modèle, refuse les deux variantes du produit avant correction, puis les accepte après. Le writer conserve les autres réglages et refuse un schéma incompatible, même avec `--force`. Cela qualifie le format, pas la messagerie Muse réelle.

Le lanceur Muse utilise des fichiers adjacents à son installation indépendamment de HOME : même avec les mises à jour coupées, son avis de mise à jour peut être consommé sur un TTY. Le harness copie donc le lanceur, le binaire ELF identifié par version et les seules métadonnées de programme dans son répertoire privé. Les empreintes sont dans les reçus ; aucun fichier mutable d’installation n’est copié ou modifié. La fixture rouge reproduit ce comportement uniquement dans une fausse installation temporaire. Les sondes réelles Muse de cette reprise utilisent la copie privée.

| Régression / commande ciblée | Rouge → vert observé |
|---|---|
| `XCLI_MUSE_BASELINE=1 node --test scripts/xcli-lab.test.mjs`, puis sans variable | 5 pass, 1 fail → 6 pass, 0 fail ; avis de la fausse installation préservé |
| `node --test scripts/xcli-muse-config.test.mjs` | tests 3, pass 0, fail 3 → tests 3, pass 3, fail 0, skipped 0 ; vrai parseur, sans modèle |
| `node scripts/xcli-source-tests.mjs packages/h2a/test/hosts-integration.test.js` | 26 pass, 2 fail, exit 1 → 28 pass, 0 fail, exit 0 ; [rouge](2026-10-16-cross-cli-local/muse-schema-host-red.json), [vert](2026-10-16-cross-cli-local/muse-schema-host-green.json) |
| `node scripts/qualify-cross-cli.mjs --simulated --pair muse:claude --timeout-ms 30000 --output <reçu>` | [simulated-KO](2026-10-16-cross-cli-resume-muse-schema-simulated-red.json) → [simulated-OK](2026-10-16-cross-cli-resume-muse-schema-simulated-green.json), exit 2 → 0 |
| `node scripts/xcli-source-tests.mjs packages/h2a/test/hosts-integration.test.js packages/h2a/test/cli-host-status.test.js packages/h2a/test/evo-host-setup-wake.test.js packages/h2a/test/mcp-central.test.js packages/h2a/test/host-connect.test.js packages/h2a/test/host-plugin.test.js` | tests 71, pass 71, fail 0, skipped 0, exit 0 ; [reçu](2026-10-16-cross-cli-local/muse-host-consumers-green.json) |
| `TMPDIR=/tmp node packages/h2a/test/helpers/identity-isolated-typecheck.mjs` | track, remote-protocol, h2a, h2a-runtime : exit 0 ; lane `/tmp/h2a-idlock-build2-ALZRn7` |
| `TMPDIR=/tmp node --test --test-concurrency=1 scripts/xcli-lab.test.mjs scripts/xcli-proxy.test.mjs scripts/xcli-terminal.test.mjs scripts/xcli-cleanup.test.mjs scripts/xcli-simulation.test.mjs scripts/xcli-startup.test.mjs` | Exécution finale : tests 13, pass 13, fail 0, skipped 0, exit 0 ; [sortie archivée](2026-10-16-cross-cli-local/harness-final.json) |

La sélection de login AGY est désormais classée explicitement `authentication-required` : test rouge 6 pass / 1 fail, puis vert 7 pass / 0 fail. [Rejeu réel](2026-10-16-cross-cli-resume-agy-auth-after.json) : blocked, pas un succès. Seuls des fichiers d’auth déjà autorisés et listés sont copiés, jamais le reste des configurations personnelles. L’emplacement d’un login AGY réutilisable reste à fournir ; aucune recherche générale du HOME.

Pour Codex, les réponses OSC de couleurs n’ont pas changé le KO et ont été retirées. Seul l’observateur des types de requêtes terminal est conservé. Les styles de deux choix fixes Muse sont aussi observés sans conserver le texte libre. Le précontrôle [Muse exec](2026-10-16-cross-cli-muse-auth-preflight.json) est contenu par un traceur `--kill-on-exit` suivant exclusivement ses propres descendants ; les sorties modèle sont jetées et l’état privé supprimé.

## CI : résultats et séparation des jobs

[Run 38900923045](https://github.com/rhanka/h2a/actions/runs/38900923045), commit `680cf7d8` :

| Job | Node 22 | Node 24 |
|---|---|---|
| Matrice simulée | 36/36 simulated-OK | 36/36 simulated-OK |
| Oracles de configuration natifs | 2/2 | étape réussie |
| Consommateurs runtime | 702 pass, 0 fail, 2 pending, 2 todo | 702 pass, 0 fail, 2 pending, 2 todo |
| Consommateurs source | 255 pass, 0 fail, 1 skip keepalive déclaré, 12 todo | interrompus par limite de durée du job |

Le run complet est **cancelled**, pas vert : annotation GitHub « The job has exceeded the maximum execution time of 10m0s ». Les compteurs pending/todo et le placeholder keepalive ne constituent pas de couverture ; aucun test sauté pour absence d’état réel n’est accepté.

Les artefacts [Node 22](2026-10-16-cross-cli-ci/680cf7d8/node22/xcli-simulated.json) et [Node 24](2026-10-16-cross-cli-ci/680cf7d8/node24/xcli-simulated.json) ont été téléchargés avec `gh run download 38900923045 -n xcli-simulated-node-<version> -D <dossier>` puis vérifiés avec `node scripts/xcli-ci-check.mjs <artefact>` : sortie exacte pour chacun `{"cells":36,"outcome":"simulated-round-trips-proven"}`. Les reçus des logs des jobs sont archivés à côté.

Le workflow répartit désormais runtime, source native et source hosts dans des jobs indépendants Node 22/24, tous avec le même budget de dix minutes et les mêmes assertions. Les tests source utilisent uniquement le parent temporaire GitHub déjà autorisé et une namespace PID privée. Le workflow publie aussi les reçus d’exécution ; aucun guard n’est affaibli. Sa validation après push reste requise.

État réel cumulé : **1/36 measured-OK**, Claude → Claude ; **aucune paire inter-CLI réelle qualifiée**. Les 36 cellules simulées vérifient le chemin h2a et les invariants du harness, pas la prise en charge des six produits réels. Reste estimé : **6–12 heures-agent et 2 tours de revue**, sous réserve d’un login AGY réutilisable, de Gemini et d’une entrée Vibe non Python. La revue formelle reste `selection-failed` suivant [SKILL.md](/home/antoinefa/.codex/skills/harness-review/SKILL.md), qui impose « Launch only through the installed h2a MCP server's h2a_run tool » ; le propriétaire interdit cette route.
