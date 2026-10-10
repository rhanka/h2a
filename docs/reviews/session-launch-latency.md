# Latence de lancement des sessions — qualification synthétique

Date : 2026-10-04. Branche : `perf/session-launch-latency`.
Référence avant : `ab7ff40e` (0.98.1). Résultats après : index construits
explicitement, lectures ciblées et readiness native corrélée.
Les valeurs détaillées sont dans [session-launch-latency-evidence.json](session-launch-latency-evidence.json).

Sur le grand corpus, le maximum de `identity_ready` à N=17 passe de
4 372 ms à 1 135 ms ; le lancement complet passe de 11 517 ms à
10 651 ms. À N=1, le lancement complet passe de 8 744 ms à 7 063 ms.
La cible de moins de 20 s est atteinte dans ce laboratoire. Le runtime
conserve plusieurs secondes de vérification du prompt et d'opérations natives.
Les 40 s et les 380 Mo RSS signalés par le propriétaire ne sont pas reproduits
dans leurs conditions exactes ; ces mesures ne garantissent pas la latence
sous la charge I/O réelle des autres travaux.

## Corpus, isolation et définition des mesures

Toutes les données ont été générées à partir des formes de records du code.
Aucun contenu des magasins, credentials, registres ou sessions du propriétaire
n'a été lu ou copié. Son host natif n'a pas été utilisé. Les expériences ont
leurs propres roots, HOME, configuration, XDG_RUNTIME_DIR et host natif.

| Corpus initial | Instances | Bindings | Alias | Fichiers de clés | Présences |
| --- | ---: | ---: | ---: | ---: | ---: |
| Petit | 100 | 100 | 100 | 200 | 10 |
| Grand | 29 497 | 28 855 | 29 560 | 59 128 | 307 |

Le grand corpus commence à 19 375 696 octets pour `instances.jsonl`,
8 172 600 pour `bindings.jsonl` et 3 879 700 pour `aliases.jsonl`.
Les clés Ed25519 synthétiques historiques sont valides, mais partagées entre
identités inertes ; les connexions testées créent leurs propres clés réelles.
Le journal des rotations `registry/keys.jsonl` commence vide ; ses mécanismes
d'ajout/révocation sont vérifiés séparément par les tests.

Les roots sont réutilisés séquentiellement, avec leurs nouveaux événements
d'audit conservés. En fin de campagne : petit 131/131/131 records et 262
fichiers de clés ; grand 29 941/29 299/30 004 records et 60 016 fichiers de
clés. Le grand corpus reste à moins de 1,6 % de la volumétrie initiale.
Les premières matrices contenaient aussi quelques présences résiduelles des
expériences précédentes. Le driver final les retire après arrêt de la cohorte
précédente et rafraîchit exactement les 307 présences synthétiques de départ.
Les traces de phases finales lisent 309 présences, dont celles de la connexion.

Une expérience à la fois, enfants et host propres arrêtés avant la suivante.
Les workers de vérification de version détachés sont également attendus.
Le scope systemd a `memory.max = 8 589 934 592` octets ; le driver arrête
uniquement ses handles à 85 % du budget. Aucun processus extérieur n'est signalé.
N=17 runtime avant a d'abord été refusé par une projection conservatrice de
8 588 Mio. Il a ensuite été admis avec une projection fondée sur le runtime
N=17 déjà mesuré après et le surcoût MCP historique mesuré : 5 898 Mio,
inférieurs au seuil de 6 963 Mio. Le seuil n'a pas été relevé.

« Froid » signifie `posix_fadvise(POSIX_FADV_DONTNEED)` sur les fichiers
synthétiques JSONL et leurs index dans les matrices. Aucun cache global n'est
vidé ; aucune opération privilégiée. Code, metadata des répertoires et présence
ne sont pas intégralement froids. Les profils supplémentaires de phases
conseillent seulement les quatre journaux hors cache, pas leurs index.
« Chaud » est la répétition immédiatement suivante sur le même root.

