# MH-L6 — preuves par sous-lot

La branche ne constitue pas encore le lot MH-L6 complet. Le découpage et les
gates restantes sont dans [BRANCH.md](BRANCH.md). Aucun conducteur MCP vivant,
aucune découverte MCP registry et aucune action native ne sont introduits.

Le checkpoint de délégation/récupération est décrit dans [B1.md](B1.md) et
`proof-B1.json`. Les preuves A ci-dessous restent rattachées à `dd23a00a`.
Le lanceur autonome et ses limites d'intégration sont décrits dans [C1.md](C1.md),
avec `proof-C1.json` et un artefact concret reproductible.
Le lecteur de modules et sa portée exacte sont décrits dans [E1.md](E1.md),
avec `proof-E1.json` ; la couverture de tous les démarreurs reste une gate distincte.

## A — journal et sélection

`UpgradeStore` ajoute le journal canonique sous le préfixe physique, l'exclusion
par le vrai verrou de succession hérité puis flock H4, les pins, l'intention
irréversible de sélection et sa réconciliation vers l'avant. Les changements
de HOME/XDG ne déplacent pas cette autorité. Le manifeste et le protocole du
contrôleur cible sont revérifiés avant publication. Historique, dernière
sélection et journal doivent concorder ; leur contradiction ne justifie aucun
retour à l'ancien build.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-selection.test.js final-A` | 10/10 | 10/10 |
| Même runner, fichiers explicites `mh-l0-state`, `mh-l0-image`, `mh-l0-authority`, `mh-l0-formats` | 15/15 | 15/15 |
| `node scripts/mh-l6-mutate.mjs selection` | 14 rouges par assertion / 14 restaurations vertes | 14 rouges par assertion / 14 restaurations vertes |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Les reçus contiennent la commande absolue, le profil Node, la racine privée,
la sortie TAP et le bilan des seuls PID créés. Les JSON de mutation lient
les sources/émissions aux preuves ; `proof-A.json` vérifie les octets et reçus.
La compilation ciblant les projets TypeScript est dans `evidence/build-A.log`.

Source privée umask 022 : `/tmp/mh-l3-qualification-YeHHOv/source`. Le profil 24
utilise le binaire de qualification officiel existant
`/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin/node`.
Les deux tests supplémentaires dépendant de `git show` ont été réexécutés
depuis ce worktree, avec tous leurs états dans des temporaires. Leurs échecs
initiaux dans la copie sans `.git` sont conservés, jamais comptés verts.

Le rouge initial est de six assertions sur l'absence du moteur. Deux autres
rouges ont établi la publication trop précoce devant un historique discordant
et l'écrasement d'une sauvegarde contradictoire. Un rouge supplémentaire établit
le refus d'une intention encodée correctement mais d'un autre préfixe.
Le premier essai a aussi révélé `t.mock.env` indisponible sous Node 22 ; le test
sauvegarde/restaure maintenant explicitement les variables. Ces diagnostics
restent archivés avec leur code non nul.

| NOT covered par A | Sous-lot / gate |
|---|---|
| Vraies morts de contrôleurs, délégation, reprise depuis un autre PID, gardien perdu | B et F ; A injecte les erreurs fsync/link, sans preuve SIGKILL ni coupure électrique |
| Fermeture future des admissions/relanceurs v1 et activation M18 | B/C/F ; le refus sans provenance de MH-L5 reste inchangé |
| Lanceur autonome, bootstrap, adoption, désadoption, CLI et automatique | C/D/F ; le moteur A n'est pas encore raccordé aux commandes utilisateur |
| Graphe fermé, packaging publié, probe PTY réel, gel natif et npm réel | E ; les petites images des tests A ne sont pas des artefacts release |
| Qualification U07/U11 finale, endurance, M17 convergé, vraie .7 → .8 | MH-L8 / .8, selon les affectations existantes |
| Revue indépendante | Conducteur ; dispatch installé interdit par l'owner, aucun consensus revendiqué |

Le choix d'un contrôleur cible se fait par le manifeste sélectionné et un
protocole versionné ; aucune whitelist de builds futurs n'est ajoutée. L'option A
owner (consommation passive des transferts externes) reste intacte.
