# Vérifications exécutées — 2026-10-11

Commandes exécutées depuis le worktree `poc-mwt`, préfixées `rtk`.
Le sandbox du shell échoue à créer son namespace (`bwrap: No permissions to
create a new namespace`) ; les commandes ont utilisé `require_escalated`,
avec accès limité aux sources, à Git et aux temporaires créés. Aucun hôte réel,
binaire h2a installé, dist installé ou processus tiers n'a été utilisé.

| Commande | Dernière sortie observée | Code |
|---|---|---|
| `rtk node --import tsx --test poc/multi-workspace-terminal/model.test.ts` | `tests 6 / pass 6 / fail 0 / skipped 0` | 0 |
| `rtk node --import tsx --test poc/multi-workspace-terminal/screen.test.ts` | `tests 2 / pass 2 / fail 0 / skipped 0` | 0 |
| `rtk node --import tsx --test poc/multi-workspace-terminal/integration.test.ts` | `tests 1 / pass 1 / fail 0 / skipped 0` ; 8023 ms | 0 |
| `rtk node node_modules/typescript/bin/tsc -p poc/multi-workspace-terminal/tsconfig.json` | stdout/stderr vides, sortie 0 | 0 |
| `rtk node --import tsx poc/multi-workspace-terminal/demo.ts --record poc/multi-workspace-terminal/artifacts` | `PASS isolated demo: 11 native UI captures; 3 initial sessions / 2 workspaces; switching, input, same PID reuse, create, concurrent reuse, exited restart, detach and cold UI run.` | 0 |

La démo finale prouve aussi par assertion le même PID du PTY client après
`run`, l'absence de `focus.sock` et du verrou après détachement, et le maintien
des sessions natives avant le teardown. Les captures utilisent le véritable
`op.ts capture` avec un socket temporaire explicitement imposé. Un `probe`
natif de la session sortie renvoie `dead`. Les premiers tests avant
implémentation ont échoué avec `ERR_MODULE_NOT_FOUND`, sans skip.

## Régressions : rouge avant / vert après

Les noms de fichiers ci-dessous désignent les commandes complètes de la table précédente.

| Régression | Sortie rouge, code 1 | Même preuve après correction |
|---|---|---|
| TMPDIR du client change le parent de son descripteur | integration.test.ts : `client exited before readiness: Error: sandbox descriptor must be directly inside an isolated h2a-mwt temporary directory` | Après préservation explicite du parent temporaire, l'interface démarre et atteint les captures 01–08 ; le test révèle ensuite le défaut de bail ci-dessous |
| Bail automatiquement révoqué à la sortie du PTY | integration.test.ts : `NativeTerminalRemoteError: stale terminal controller lease` ; captures 01–08 conservées dans le temporaire de diagnostic | integration.test.ts : `tests 1 / pass 1 / fail 0 / skipped 0`, code 0 ; aucune libération d'un bail déjà révoqué |
| UTF-8 découpé entre événements stdin | model.test.ts : `'�����' !== 'é中'` | model.test.ts : `tests 5 / pass 5 / fail 0 / skipped 0`, puis 6/6 après ajout du test de cleanup ; `StringDecoder` branché à stdin |
| Socket de focus symbolique accepté | model.test.ts : `Missing expected rejection.` | Même fichier : 5/5 puis 6/6, code 0 ; `lstat` refuse les liens/fichiers/endpoints non privés avant connexion |
| Modes clavier/collage non restaurés au focus | screen.test.ts : `false !== true` sur `applicationCursorKeysMode`, `tests 2 / pass 1 / fail 1` | screen.test.ts : `tests 2 / pass 2 / fail 0 / skipped 0`, code 0 |

Autres échecs de développement : le premier contrôle TS signalait le type
`Omit` d'une union et une configuration différente du runtime ; configuration
alignée sur `exactOptionalPropertyTypes`, union des demandes corrigée, puis
types du bail corrigés. Le premier test de rendu attendait des lignes sans
espaces de remplissage ; les assertions normalisent uniquement ces espaces
visuellement équivalents avant de vérifier cellules, couleur et curseur.
Le risque supposé de cleanup après échec de spawn n'a pas été reproduit :
le test ciblé passe, grâce à `exitCode` déjà renseigné par Node. Aucun correctif
spéculatif n'a été ajouté pour ce point.

Non couvert : suite complète (réservée au conducteur), providers réels,
crashes et reconnexion, troncature effective du journal, redimensionnements
historiques, requêtes VT hors focus, souris, scrollback, montée en charge,
deux premiers `run` simultanés, affichage complet de nombreux onglets.

Le premier `rtk git diff --cached --check` a renvoyé 2 : les captures natives
contenaient les espaces de remplissage du terminal. La génération retire
uniquement ces espaces/lignes vierges finales des fichiers versionnés.
Après régénération : même `rtk git diff --cached --check`, sortie vide, code 0.