Les matrices ne prennent pas de profils CPU. Chaque case contient une cohorte,
et donne le maximum observé, pas un percentile statistique. `initialize` et
`identity_ready` sont observés par JSON-RPC ; le polling d'identité est de 20 ms.
Le runtime exécute le vrai adaptateur MCP `h2a_run`, le CLI `run claude`,
ownership, PTY et sidecar. Un provider local synthétique affiche un composer
valide, reçoit le prompt et produit une activité CPU vérifiable ; aucune
inférence ni requête de gateway. Le central est désactivé dans cette seule
configuration privée. Le host privé est démarré dans la mesure ; l'adoption
d'un host préexistant et la disponibilité d'un vrai provider restent hors mesure.
Le résultat « utilisable » exige le prompt accepté et le sidecar réellement
`identity_ready` : un observateur ACK externe ajoute ce contrôle à la version
avant, dont le reçu seul ne prouvait pas la readiness.

## Latences avant / après

Toutes les durées suivantes sont en ms, arrondies à l'entier. Les colonnes
`initialize` et identité portent sur le démarrage MCP autonome ; la colonne
runtime porte sur une expérience distincte de lancement complet.

| Corpus / N / cache | Initialize avant | Après | Identité avant | Après | Runtime avant | Après |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Petit / 1 / froid | 886 | 245 | 1 196 | 537 | 8 890 | 7 016 |
| Petit / 1 / chaud | 245 | 229 | 513 | 519 | 8 502 | 6 899 |
| Grand / 1 / froid | 264 | 242 | 799 | 502 | 8 744 | 7 063 |
| Grand / 1 / chaud | 243 | 228 | 687 | 480 | 8 695 | 6 986 |
| Grand / 4 / froid | 306 | 274 | 1 780 | 601 | 8 458 | 7 073 |
| Grand / 4 / chaud | 315 | 269 | 1 248 | 576 | 8 670 | 6 991 |
| Grand / 17 / froid | 545 | 543 | 4 372 | 1 086 | 11 517 | 10 371 |
| Grand / 17 / chaud | 542 | 469 | 2 808 | 1 135 | 11 056 | 10 651 |

Le premier petit démarrage avant est un outlier de chargement : son
`initialize` coûte davantage que celui du grand corpus. Le petit corpus chaud
reste comparable avant/après ; il ne bénéficie pas d'une accélération
systématique de l'identité. À N=17, le handshake reste découplé de la résolution.

## Mémoire et contention

RSS en Mio (1 048 576 octets), maximum du serveur mesuré à readiness ; worker
d'identité au pic échantillonné. Le scope comprend également les drivers et
le cache imputé au cgroup. Les pics sont échantillonnés toutes les 20 ms.

| Corpus / N / cache | RSS serveur avant → après | Pic worker identité avant → après | Pic scope MCP avant → après | Pic scope runtime avant → après |
| --- | ---: | ---: | ---: | ---: |
| Petit / 1 / froid | 109,5 → 109,0 | 108,3 → 108,3 | 619,8 → 642,7 | 744,0 → 816,7 |
| Petit / 1 / chaud | 109,9 → 110,1 | 107,0 → 108,8 | 628,3 → 633,4 | 744,3 → 748,2 |
| Grand / 1 / froid | 113,3 → 113,4 | 214,0 → 109,7 | 743,5 → 601,1 | 820,8 → 750,7 |
| Grand / 1 / chaud | 113,3 → 113,5 | 214,9 → 108,3 | 748,7 → 598,8 | 808,6 → 763,2 |
| Grand / 4 / froid | 114,4 → 112,7 | 221,1 → 109,6 | 1 265,0 → 960,0 | 1 691,8 → 1 606,3 |
| Grand / 4 / chaud | 113,9 → 113,7 | 223,3 → 109,0 | 1 261,3 → 1 003,2 | 1 888,7 → 1 607,0 |
| Grand / 17 / froid | 117,6 → 114,1 | 214,4 → 111,5 | 3 112,3 → 2 493,7 | 5 428,2 → 5 017,6 |
| Grand / 17 / chaud | 117,8 → 114,4 | 216,7 → 109,9 | 3 214,4 → 2 501,8 | 5 423,2 → 5 171,2 |

