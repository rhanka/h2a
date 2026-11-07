NO-GO
Reviewer: sol-max

Revue indépendante de `docs/specs/pty-restore-injection/SPEC_EVOL_PTY_RESTORE_INJECTION.md`, sur la base vérifiée `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`. Les références `SPEC:ligne` ci-dessous désignent ce fichier. PR #375 a été consultée dans le worktree `ptycode`, à `d5d34e20b`.

Les demandes A1–A5, B, C et D ont chacune une cible. La séparation PTY/application/vue/saisie, l'exclusion par provenance, les groupes configurables et la conservation de l'exception pré-B reprennent correctement le capital. Le verdict porte sur les lacunes suivantes, qui doivent être amendées avant de confier l'ensemble au code.

1. **P1 — L0 ne ferme pas toutes les voies d'écriture qu'il promet de fermer.**

   Localisation : `SPEC:500` (D16), `SPEC:579`, `SPEC:590`, `SPEC:606`.

   D16 place le refus dans les résolveurs de chemins et déclare les descendants non Node couverts par l'environnement isolé et le garde de spawn. Deux contournements concrets restent possibles avec ce périmètre :

   - `packages/h2a-runtime/src/crash-log.ts:435` accepte un `logPath` explicite. Cet argument contourne entièrement `resolveCrashLogPath`; l'appel crée/modifie le répertoire et le verrou dès `:445`. Corriger seulement le résolveur, comme le prévoit la liste de fichiers, ne protège donc pas cet appel.
   - `packages/h2a/test/helpers/native-isolation.js:186` ne valide les opérations natives que pour les arguments correspondant à `op/process`; à `:197`, un programme non Node conserve simplement son environnement. Un shell ou un binaire natif peut écrire vers un chemin absolu ou un lien sans consulter HOME/XDG ni aucun résolveur h2a. Un environnement privé ne lui retire pas cet accès.

   Les tests proposés peuvent tous passer sans fermer ces voies. Cela ne satisfait ni « no test can write […] via children » ni la couche de confinement demandée par l'analyse Astra, section G.

   **Correction minimale :** imposer le contrôle avant les mutations effectives, y compris les chemins explicites, et nommer une barrière de système de fichiers pour les descendants natifs/non Node. Ajouter les fichiers nécessaires à L0. Ajouter des RED contre une fausse zone propriétaire, extérieure à la racine autorisée mais entièrement dans la fixture : chemin explicite du writer, lien sortant et écriture absolue par un enfant non Node. Vérifier le refus avant effet, même si l'erreur est avalée; ne jamais utiliser l'état réel comme canari.

2. **P1 — La reprise en place contourne le point d'entrée qui protège aujourd'hui la conversation.**

   Localisation : `SPEC:484` (D3), `SPEC:485` (D4), `SPEC:643`, `SPEC:671`.

   D3 décide la reprise par session : PTY vivant + shell + conversation résolue ⇒ commande native via le broker. D4 corrige le garde des propriétaires natifs, mais aucun passage n'exige que cette nouvelle opération acquière la réservation de conversation et consulte ce garde avant de démarrer l'application.

   Aujourd'hui, `packages/h2a-runtime/src/index.ts:6360` prend `tryAcquireResumeLaunchClaim` et `:6482` appelle `guardConvWriters` dans le chemin `h2a run`. Une commande native tapée dans un shell ne passe plus par ce chemin. La réservation existante, documentée dans `packages/h2a-runtime/src/relaunch.ts:100`, couvre précisément l'intervalle entre vérification et enrôlement. L'arbitrage du broker par PTY et son idempotence par requête ne remplacent pas cette exclusion entre deux PTY différents.

   Contre-exemple : deux PTY au shell portent le même UUID; deux processus lancent une reprise avec deux identités de requête distinctes. Chacun satisfait la table D3. Une déduplication du plan d'un seul restore ne couvre pas deux commandes concurrentes, ni un autre CLI déjà écrivain sur cette conversation. Le RED actuel à deux processus ne demande que des lignes dupliquées d'un même PTY.

   **Correction minimale :** raccorder explicitement `resume-application` au garde et à la réservation existants, jusqu'à la preuve de démarrage/enrôlement. Exclure du contrôle uniquement la cible physique en cours de reprise, sans masquer un autre écrivain, et revérifier la réservation à la frontière de démarrage. Ajouter deux RED : deux PTY distincts au shell sur le même UUID ⇒ au plus un démarrage; un autre CLI déjà actif sur cet UUID ⇒ zéro injection de reprise.

