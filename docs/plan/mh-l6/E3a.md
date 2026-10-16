# E3a — natif précompilé par chaîne épinglée

VOL réversible, §8.3 : Zig 0.14.1 officiel, headers Node 22.22.1, node-pty 1.1.0 et node-addon-api 7.1.1 sont épinglés par SHA d’archives. Les deux sources npm concordent aussi avec les SHA-512 déjà verrouillés. La release compile le vrai addon N-API 8 pour Linux x64 glibc ; aucun compilateur, Python, node-gyp ou téléchargement n’est distribué au client. Les consommateurs reçoivent un payload précompilé dont les empreintes sont épinglées séparément de la recette, sans cycle de digest.

Le premier essai Zig, un seul CPU et entrées locales non qualifiées, charge réellement le même addon sous Node 22/24 ; diagnostic de faisabilité uniquement. La qualification suivante exige les seules archives épinglées, deux racines de build, le vrai require node-pty/PTY et les refus avant toute compilation/consommation. Le profil de libc annoncé distingue baseline ciblée et machine effectivement testée. Les licences des bibliothèques statiques seront distribuées.

Dépendances ouvertes : incorporation au tarball h2a .7/shrinkwrap (E3b), autres vraies entrées natives (E2b3), gel comparatif .6 et véritables relancements U07/U11, B2/admission maintenue, bootstrap C2b et F. Aucun verdict release ni clôture M18. Revue indépendante indisponible sous le confinement, aucun consensus prétendu.

## Preuves

| Commande dans la copie privée, MH_L6_NATIVE_ASSETS=/tmp/mh-l6-toolchain-coPPfH | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-native.test.js final-E3a-15 | 15, exit 0 | 15, exit 0 |
| node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-physical.test.js final-E3a | 20, exit 0 | 20, exit 0 |
| node scripts/mh-l6-native-mutate.mjs | 13 rouges ERR_ASSERTION / 13 restaurations vertes, exit 0 | 13 / 13, exit 0 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Le runner donne à chaque fichier HOME/XDG/TMPDIR privés. La nouvelle variable n’accepte qu’une racine temporaire canonique dédiée ; les tests refusent si les ressources sont absentes. Un fichier ciblé, aucune suite globale. Le compilateur tourne sur un seul CPU admis par /proc/self/status. Chaque execFile est attendu jusqu’à sa fermeture ; le PTY est joint par onExit. Le ledger Node n’est pas présenté comme l’inventaire universel des petits-enfants. Aucun host natif h2a ni état opérateur utilisé.

Audit : node scripts/mh-l6-e3a-audit.mjs /tmp/mh-l3-qualification-YeHHOv/source /tmp/mh-l6-toolchain-coPPfH, exit 0 ; dix fichiers identiques, SHA des quatre archives et SHA-512 npm concordants, 35 tests et treize configurations/profil, même ELF/payload entre racines, zéro skip/enfant. Aucun TypeScript applicatif modifié ; builds C++ réellement exécutés, commandes et stdout/stderr sans diagnostic dans les TAP et native-primary-build.json.

| Artefact versionné | SHA-256 |
|---|---|
| scripts/release/artifacts/node-pty-linux-x64-gnu-napi8.tgz, 122479 octets | df515dce2883d24f64ce10663d864ee65918e0840adb42037ad7b3bad9b0c605 |
| ELF pty.node | b6bc6f5c7562d0095da7e7fb6ff05b1a76206b0b796cef75ba66f9a85ea058c8 |
| Inventaire du payload, digest canonique | 3223226a22cdbe4ec144606544978829c1a9e7c1d0b94e4a24c214aa52cea34f |
| Recette, digest canonique | 5dec0d06f275a3a0be2987b5769b800833413db40c2942a6c8f8d6cad7e56387 |

La recette et les URL/SHA exacts sont dans scripts/release/native-toolchain.lock.json. Pour reproduire, télécharger ses quatre archives vers un répertoire privé sous /tmp/mh-l6-toolchain-*, puis appeler buildReleaseNative(nouvelleDestination, { archives }) depuis scripts/build-release-native.mjs. Le builder vérifie les buffers avant extraction et exécution ; il ne compile jamais depuis les prébuilds/scripts amont. verifyReleaseNative refuse tout artifact non enregistré, modifié, hardlinké, sortant ou hors profil ; il ne télécharge ni ne compile. Le tar distribué est effectivement extrait et chargé par les tests, pas seulement une copie de répertoire. Les sources C++, headers, compilateur et scripts d’installation amont sont absents du payload distribué ; le vrai module node-pty conserve son require et son ELF.

Treize configurations sur onze points : archive, inventaire observé (trois oracles ELF/JS/fichier-mode), descripteur, hardlink, suivi des symlinks, architecture, major Node, ABI, niveau N-API, libc et fallback ambiant. Le suivi de liens est une configuration combinée retirant le contrôle de type et O_NOFOLLOW, pas deux lignes prétendument indispensables isolément. Le rouge archive prouve l’exécution effective de la première instruction du compilateur non vérifié ; le rouge fallback recrée effectivement l’ELF manquant. Aucun effet hors fixture privée.

## Diagnostics et limites

Premier rouge : API encore absente, un test historique par profil. Ce smoke a ensuite été remplacé par les quinze tests de comportement ; il ne compte pas quinze régressions produit préexistantes. Les premiers passages comptaient 12 puis 16 tests, avant ajout des profils négatifs et retrait du smoke redondant ; seules les séries final-E3a-15 entrent dans la preuve finale. Après le retrait, les treize paires ont aussi été refaites sous les deux profils.

Première tentative de mutateur Node 22 arrêtée après six paires : garde d’unicité sur le nombre de lstat (cinq, pas quatre). Source restaurée ; diagnostic JSON conservé, aucune fausse assertion comptée. L’ancre corrigée a permis les treize paires complètes. Le premier probe Zig non qualifié avait un flag statique inutile ; la recette finale n’en contient pas et ses commandes n’émettent aucun diagnostic.

L’ELF primaire ne dépend dynamiquement que de libpthread, libc, libdl, ld-linux-x86-64 et libutil ; sorties readelf conservées. Les bibliothèques C++ sont dans le binaire et leurs licences sont distribuées. Baseline ciblée glibc 2.31 ; exécution réelle sur glibc 2.43, Node 22.22.1/24.21.0. Les autres libc/machines restent à qualifier avant toute annonce plus large.

Comparaison indépendante avec le tarball public runtime .6 SHA 44109da8eb65646a2100658480ff474ec389913ed2f083ae2539b235b4a20870 : launch-guard.js est identique, native-host/op/process/supervisor/journal diffèrent. Diagnostic seulement, six entrées et pas toute la fermeture. Cela impose toujours E3c : gel complet ou vraie qualification des relancements U07/U11. Aucune restauration aveugle ni affaiblissement d’une garde.

Ce sous-lot ne modifie pas encore le conditionnement npm h2a actuel : E3b doit distribuer cœur/runtime exacts .7 et le shrinkwrap avec ce prébuild, y compris l’ancien chemin de sonde. C2b/B2/F restent requis pour adoption/fermeture/activation ; aucune sélection H4 qualifiée, aucun M18 complet ni verdict release.