Le coût mémoire de l'historique est reproduit dans le worker d'identité,
environ +107 Mio par rapport au petit corpus avant ; il disparaît à cette
échelle après indexation. Il n'est pas reproduit à 380 Mo dans le serveur
persistant lui-même. Une attente de cinq secondes donne 130,0 Mio avant et
121,3 Mio après sur le grand corpus. Après un appel explicite à
`h2a_discover_instances`, le serveur atteint 218,5 Mio avant et 218,6 Mio après,
contre environ 110 Mio sur le petit corpus. La découverte reste une lecture
exhaustive, même avec une réponse paginée : coût distinct, non corrigé ici.

La somme des RSS de tout l'arbre runtime atteint 11 324 Mio après à N=17
froid ; elle compte plusieurs fois les pages partagées. Elle ne remplace pas
le compteur de pression mémoire du scope, mesuré à 5 018 Mio pour cette case.
Le maximum final du scope runtime est 5 171 Mio, soit 5,05 Gio, sans OOM du lab.

| Grand corpus | Hold registre avant → après | Attente registre maximale avant → après |
| --- | ---: | ---: |
| N=1 froid | 124 → 2 ms | 0 → 1 ms |
| N=1 chaud | 80 → 3 ms | 0 → 0 ms |
| N=4 froid | 116 → 3 ms | 251 → 1 ms |
| N=4 chaud | 83 → 3 ms | 201 → 51 ms |
| N=17 froid | 640 → 6 ms | 252 → 101 ms |
| N=17 chaud | 122 → 5 ms | 253 → 152 ms |

## Phases MCP et chemins chauds

Profils supplémentaires N=1, `--cpu-prof` et timers explicites. Les spans
sont parfois imbriqués ; leurs lignes ne doivent pas être additionnées.
Les timers de bindings/alias de la référence sont des wrappers de mesure
autour de ses fonctions originales, reproductibles avec `--phase-spans`.
Chargement et jalons utilisent l'horloge monotone du processus serveur.

| Phase (ms, avant → après) | Petit froid | Petit chaud | Grand froid | Grand chaud |
| --- | ---: | ---: | ---: | ---: |
| Chargement initial jusqu'à `process_start` | 225,91 → 307,81 | 228,19 → 224,66 | 230,61 → 221,12 | 251,42 → 221,00 |
| Provider / conversation | 0,52 → 0,52 | 0,62 → 0,50 | 0,55 → 0,52 | 0,53 → 0,52 |
| Recherches bindings cumulées | 1,55 → 1,72 | 0,80 → 1,67 | 74,47 → 5,09 | 69,07 → 2,89 |
| Recherches alias cumulées | 0,48 → 4,79 | 0,47 → 2,00 | 34,03 → 1,63 | 26,39 → 1,55 |
| Préparation / chargement de clés | 1,32 → 1,76 | 1,75 → 1,78 | 1,37 → 1,37 | 1,39 → 1,82 |
| Lecture registre / recherche indexée | 0,90 → 0,63 | 0,52 → 7,74 | 109,91 → 0,67 | 77,83 → 0,75 |
| Enregistrement identité, dont lock | 2,37 → 5,39 | 2,66 → 11,81 | 112,71 → 3,96 | 80,65 → 4,84 |
| Publication alias | 0,20 → 4,90 | 0,28 → 3,03 | 11,06 → 4,01 | 11,31 → 3,76 |
| Lecture fichiers présence, temps I/O seulement | 0,11 → 0,14 | 0,19 → 0,14 | 1,90 → 1,81 | 1,95 → 1,77 |
| `session_open`, jalon cumulatif | 507,68 → 631,82 | 547,91 → 520,98 | 737,05 → 519,43 | 718,50 → 525,64 |
| Activation restante après ce jalon | 0,82 → 1,14 | 1,70 → 0,95 | 7,66 → 7,34 | 7,73 → 7,17 |
| Upgrade : résolution npm, worker détaché | 110,73 → 126,17 | 120,60 → 113,29 | 109,55 → 103,85 | 119,62 → 106,85 |

