# C2a — preuve physique de l’installation npm

VOL réversible, dans §8.2/8.6 déjà ratifiés : dériver P de la vraie entrée npm et vérifier package.json, entrée, chaîne de répertoires et lien de commande. L’argument --prefix ou npm prefix seul ne prouve rien. Conserver l’observation du lien original et revalider les inodes, octets et modes avant toute future mutation. Les alias de P sont admis seulement s’ils désignent le même dev/ino ; un lien de code sortant est refusé.

Ce module ne publie aucun état, ne crée pas I, ne sélectionne pas d’image, n’exécute aucun paquet et n’accorde aucune fermeture des admissions héritées. Le contrôle des métadonnées n’authentifie pas à lui seul le payload publié ; E3 reste nécessaire. B2/C2b/F conservent le producteur de preuve, le bootstrap et l’adoption. La sélection reste différée sans fermeture maintenue.

Revue multi-peer indisponible dans le confinement ; aucun dispatch installé ni pair synthétique. Choix d’implémentation réversible décidé dans le périmètre déjà autorisé.

## Résultats

| Commande dans la copie privée | Node 22.22.1 / npm 11.17.0 | Node 24.21.0 / npm 11.19.0 |
|---|---:|---:|
| node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-physical.test.js final-C2a | 20, exit 0 | 20, exit 0 |
| node scripts/mh-l6-test.mjs packages/h2a/test/mh-l0-authority.test.js final-C2a-git-object | 2, exit 0 | 2, exit 0 |
| node scripts/mh-l6-physical-mutate.mjs | 13 rouges ERR_ASSERTION / 13 restaurations vertes, exit 0 | 13 / 13, exit 0 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Premier rouge : nouvelle API absente (un test, exit 1 ERR_ASSERTION par profil), pas vingt régressions préexistantes. Compilation après restauration : node node_modules/typescript/bin/tsc -b packages/h2a --pretty false, exit 0 sans diagnostic. Audit : node scripts/mh-l6-c2a-audit.mjs /tmp/mh-l3-qualification-YeHHOv/source, exit 0, neuf fichiers identiques, émission compilée identifiée, 22 tests et treize configurations/profil, zéro skip/enfant. La vraie installation npm de cette campagne porte un petit paquet fixture ; elle vérifie les métadonnées physiques produites par npm, pas le payload release.

Les treize configurations sont : préfixe appelant, préfixe hérité, métadonnées npm, hardlink, mode fichier, mode répertoire, lien direct, cible du lien, revalidation, inode du lien, stabilité du fichier ouvert, relecture des métadonnées, relecture du préfixe. Préfixes et stabilité de fichier combinent les vérifications redondantes du même invariant ; on ne prétend pas que chaque ligne isolée doit être indispensable.

## Diagnostics exclus

Le premier passage vert Node 22 a révélé une entrée de fixture inadéquate au diagnostic attendu : une copie régulière de commande était aussi fournie comme entrée physique ; le test passe désormais l’entrée npm réelle pour isoler la garde du lien. Aucun contrôle produit retiré. Le second a refusé la double utilisation du même npmrc utilisateur/global ; deux fichiers privés distincts sont désormais fournis. Les logs physiques green/green-2 restent les échecs observés, green-3 et final-C2a les succès.

Première tentative de mutations Node 22 arrêtée après dix paires : la mutation du fichier ouvert seule survivait grâce à la relecture finale. Son log vert et le JSON partiel restent diagnostics. L’inspection a aussi montré que la première mutation du préfixe appelant modifiait le diagnostic mais restait refusée par le contrôle final : elle n’est pas comptée comme preuve d’exclusion. Les deux configurations retirent désormais toutes les vérifications redondantes du même invariant ; les treize paires complètes ont été refaites sous les deux profils, avec restauration par hash.

Référence MH-L0 : premiers essais échoués car la copie source n’avait pas Git et la fixture lit une feuille .6 figée via git show. Un dépôt bare privé et un fetch local --no-tags --depth=1 du seul commit 0b9cf8862be689380c3bcb6e7cb35dc1e10b5cbf résolvent ce prérequis ; aucun checkout ou ref owner modifié. Les deux échecs sont conservés, les replays finaux passent. Aucun échec n’a été transformé en skip.

## Limites

L’observation n’est ni une exclusion de npm non coopérant, ni une attestation de l’éditeur, ni une preuve de graphe fermé. Les répertoires sont liés à dev/ino/UID/mode ; leurs timestamps et nombre de sous-répertoires ne servent pas d’autorité et peuvent changer à la création du verrou/I. Les fichiers et le lien conservent leurs stamps complets et empreintes pertinentes. La revalidation doit précéder la publication sous les verrous applicables. Ce module n’est pas encore appelé par le moteur commun/bootstrap : C2b/F restent obligatoires. Aucun journal passé fabriqué pour un .7 mutable, aucun service arrêté, aucun chemin vivant renommé.
