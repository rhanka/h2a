# E3b2a — diagnostics npm et garde de distribution

Le conditionneur ne restreint plus l'installation npm du paquet racine à Linux/x64. La préparation d'une image H4 conserve ses refus de plateforme, architecture, ABI et lecteur non qualifiés ; elle refuse désormais explicitement une glibc inférieure à 2.31 avant de créer le répertoire image. Les manifestes de plugins copiés dans les deux vrais paquets suivent leur version de release. L'oracle utilise aussi une version de qualification distincte de la version source pour rester discriminant après le bump final.

Le test historique du seam examine le vrai tarball produit par le conditionneur fermé, avec toutes ses dépendances, ses exports et le dist local. Ses contrôles lexicaux, chaînes décodées/interpolées et imports sont conservés. Il exige un inventaire Git contenant la vraie implémentation du verrou : une copie sans index ne peut plus réussir silencieusement.

## Qualification ciblée

Les commandes, TAP, sources et reçus sont liés par `proof-E3b2a.json`. Les deux profils ciblés passent ; cela ne ferme ni E3b ni MH-L6 et ne constitue pas un verdict release.

| Fichiers ciblés ; label `final-E3b2a` | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| package / published / image-policy | 5 / 14 / 16, exit 0 | 5 / 14 / 16, exit 0 |
| succession-lock-seam-guard / package-plugin-manifest | 5 / 1, exit 0 | 5 / 1, exit 0 |
| launcher / entry / components | 25 / 8 / 23, exit 0 | 25 / 8 / 23, exit 0 |
| native-copy / publish-gate | 7 / 8, exit 0 | 7 / 8, exit 0 |
| release-script / release-workflow-publish-order | 21 / 9, exit 0 | 21 / 9, exit 0 |
| Total / skips / enfants restants | **142 / 0 / 0** | **142 / 0 / 0** |
| package-mutate / image-mutate E3b2a / payload-mutate E3b2a | **7 + 11 + 26 paires**, exit 0 | **7 + 11 + 26 paires**, exit 0 |

Audit : `node scripts/mh-l6-e3b2-audit.mjs /tmp/mh-l3-qualification-YeHHOv/source`, **exit 0** : 22 sources de référence et inventaire complet de 1 339 fichiers de code identiques ; deux dist liés par empreinte, 142 tests et 44 paires par profil. `tsc -b --pretty false` : exit 0, aucune sortie sous les deux Node. npm observé : 9.2.0 sous Node 22, 11.19.0 sous Node 24, chacun exit 0. Les SDK réellement copiés chargent en 1,1–1,5 s ; préparation distincte observée en 31,8–46,7 s. Ces six observations ne qualifient aucun p99.

Commande par fichier : `node scripts/mh-l6-test.mjs packages/h2a/test/<fichier>.test.js final-E3b2a`. Chaque fichier utilise HOME/XDG/TMPDIR privés. Chaque paire de mutation exige un rouge par assertion puis un vert après restauration ; ce sont des configurations/oracles, pas 44 gardes indépendantes.

## Limites des fixtures

Les options npm 11 `--os` et `--cpu` n'affectent que les dépendances optionnelles. Leur premier essai, vert à tort pour la propriété recherchée, est exclu de la qualification. La fixture finale remplace uniquement les lecteurs de profil du vérificateur npm des paquets requis dans un enfant privé. Un paquet témoin incompatible doit réellement échouer avec `EBADPLATFORM`, puis le vrai tarball est installé sans force ni désactivation des scripts. Le lecteur H4 installé refuse ensuite la plateforme simulée avant toute création d'image. Aucun runtime macOS ou Windows n'a été exécuté.

La première campagne complète lancée en concurrence sur les deux profils a échoué pendant la préparation durable de grosses images. Ses deux TAP sont conservés comme échecs. Le premier rejeu sérialisé passe sous Node 22 (cinq tests) mais échoue sous Node 24 (quatre sur cinq). Ces résultats ne comptent pas comme qualification finale. Le rejeu isolé Node 24 du vrai SDK/PTY a mesuré environ 33,5 secondes de préparation et 0,7 seconde de chargement SDK.

Le profilage du vrai payload mesure ensuite 33,1 secondes de préparation, dont 31,2 secondes dans les synchronisations de 10 075 fichiers et 1 515 répertoires, contre 0,23 seconde de copie. Une tentative asynchrone bornée mesure 54,1 secondes : aucun gain n'est démontré. Elle est retirée avant toute autre solution ; ses octets et son diagnostic sont archivés dans `rejected-async-preparation.json`. Le préparateur synchrone et toutes ses synchronisations restent identiques à E3b1.

Le défaut de fixture était de commencer le délai de démarrage avant la préparation de l'image. Les probes distinguent désormais ces phases : le préparateur réellement installé prépare l'image sous le budget existant du fichier ciblé (900 secondes), puis le lecteur réellement copié dans cette image charge le SDK/PTY sous le budget de démarrage du manifeste (10 secondes, contre l'ancien délai mélangé de 60 secondes). Chaque phase reste mesurée et l'image est vérifiée avant lancement. Aucun budget produit, fsync ou garde d'autorité n'est assoupli. Les campagnes npm/images sont sérialisées. Les mesures restent des observations de cette machine, sans qualification de performance/endurance.

Le retrait de l'essai asynchrone avait aussi retiré par erreur un `assert.doesNotThrow` du test des liens internes. Le premier rejeu de mutation obtenait donc `image_link_outside` directement, au lieu du rouge par assertion exigé par l'audit. L'assertion originale est rétablie ; le diagnostic brut est conservé séparément et le rejeu reprend après restauration vérifiée. Aucun contrôle produit n'a été retiré.

E3b2b reste obligatoire : smoke CI, compatibilité des backfills d'anciens tags, diagnostics CLI communs puis conditionnement final après le bump de branche. B2/C2b/D/E2b3/E3c/F/M18 et la revue indépendante restent ouverts. Aucun verdict release, gel des dists .6, admission héritée fermée ou exécution sur glibc 2.31 n'est déduit de ce sous-lot.