`session_open` est émis après `openSession`; c'est un jalon de fin, pas un
span de durée de la méthode. Les syscalls de présence excluent leur parsing
et les décisions de sweep ; leur coût complet est compris dans l'activation.
La table expose ces limites de précision au lieu d'attribuer tout le résidu
à une seule fonction. L'acquisition asynchrone comprend aussi un second
chargement de modules Node dans le worker, environ 220–260 ms à N=1.

Le backend par défaut des matrices est local : aucun bind réseau mesh.
Avec la vraie initialisation cluster-mesh et une factory locale hors réseau :

| Corpus chaud, N=1 | Bind messaging avant → après | Identity_ready avant → après | RSS serveur avant → après |
| --- | ---: | ---: | ---: |
| Petit | 14,89 → 17,60 ms | 552 → 504 ms | 110,8 → 109,9 Mio |
| Grand | 95,50 → 13,11 ms | 795 → 522 ms | 171,6 → 122,8 Mio |

La factory et les contrôles Ed25519 sont réellement exécutés ; aucun endpoint
externe n'est consulté. Une factory de déploiement qui attend du réseau peut
encore retarder `identity_ready` (`stdio.ts:649`), mais pas le handshake.
Un reclaim avec preuve réelle sur une conversation précédemment créée passe
de 816 ms à 502 ms sur le grand corpus.

Les principaux chemins chauds prouvés sont :

| Chemin source | Preuve avant | Résultat après |
| --- | --- | --- |
| `packages/h2a/src/runtime/local-files/store.ts:310`, `:476`, `:505`, `:514` | `findInstance` charge/parcourt toutes les inscriptions sous le lock de registre ; CPU propre `readJsonl` 41,11 ms dans le profil chaud ; lecture registre 77,83 ms | Un shard + offsets, première inscription conservée ; registre 0,75 ms |
| `packages/h2a/src/runtime/identity/bindings.ts:72`, `:99` | Trois lectures d'environ 8,2 Mo ; CPU propre `listBindings` 40,90 ms cumulé | Dernier binding par `(host, conversation)` ; 2,89 ms cumulés |
| `packages/h2a/src/runtime/identity/migration.ts:103`, `:123`, `:132`, `:139` | Deux lectures d'environ 3,9 Mo ; CPU propre parse/listing 19,09 ms | Lookup par instance, paire, adoption et propriétaire hérité ; 1,55 ms |
| `packages/h2a/src/runtime/local-files/store.ts:1680` | Résolution de boîte héritée relit tous les alias, notamment dans le chemin de messagerie | Propriétaire le plus ancien indexé ; égalités gardent l'ordre du journal ; aucune lecture intégrale dans le test indexé |
| `packages/h2a-runtime/src/native-host.ts:630`, `:692`, `:704` | Fenêtre fixe de 2 s avec probes `op.js` répétées | ACK post-identité, polling du fichier et contrôles d'incarnation |
| `packages/h2a/src/runtime/identity/live.ts:142`, `:422` | Chemins PEM directs, coût d'environ 1–2 ms ; aucun `readdir` des 59 128 clés dans les traces | Accès directs conservés |
| `packages/h2a/src/runtime/local-files/presence.ts:136` | Scan d'environ 307 présences : quelques ms | Scan conservé ; ne parcourt pas les clés |

