# Reprise cross-CLI — 16 octobre 2026

La [table initiale](2026-10-15-cross-cli-phase1.md) reste inchangée : 0 measured-OK, 5 measured-KO, 31 blocked. Elle a été poussée avant les corrections. Les résultats suivants sont des rejeux ciblés de phase 2.

| Cellule réelle | MCP | Envoi/livraison | Réception live/réponse | Résultat |
|---|---|---|---|---|
| Claude → Claude | Oui, deux identités | Oui, enveloppe signée corrélée | Oui, sans entrée harness après barrière ; réponse signée livrée | **measured-OK** |
| Codex → Codex | Non avant échéance | Non mesuré | Non mesuré | measured-KO |
| AGY → Claude | Oui | Aucun envoi observé | Non mesuré | measured-KO |
| 33 autres cellules | Pas rejouées ici | Pas qualifié par ces cellules | Pas qualifié | Relevé initial uniquement |

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
| Gemini, Muse | Blocages initiaux ouverts jusqu’à nouvelle mesure. |
| Vibe | Lanceur Python interdit : 11 cellules impliquant Vibe bloquées. Aucun Python lancé dans cette reprise. |
| Revue formelle | `harness-review` impose « Launch only through the installed h2a MCP server's h2a_run tool ». Route interdite par le propriétaire : aucun lancement, aucun consensus revendiqué. Voir le dossier de revue existant. |
| CI et gates globaux | Workflow ciblé étendu aux consommateurs de op.ts ; qualification du nouveau commit requise. Aucun gate global local exécuté. L’intégration de l’entrée globale au confinement PID reste ouverte. |
