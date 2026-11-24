# Bascule vers les cinq rôles — prérequis (D4=B)

**Statut : bascule non exécutée.** L'owner a retenu le 2026-09-19 une **bascule coordonnée,
après validation de tous les prérequis** (D4=B) : toutes les files sont transférées ensemble,
une seule fois, lorsque chaque case ci-dessous est cochée. Jusque-là, les sessions actuelles
continuent de porter leurs sujets et aucun droit n'est accordé.

Références : [`RACI.md`](./RACI.md) (cible), [`org.h2a.yaml`](../../org.h2a.yaml) (forme
machine), [`docs/decisions/2026-09-19-roles-h2a/`](../decisions/2026-09-19-roles-h2a/)
(`owner-decision.md`, `dossier.md`, `migration.md` — ordre des étapes, retour arrière et
critères du pilote). Les identifiants Track ci-dessous ont été relevés sur `origin/main` à
`c0b9e863`.

Règle de transfert, commune à toutes les lignes : un sujet change de responsable **par son
identifiant Track durable**, jamais en recréant une tâche. Le transfert est acquis quand le
repreneur a envoyé un **accusé de reprise** (prochaine action et preuve attendue). Aucune
réécriture du journal : les affectations se corrigent par événements compensateurs.

---

## 1 · Avis de h-arch sur le RACI

- [ ] **Artefact d'avis de h-arch** déposé sur cette réécriture (RACI, manifeste, working-mode,
      politique des modèles), et **référencé par une décision Track** — règle « l'avis de
      l'architecte n'est pas omissible ». L'owner peut refuser l'avis ; personne ne le saute.
- [ ] Objections éventuelles traitées au registre, avec amendement de la PR si nécessaire.
- [ ] Questions posées explicitement à h-arch :
  - [ ] **Type protocolaire de `arch`** après absorption de `harness` et `cyber` : AGENTS
        (retenu dans le manifeste, sans extension de droits) ou CONTROL.
  - [ ] **Contrôles indépendants du rôle Cadre et assurance** (condition posée par l'owner
        pour D1=A) : suffisance de la règle « `arch` ne relit ni ne vérifie ses propres
        productions ; deux relecteurs d'autres familles ; `cond` vérifie leur indépendance ».
  - [ ] **Nombre de jambes de relecture** : `working-mode.md` disait « une seule revue » ; la
        PR l'aligne sur deux jambes (règle 2 du RACI, `merge-delegation-policy.md`).
  - [ ] **Profil de relecture** : la PR retient le profil de conception de la famille
        relectrice (`gpt-6-astra` · `xhigh`, Fable 5.1, `gemini-3.8-flash-high`).
  - [ ] **Identifiants de modèles** : `gemini-3.8-flash-high` pour « 3.8 high » ; efforts
        d'Opus 5 et de Fable 5.1 non fixés par l'owner.
- [ ] Deux relectures indépendantes de la PR de gouvernance, de familles différentes de celle
      de l'auteur (auteur : Opus 5 → jambes `gpt-6-astra` · `xhigh` et `gemini-3.8-flash-high`).

## 2 · Sujets en cours transférés avec leur identifiant Track