Avant, l'identité lit/parcourt environ 52,3 Mo de journaux à N=1 chaud
(24,8 Mo bindings + 7,9 Mo alias + 19,6 Mo inscriptions). Après, aucune
lecture `readFileSync` des journaux historiques dans les profils de lancement :
environ 464 Ko d'index lus, plus quelques records par offsets et le suffixe
non encore indexé. Le profil après ne présente plus ces parseurs historiques
parmi les chemins dominants ; le chargement des modules reste visible.

L'auto-upgrade de 0.98.1 était déjà détaché et mis en cache :
`packages/h2a/src/cli.ts:2006`, `:2054`. Le worker résout encore
`npm prefix -g` avant de vérifier le cache (`runtime/upgrade/index.ts:1037`,
`:1075`). Ce coût est mesuré hors du chemin critique, et n'a pas été modifié.
Le cache synthétique est rafraîchi avant chaque expérience pour prévenir tout
download/install. Un cache expiré et la réparation d'installation ne sont pas
qualifiés ; ils peuvent ajouter de la concurrence CPU/I/O en arrière-plan.

## Phases runtime

Grand corpus chaud N=1. Temps d'opérations synchrones cumulés dans les
processus de lancement ; plusieurs opérations participent à la même phase.

| Opération | Appels avant → après | Temps avant → après (ms) |
| --- | ---: | ---: |
| Démarrage du host privé | 1 → 1 | 103,49 → 105,87 |
| Ensure/adoption du host | 3 → 3 | 391,40 → 341,57 |
| Admission / ownership | 3 → 3 | 391,65 → 334,97 |
| Création agent + sidecar | 2 → 2 | 273,31 → 231,18 |
| Probes d'état natives | 19 → 14 | 2 264,13 → 1 619,37 |
| Capture composer | 3 → 3 | 354,37 → 372,02 |
| Write / paste / Enter | 3 → 3 | 338,86 → 373,56 |
| Attente/vérification totale du prompt (inclut certaines opérations ci-dessus) | 1 → 1 | 4 011 → 4 054 |
| Lancement complet | 1 → 1 | 8 695 → 6 986 |

À N=17 froid, probes : 271 appels / 72 393 ms cumulés avant,
255 / 54 384 ms après. Les cumuls des 17 processus ne sont pas une latence
murale. Une première variante de readiness lançait `op.js` toutes les 50 ms :
330 probes, 204 821 ms cumulés et lancement maximal de 19,49 s. Cette variante
a été rejetée. Le code final poll l'ACK directement toutes les 50 ms,
vérifie l'owner une fois par seconde et revalide parent/sidecar au succès.

L'ACK utilise une nonce et un fichier 0600 dans un répertoire privé, puis
vérifie la génération/incarnation et le PID. Sur Linux, le MCP est un descendant
du guardian PTY : la chaîne parentale ciblée et le groupe de processus doivent
correspondre. Les processus étrangers, zombies, PID illisibles et incarnations
remplacées ne prouvent pas la readiness. Le comportement tmux de PID exact
reste celui par défaut de `probeStructuredReadiness` (`tmux.ts:1954`).

## Index, audit et maintenance

`packages/h2a/src/runtime/local-files/launch-index.ts:117`, `:181`, `:245`
implémente des index dérivés par offsets, répartis en 256 shards SHA-256.
Les buckets sont immuables, leurs hashes sont vérifiés, le manifeste courant
est publié par rename atomique et les générations précédentes sont conservées.
Un reader peut garder son ancien manifeste et rejouer tout le suffixe complet
observé ; une publication concurrente ne provoque pas un scan historique par
épuisement de retries. Les doublons historiques de bindings gardent seulement
le dernier offset ; les registrations gardent le premier. Les clés révoquées
et les alias pertinents conservent leurs événements et l'ordre du journal.