3. **P2 — Le raccord D21 sans bail reste indéfini au moment où L2 doit le réaliser.**

   Localisation : `SPEC:486` (D5), `SPEC:488` (D7), `SPEC:501` (D17), `SPEC:1006`.

   La spec exige à la fois une injection sans acquisition/révocation du contrôleur humain et la réutilisation des identités/frontières D21. Dans PR #375, `packages/h2a-runtime/src/native-terminal/host.ts:1324`, le chemin D21 commence par `#requireController(lease)`, vérifie le jeton de reprise et l'epoch du contrôleur courant, puis avance son unique `writeFrontier`. Ce mécanisme n'est donc pas directement appelable par un injecteur dépourvu de bail pendant un attach humain.

   « Porter les identités D21 » ne précise pas quel écrivain possède la séquence d'automatisation, comment elle se distingue de la séquence humaine, ni comment sa frontière est retrouvée après reconnexion. Reporter cette décision à L7 laisse L2 choisir entre contourner une fence, toucher la frontière humaine ou créer une déduplication parallèle.

   **Correction minimale :** fixer avant L2 la correspondance entre requête d'injection, identité d'écrivain d'automatisation et état ACK/dédup conservé par l'owner, avec réutilisation du mécanisme D21 et maintien du bail/epoch/frontière humains. Nommer les raccords exacts autorisés. Déplacer les preuves indispensables dans L2 sur une base #375 : coupure avant effet, après effet avant ACK et sur timeout, avec attach humain conservé et octets reçus exactement une fois. L7 garde la qualification d'intégration, sans seconde implémentation d'upgrade.

4. **P2 — Le catalogue de langue manque comme prérequis livrable des premiers lots.**

   Localisation : `SPEC:573`, `SPEC:664`, `SPEC:946`, `SPEC:971`.

   L1a doit précéder L6, tout en passant ses nouvelles chaînes par le module que L6 nommera. L1a n'autorise ni sa création ni ses données. LG et L4-hint ont la même dépendance, alors que l'ordre les présente comme indépendants de L6.

   Le problème subsiste après séquençage : le module proposé vit dans `packages/h2a/src/runtime/human-output.ts`, mais ses consommateurs restore/launch sont dans le paquet runtime. `packages/h2a/package.json:25` n'exporte que la racine et `./agy-claude`; la liste L6 n'autorise ni l'export racine dans `packages/h2a/src/index.ts`, ni un sous-chemin dans le manifeste. Un import transversal de sources ne satisfait pas les builds séparés avec `rootDir: src`, et un sous-chemin dist non exporté ne constitue pas une API distribuable.

   **Correction minimale :** extraire le socle de localisation en prérequis de L1a/LG/L4-hint, ou avancer cette partie de L6. Fixer son fichier, ses données et son API entre paquets; inclure les fichiers d'export/packaging nécessaires dans les listes. Ajouter une preuve de consommation depuis les paquets construits/distribués, sans accès transversal aux sources. Ne pas introduire de chaînes temporaires codées en dur pour contourner cette dépendance.

5. **P2 — Q5 bloque explicitement la correction principale de L6, contrairement au mandat.**

   Localisation : `SPEC:1192`, en particulier `SPEC:1200`; contradiction avec `SPEC:1134` et `SPEC:1232`.

   Le brief exige que les questions OPEN ne bloquent pas L6. Le texte dit pourtant « Q5 blocks only L6's default-flip commit ». Ce commit est précisément celui qui remplace le mur JSON observé par l'humain; livrer uniquement le catalogue et les résumés derrière un autre mode ne ferme pas A1 dans l'usage demandé. Le résumé français affirme ensuite qu'aucune question ne bloque L6.

   **Correction minimale :** appliquer le défaut recommandé déjà décrit dans D14, avec sa compatibilité machine annoncée, et retirer ce veto. Garder OPEN la collecte d'un éventuel consommateur parseur sous PTY et l'ajustement de sa transition, sans subordonner la livraison humaine de L6 à une nouvelle réponse du propriétaire. Harmoniser §6 et le résumé français.

6. **P3 — Un contrôle de non-régression est encore présenté comme RED.**

   Localisation : `SPEC:644`, sous « RED tests first ».

   `should attach but never inject when the CLI is foreground` peut déjà passer sur le code actuel : `packages/h2a-runtime/src/launch-layout.ts:290` produit exactement un attach pour une session native vivante non contrôlée, sans injection. L'absence de facette applicative est le défaut nouveau; l'absence d'injection dans ce scénario ne l'est pas. LG distingue correctement son contrôle de compatibilité déjà vert; L1 doit faire de même.

   **Correction minimale :** classer ce scénario comme contrôle conservé. Pour le RED, préciser l'observation aujourd'hui absente à obtenir — facette/incarnation et résultat du ledger — et conserver séparément les assertions de non-injection. Une erreur de montage de fixture ou de symbole absent ne doit pas être présentée comme reproduction du défaut comportemental.

Vérification effectuée par lecture des sources et du diff de #375. Aucun test, build, binaire h2a installé ou accès à l'état réel n'a été exécuté. Les échecs proposés ci-dessus restent à mesurer dans les fixtures isolées; aucun RED dynamique n'est revendiqué par cette revue. L'exception pré-B et le gate B5 non qualifié sont conservés, sans demande de nouvelle implémentation d'upgrade.