| Sujet | Identifiants Track et références | Repreneur | Preuve de reprise attendue | Accusé |
|---|---|---|---|---|
| MCP au démarrage | `01M2AWJRVJZZNA41MCX88GG24K` (réalisation `done`, recette owner non faite) ; #249, #250, #253 ; MCP central `01M0SSNGNSRS9RAA8GM1JPX6Q4` ; `01M0M0G9PEX7Y55H88H5GG6QTE` (reclaim.lock) | Moteur (`runtime`) ; Plateforme construit le service central | Redémarrage réel, outil appelé, réponse reçue, résultat rattaché à la bonne révision. | [ ] |
| `--gw` et `--bare` | **Aucun identifiant Track dédié** trouvé à `c0b9e863` : `0cc1e59d` (#275, 0.97.2), branche `port/gw-keep-native-tools-098` (`16c18cf2`) ; sujets liés `01M2GY3KYGGWKQXVPJKVX30691`, `01M2GY6BNED8RPXY23GRBA74SN` (posture directe par défaut) | Moteur (`runtime`) | Identifiant Track créé ou désigné **avant** la bascule ; tests direct, `--gw`, `--gw --bare`, reprise et restauration ; sessions encore en 0.97.1 relevées. | [ ] |
| Focus et diagrammes | `01M1VCKJCGF414RG738N23SDAZ` (module diagramme) ; `01M2KJRBRDW820DTEDTB7Y30C5` (dissociation skill Focus ↔ DS) ; `01M2GY34TD4HTP00VKERXQYARV` (skill focus-dossier) ; branche `docs/dossier-diagrammes` (`52652cd1`) | Expérience (`portal`) | Un scénario de dossier rendu, un responsable pour chaque dépendance DS, aucun contrat concurrent. | [ ] |
| RTK et JEV natifs | `01M2WV7C6CAM36VA3H0FTN5HTP` (objectif stratégique, A = `cond` à la création) ; études `01M031BTCG5ETPXCD96DXKZY5R`, `01M03SV28HEHH1119C8AT01N1P` ; S14 = `0cc1e59d` | Moteur (`runtime`) porteur technique ; Plateforme distribue par le plugin ; Cadre et assurance vérifie la matrice `--gw`/`--bare` | Sortie compressée et mesurée sous direct, `--gw` et `--gw --bare` ; juge JEV appelé par le plugin via llm-mesh sans installation manuelle. | [ ] |
| Cluster mesh | `01M0GXK767NB6EMK2AGJEEGZK3` (first cut serveur fédération locale, PR #228 ; le doublon `01M0GX2AYJ00898D6FC032CD6M` est annulé) ; flux S7 `01M0F7Y33GP1Z07SEGPFBF26FW` ; `01M0GXK7SETY9RDJEHG0VJ56WK` (D13) ; `01M0GSTAK1M8E6EHMNDSZMQ9X6` (D14) ; branche `feat/consume-cluster-mesh-0.10.0` (`ec27026e`) | Plateforme (`infra`) ; Moteur garde le lot consommateur h2a | Contrat fournisseur identifié, envoi reçu, signature vérifiée, retour de version préparé. | [ ] |

Autres sujets de la table de transfert du dossier (`migration.md` § 6), à transférer dans le
même mouvement :

- [ ] Permissions de construction `01KYJ4GJK9W3EAWC7T0GAZN2BM` → Moteur (`runtime`).
- [ ] Track et méthode `01KYQXJG77DQC368F4G2B2VGD8`, doctrine conducteur
      `01M2AWJS6HTKNDN2AN6QX3FQ1J` → Cadre et assurance (`arch`).
- [ ] Plugins, infra et release `01M06N825JFPQXGDJ7QV8Q2VJR` (règle de version :
      `agent-release-policy.md`) → Plateforme (`infra`).
- [ ] Sécurité (`06835a8d` ; `merge-delegation-policy.md` ; décision owner du 2026-08-08,
      `43002a77`) → Cadre et assurance pour l'audit ; rôle du composant pour la correction.
- [ ] Mémoire et agents natifs `01M0GXK7CVFW5RKN7MGGM0WJD8`, WP11, WP13 → Moteur (`runtime`).

## 3 · Sessions retirées et destination de leurs sujets

Une session n'est retirée qu'**après** l'accusé de reprise de chacun de ses sujets et un
drainage de ses messages en attente. Ses anciennes adresses restent résolues vers le repreneur
pendant le drainage. Aucun arrêt massif.

| Session retirée | Repreneur | Sujets à reprendre | Accusé | Drainée |
|---|---|---|---|---|
| h-harness | Cadre et assurance (`arch` · h-arch) | WP9 (méthode, portes requises) ; politique des modèles et pratique de lancement (S6 `01M0BQJWXK3BZ2E34KHGXMSTSG`, S8 `01M0GT68VZZ06ANK889AKHC4A1`) ; doctrine conducteur `01M2AWJS6HTKNDN2AN6QX3FQ1J` ; mapping des modèles `01M0GXK6ZJ76QPXVDA4W54D5DK` | [ ] | [ ] |
| h-plugins | Plateforme (`infra` · h-infra) | WP10 (distribution, CLI, empaquetage) ; hôtes lançables `01M06N825JFPQXGDJ7QV8Q2VJR` ; distribution du plugin | [ ] | [ ] |
| h-agents | Moteur (`runtime` · h-runtime) | WP13 et conteneur historique WP18 (`01KYNAXT7BX7PMFPMZKJ30WPB4`) ; caractérisation du dispatch `01M0GXK7CVFW5RKN7MGGM0WJD8` (#229, `b3844726`) | [ ] | [ ] |

- [ ] Session `track` et sessions ponctuelles : l'écrivain unique du journal Track est désigné
      sous Cadre et assurance ; les sessions ponctuelles sans mandat durable sont closes ou
      rattachées explicitement.

## 4 · Registre, conteneurs et renvois

- [ ] **Rattachement des conteneurs WP15 à WP23 et des flux Track S1 à S8** (libellés de la
      projection Track, distincts des références S1 à S22 du dossier) confirmé par leurs
      identifiants durables (proposition `migration.md` § 6.1 : WP15, WP16, WP19, WP21, WP22,
      WP23 → Moteur ; WP17, WP20 → Expérience ; WP18 → Moteur ; S1, S7 → Plateforme ; S2, S3,
      S5 → Conduite ; S4 → Moteur ; S6, S8 → Cadre et assurance). Le RACI et le manifeste sont
      complétés dans la même PR si ces conteneurs y entrent.
- [ ] **Capacité du CLI Track à changer une affectation** vérifiée. Manque connu :
      `accountable`/`responsible` ne se fixent qu'à la création (`01KYQXJG77DQC368F4G2B2VGD8`).
      Tant qu'il subsiste, un **registre de transfert** (sujet, ancien A, nouveau A, accusé)
      tient lieu de projection.
- [ ] **Renvois de noms mis à jour** : prompts de lancement, skills, règles de release,
      `docs/agents/RECALL.md` (DOC-06, douze acteurs), engagements encore ouverts qui citent
      `harness`, `cyber`, `coop`, `track`, `plugins`, `memory`, `agents` ou `gateway`.
- [ ] **Branche `docs/org-raci-wp7-hinfra` (`43002a77`)**, jamais fusionnée : close comme
      remplacée par cette PR, après accord de h-arch.
- [ ] **Alias et adressage** : résolution unique nom durable → instance active → mandat ;
      anciennes adresses conservées pendant le drainage ; aucune nouvelle clé créée par simple
      renommage.
- [ ] **Provisionnement** : aucun `h2a org provision` avant la bascule. Re-mesurer l'échec
      `TypeError: r.roles is not iterable` et l'absence de contrôle de ratification ;
      examiner le diff attendu. Les droits restent un acte de l'owner.

## 5 · Jour de la bascule

- [ ] **Date de bascule fixée par l'owner.**
- [ ] **Joignabilité des cinq repreneurs vérifiée** le jour même : chacun accuse réception en
      moins de dix minutes ; sinon `cond` désigne un remplaçant nommé et le note dans Track.
- [ ] **Retour arrière prêt** (`migration.md` § 6.2) : table des mandats, identités, adresses et
      derniers responsables ayant accusé reprise conservées ; restauration par événements
      compensateurs.
- [ ] **Relevé initial** fait pour comparaison après bascule : délai de reprise, nombre de
      relances humaines, blocages aux frontières. Aucun pourcentage de gain n'est présumé.

## 6 · Critères de clôture après bascule

- Zéro sujet sans A, zéro transfert sans accusé de reprise, zéro relecture du constructeur sur
  son propre lot.
- Bilan de charge présenté par `cond` et accepté par l'owner.