Le journal original est appendé avant l'actualisation de l'index. Une panne
de cette actualisation ne supprime ni le record ni sa visibilité : replay du
suffixe. Le lock d'index incrémental est non bloquant et ne récupère pas un
lock de maintenance actif. Le chemin d'append ne lance jamais un build complet ;
son suffixe est plafonné à 1 Mio. Le scan initial est une maintenance explicite,
hors des locks de registre et d'identité. Les petits updates de shards et du
manifeste restent dans les sections existantes ; leurs durées sont dans la
table des locks, sans promesse de zéro I/O dans ces sections.

L'index absent, invalide, corrompu, tronqué, remplacé ou confronté à une ligne
partielle déclenche le lecteur original. Les politiques existantes de parsing
des records sont conservées, notamment le refus d'un record JSON primitif.
Une ancienne génération dépourvue de couverture d'ownership ne peut pas
prétendre qu'un propriétaire est absent : fallback, puis rebuild explicite.

Le bénéfice sur un ancien magasin nécessite cette commande, livrée et testée :

```sh
h2a store index-launch --root /chemin/absolu/du/magasin
```

Un root absolu, explicite et existant est obligatoire (`cli.ts:4974`).
La commande est idempotente sur des logs inchangés. Elle ne réécrit, tronque
ni renomme aucun original : ceux-ci sont intégralement conservés comme source
de référence, et non remplacés par une compactification. Aucune migration
destructive n'a lieu et aucun backup externe n'est requis pour restaurer leurs
octets. Les anciennes générations dérivées sont aussi conservées.
Retour arrière : après arrêt des readers de maintenance concernés, retirer
ou déplacer uniquement les répertoires `*.jsonl.launch-index-v1` ; les lecteurs
reviennent aux logs originaux. Ne pas retirer les JSONL ni `keys/`.
La commande n'a été exécutée que sur les roots synthétiques, jamais chez le
propriétaire.

Des anciens writers restent compatibles par replay du suffixe. Un suffixe
important nécessite une nouvelle exécution de la commande pour retrouver le
coût réduit. Les shards ont une taille liée au nombre de clés distinctes :
le correctif supprime les scans complets, mais ne promet pas un coût constant
pour une histoire arbitrairement grande ou un agent ayant énormément d'alias.
Les générations conservées font croître l'espace disque ; leur collecte est
différée pour garder la réversibilité et les readers en vol.

L'hypothèse reste celle des journaux append-only existants. Un edit manuel
du préfixe dans le même inode suivi d'une croissance peut échapper aux checks
dev/ino/size/mtime/ctime ; toute opération qui réécrit les originaux doit donc
retirer les index dérivés puis les reconstruire. Une modification de même
taille, un remplacement atomique et une troncature observée sont testés.

## Vérifications et invariants

Build TypeScript réussi, contrat public validé : 60 outils MCP, 100 verbes CLI,
anti-cycle du core intact. Nouveau verbe CLI uniquement.
Aucun push, PR, publication ou tag.

| Vérification ciblée | Résultat |
| --- | --- |
| Lot initial indexé : index, bindings, migration, live wiring, burst 17, contention, readiness, readonly, activation mesh, messaging, trace, contrats et goldens | 181 succès, 17 skips de contrats intentionnels, 0 échec |
| Revalidation après l'index du propriétaire hérité : index, bindings, migration, live wiring, messaging et activation mesh | 65 succès, 0 skip, 0 échec |
| Index final, avec message réel de boîte héritée et pop | 17 succès, 0 skip, 0 échec |
| Burst/ contention indexés finaux, N=17 | 5 succès, 0 skip, 0 échec |
| Burst/ contention sans index + readonly, corpus préparé, N=17 | 7 succès, 1 skip de permission prévu, 0 échec |
| Vitest natif : ACK/incarnation/PID et launch ownership, un worker | 18 succès |
| `scripts/check-public-contract.sh` | Réussi |
| `git diff --check` | Réussi |

