# Clôture des findings indépendants MH-L2 — 16 octobre 2026

Cette correction part du worktree propre `501ea371763970c5fadcd0425c808cf2fed3d263`,
sur `feat/0.98.7-mh-l3`, et traite uniquement les six findings de `revl2amend.md`.
MH-L3, M21 et l'initiation produit d'une bascule live restent hors périmètre.
Le dossier `OWNER-A-QUALIFICATION.md` conserve les résultats historiques antérieurs.

| Finding | Correction à la cause racine | Oracles de mutation |
|---|---|---|
| 1 — contradiction / fail-open | Observation durable avant `verifyAuthority`, à l'admission et à l'expiration même sans deadline ; aucun droit cible dérivé d'une transaction ABORTED ; fixture câblée comme le central. | `admissions-contradiction`, `expiry-contradiction`, `authority-order`, `aborted-authority` |
| 2 — deadline après publication | La publication concordante authentifiée permet une reprise en avant après expiration ; barrière préalable, autorisation courante, sélection, entrée, precheck, checkpoint, inventaire et drain restent obligatoires. Aucun recul d'horloge dans l'oracle. | `expired-publication` et cas négatifs de reprise |
| 3 — DELETE /mcp | DELETE ne fait pas partie des contrôles admis pendant la barrière. Le test HTTP vérifie BARRIER/FROZEN/PUBLISHED avec des observations d'inventaire distinctes, puis une retraite effective. | `delete-barrier` |
| 4 — ordre d'ownership | TRANSFERRING et ACTIVE cible sont refusés avant PUBLISHED durable. Les reprises après publication conservent les contrôles exacts de génération, epoch et processus. | `ownership-order` et tests G1 acquis existants |
| 5 — contention d'identité | Ed25519 généré hors verrou ; clés concurrentes et writer gate revérifiés sous verrou avant publication. Retry de `mutation_lock_unavailable` dans le budget, puis `identity_timeout`. | `key-generation-lock`, `key-publication-race`, `identity-retry`, `identity-timeout` |
| 6 — fallback temporaire | `H2A_HANDOVER_TEST_TMPDIR || TMPDIR || os.tmpdir()` ; workspace et scratch privés distincts, sans changer la garde produit. | `temp-fallback`, exécution sans TMPDIR ni XDG_CACHE_HOME |

Les journaux `evidence/*l2fix*` et `evidence/l2fix-*` contiennent les commandes,
versions, sorties et codes de retour. Chaque mutant doit produire exactement un
test, `ERR_ASSERTION`, code 1, aucun skip/todo/annulation ; sa restauration doit
produire code 0. Erreur de syntaxe, build, loader ou oracle absent ne tue pas un mutant.

La qualification utilise `/tmp/mh-l2fix-qual-06K2z1/source`, archive Git privée
avec l'overlay exact des corrections, `npm ci --ignore-scripts --no-audit --no-fund`,
build Track et `tsc -b`. Le préfixe privé `packages/h2a` est en mode 755 ; le
worktree original reste inchangé en 775. Chaque fichier de test reçoit ses propres
HOME, répertoires XDG et store temporaires. Les fixtures de titres Claude utilisent
leur homedir temporaire injecté sans `CLAUDE_CONFIG_DIR` prioritaire ; aucun HOME réel
n'est consulté. Le launcher ne lance que les fichiers explicitement énumérés.

Deux précisions sur la revue : au HEAD réellement fourni, le test dépendait de
`XDG_CACHE_HOME` (et non TMPDIR), et le timeout OFD était de 5 s (et non 1,5 s).
Les corrections portent sur les causes racines correspondantes ; aucun timeout
produit n'a été augmenté. Les diagnostics initiaux de préfixe, configuration et
d'attente suspendue sont conservés comme échecs, jamais assimilés à du vert.

La revue indépendante de ces corrections reste au conducteur : les consignes du
propriétaire interdisent l'usage du h2a installé et de son état réel. Aucun consensus
de revue, aucune qualification de Claude réel ou de transition de release .7→.8
n'est revendiqué. Les versions ciblées sont Node 22.22.1 et Node 24.21.0.

| Commande, depuis la copie privée | Node 22.22.1 | Node 24.21.0 |
|---|---|---|
| `node scripts/mh-l2-amendment-regressions.mjs` | 33 fichiers, 288 tests, 0 échec | 33 fichiers, 288 tests, 0 échec |
| Dont tous les fichiers MH-L2/MH-L4 | 20 fichiers, 114 tests | 20 fichiers, 114 tests |
| Dont `mcp-central-attachments.test.js` | 33/33 | 33/33 |
| `node scripts/mh-l2-amendment-proof.mjs mutate` | 12/12 mutants tués, restaurations vertes | 12/12 mutants tués, restaurations vertes |
| `node scripts/mh-l2-live-mutate.mjs [cas]` | 63/63 paires en deux segments, 49 + 14 | 63/63 paires, campagne complète code 0 |

Chaque ligne verte correspond à des sorties conservées, sans skip, todo ou
annulation. Le premier passage Node 22 des références a échoué sur trois fichiers
à cause du préfixe 775 et du config root Claude prioritaire ; seuls ces fichiers
ont été rejoués après correction de leur environnement. L'oracle operator-stop
a ensuite été renforcé avec `assert.doesNotThrow`, puis son fichier complet a
été rejoué à 65/65 sur Node 22 avant la campagne complète Node 24. Aucune assertion
n'a été supprimée ou élargie pour ces diagnostics.
La première campagne d'anciennes mutations Node 22 est conservée avec son code 1 :
l'oracle operator-stop produisait une exception hors assertion. Après renforcement,
les 14 cas restants passent ; l'audit vérifie chaque paire individuellement sur
les deux profils, soit 150 mutants rejetés par assertion et 150 restaurations vertes.

Les index `l2fix-node22-qualification.json`, `l2fix-node24-qualification.json`
et `l2fix-proof-audit.json` donnent les fichiers, commandes, résultats et empreintes
des octets qualifiés. La suite globale, les anciennes mutations froides/MH-L4,
le vrai état propriétaire et MH-L3/M21 ne sont pas qualifiés dans cette exécution.