Les invariants vérifiés comprennent identités distinctes pour conversations
distinctes, exactement un binding pour une conversation en burst, cinq writers
CLI synchrones réellement exécutés avec le writer MCP, publication des clés
avant le binding, preuve de possession au reclaim, verrous vivants respectés,
handshake sous contention, refus readonly, readiness seulement après activation,
révocation de clés, premier registration/dernier binding, isolation de boîte
héritée et déduplication. Le test de 4 000 bindings de la même conversation
ne lit que la dernière ligne, au maximum 4 096 octets.

Un contrôle sans index sur un root neuf a initialement échoué 1/5 : un writer
CLI a lu `.h2a-schema.json` pendant sa création non atomique. Le code concerné
est `store.ts:332`. Le helper prépare désormais la sentinelle d'un magasin
existant avant la cohorte, comme le seed de qualification ; les assertions
du burst et les témoins de sortie 0 n'ont pas été affaiblis. Le défaut de
publication de sentinelle d'un root vierge reste à traiter séparément.
Le cas root absent conserve sa vérification propre dans les tests readonly.

Aucune suite globale n'a été lancée : qualification ciblée et séquentielle,
avec N borné à 17. Revue manuelle des diffs effectuée ; aucun consensus externe
n'est revendiqué. Les règles du lot interdisent l'usage des sessions/hosts
vivants et l'accès aux credentials nécessaires à cette autre procédure.

## Défaut central MCP enregistré, hors lot

Fait fourni par le propriétaire : un central a été lancé avec `--root`
sur `/home/antoinefa/src/sentropic/tmp/llm-gateway-native-relay`, puis une session
d'un autre workspace s'y est connectée. Aucun état de ce central n'a été lu.
Le chemin de code explique le risque : `packages/h2a-runtime/src/index.ts:6421`
passe `root: cwd` à `prepareCentralMcpForLaunch`; `central-mcp.ts:174` démarre
le central avec ce root. Lors de sa réutilisation, `central-mcp.ts:151` et
`:158` vérifient endpoint/génération, sans comparer le root demandé au root
du central déjà actif. Le root du premier workspace peut donc être réutilisé
par le suivant. Défaut de sélection de root enregistré, sans correctif ici :
la SPEC dédiée est en cours.

## Reproduction et artefacts

Sources du laboratoire : `scripts/launch-perf-corpus.mjs`,
`launch-perf-baseline.mjs`, `launch-perf-probe.mjs`, `launch-perf-runtime.mjs`,
`launch-perf-preload.cjs`, `launch-perf-safety.mjs`, `launch-perf-matrix.mjs`,
`launch-perf-provider.mjs`, `launch-perf-mesh.mjs`, `launch-perf-evict.c`
et `launch-perf-report.mjs`. Les scripts sont des drivers opt-in, pas du code
de démarrage de production. Les sorties brutes et profils CPU restent sous
`tmp/launch-lab/`, ignoré par git ; l'agrégat est versionné avec ce rapport.

La reproduction se fait dans un scope mémoire ≤8 Gio, avec un environnement
vide puis PATH, HOME et XDG_RUNTIME_DIR privés explicitement fournis :
générer `small-v2` et `large-v2`, compiler le projet, construire la référence
avec `launch-perf-baseline.mjs ab7ff40e --phase-spans`, compiler l'éviction
sélective en `tmp/launch-lab/evict-v2`, mesurer la matrice avant, construire les
index via le verbe explicite puis mesurer après. Pour compléter un N=17 avant
initialement refusé par projection, reprendre la matrice runtime avant avec
`--resume --paired-memory-admission`, uniquement après une matrice N=17 après
réussie. Cette option réutilise le budget observé, sans augmenter le seuil.
Chaque output doit être neuf sauf ceux repris avec `--resume`.
Pour les profils, utiliser `--cpu-prof`; pour le mesh hors réseau, `--mesh`;
pour la mémoire après découverte, `--discover`; pour un serveur au repos,
`--hold-ms=5000`. N=17 exige toujours l'admission mémoire et le nettoyage de
la cohorte précédente. Aucune mesure réelle du root propriétaire ne fait
partie de cette procédure.
