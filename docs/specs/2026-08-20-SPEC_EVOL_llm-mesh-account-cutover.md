# SPEC EVOL — unification `llm-mesh account` et suppression du pool H2A

Date : 2026-08-20

Track principal : `01M0FHM01CKB260B7VZ6XRNM4T`

Décision de recadrage : `01M0FYA1BNWBSC3TXN0QTTKV33` (option A, `go`)

Backlog clés API : `01M0FY9RMJ1QDFW5RB2VWHBR98`

Backlog Kubernetes : `01M0FY9RX37CFKXT7ERMVHS950`

Base : `origin/main@f387637079261df3b7d5857eddb69637e638dc7c`

## 1. Finalité

H2A utilise llm-mesh ; il ne définit pas son backlog produit. La présente
évolution corrige uniquement le consumer H2A avec les capacités publiques déjà
livrées par `@sentropic/llm-mesh@0.16.1` et
`@sentropic/llm-gateway@0.13.2`.

H2A possède encore un second registre (`h2a account`) qui stocke des tokens,
sélectionne les comptes, suit quota et affinité, puis injecte
`OPENAI_API_KEY` ou `CLAUDE_CONFIG_DIR`. Ce chemin reste actif même avec
`--no-gw`. Il contredit la séparation direct/gateway et doit disparaître.

## 2. Décisions ratifiées

### D1 — un namespace unique

Les commandes OAuth canoniques sont :

```text
h2a llm-mesh account enroll codex
h2a llm-mesh account enroll cloud-code
```

Le flat `h2a llm-mesh enroll <provider>` et tout le namespace `h2a account`
disparaissent sans alias de compatibilité. Une ancienne invocation échoue comme
commande inconnue et l'aide indique la nouvelle forme.

### D2 — consommation du seam public existant

Les deux enrollments appellent exclusivement la façade publique llm-mesh déjà
utilisée par H2A : `enroll`, `waitForCallback`, `pollForCompletion` et
`cancel`. H2A ne lit pas le keyring et ne crée pas de façade parallèle.

La PR ne demande ni `list`, ni `show`, ni `reauth`, ni `unenroll` à Sentropic.
Elle ne transforme pas une nécessité CLI locale en plateforme administrative
llm-mesh.

### D3 — direct signifie authentification native

- `h2a run codex --no-gw` utilise le login natif Codex ; H2A ne sélectionne
  aucun compte et ne synthétise jamais `OPENAI_API_KEY`.
- `h2a run claude --no-gw` utilise l'authentification native Claude ; H2A
  n'injecte aucun `CLAUDE_CONFIG_DIR` issu d'un pool.
- les credentials fournis par l'utilisateur restent utilisateur. En mode
  direct, H2A retire de l'environnement enfant uniquement ses propres variables
  de gateway (`ANTHROPIC_BASE_URL` et `ANTHROPIC_AUTH_TOKEN`) et ne supprime pas
  un `ANTHROPIC_API_KEY` utilisateur.

Les helpers de jobs qui restent actifs après le spawn restaurent exactement
l'environnement parent. Les commandes interactives appliquent les variables
uniquement dans leur processus CLI de lancement, qui se termine ensuite ; aucun
état d'authentification H2A ne persiste au-delà de ce processus.

### D4 — gateway signifie llm-mesh

`--gw` acquiert un bearer opaque par le chemin llm-mesh/gateway existant. Si le
mode explicitement requis est indisponible, aucun agent ne démarre et l'erreur
indique l'enrollment canonique. Il n'existe aucun fallback vers le pool legacy
ou vers un direct silencieux.

Le mode automatique conserve la politique publique existante : gateway lorsque
la configuration llm-mesh est activée et disponible, direct sinon. Il ne
consulte jamais le legacy.

### D5 — suppression définitive du legacy

La PR supprime :

- `account-pool.ts` et ses tests ;
- stockage, lecture et écriture de `accounts.json`, `accounts-tokens.json`,
  quota, bindings et session-log par le runtime ;
- sélection, fallback et injection au lancement et à la reprise ;
- `--account`, `job.accountId` et leurs surfaces d'aide ;
- enroll/ls/rm/exhausted/clear-quota/select/log/bindings/rm-binding ;
- l'ancien `h2a account push-cluster`, y compris ses sorties de secrets.

Les fichiers legacy déjà présents ne sont ni ouverts ni supprimés. Le doctor
peut constater leur existence sans les parser et proposer une sauvegarde puis
suppression manuelle.

Les anciens objets de job contenant `accountId` restent lisibles comme JSON :
le champ inconnu est ignoré et ne pilote plus aucune exécution.

### D6 — nouveautés non bloquantes

Deux besoins consumer sont trackés séparément et transmis à Sentropic sans lui
prescrire d'API :

1. comptes à clé API statique, avec secret hors argv/log et lifecycle possédé
   par llm-mesh ; cible H2A éventuelle
   `h2a llm-mesh account enroll api-key --provider <provider> --stdin` ;
2. usage par une gateway Kubernetes, seulement si cette finalité est acceptée
   par llm-mesh ; cible H2A éventuelle
   `h2a llm-mesh account push-cluster ...` ou aucune commande H2A.

Ni l'un ni l'autre ne bloque ce cutover. Aucun export cluster de remplacement
n'est implémenté dans cette PR.

### D7 — publication

La suppression de commandes est publiée comme évolution incompatible en
`0.94.0`. La PR de code ne publie rien elle-même. Après merge, le tag est créé
sur le commit de `main` conformément à `docs/RELEASE.md`; GitHub Actions est
l'unique publisher npm.

## 3. Acceptance

| Domaine | Preuve exigée |
|---|---|
| CLI | les deux enrollments imbriqués existent ; les deux anciens namespaces/formes et `--account` sont refusés |
| Codex direct | lancement réel `--no-gw`, auth native fonctionnelle, aucune clé H2A synthétisée |
| Claude direct | lancement réel `--no-gw`, auth native fonctionnelle, aucune config de pool, clé utilisateur préservée |
| Claude gateway | lancement réel `--gw` sur un compte llm-mesh enrôlé, outil puis continuation |
| reprise | reprise directe sans pool ; reprise gateway par acquisition llm-mesh uniquement |
| legacy | fichiers fixtures présents mais aucune ouverture ; aucun token dans stdout/stderr/argv |
| doctor/docs | diagnostic existence-only et migration manuelle ; aide exclusivement canonique |
| qualité | tests ciblés, typecheck, build, tests package et revue Fable 5 exact-head |
| release | tag sur `main`, CI verte, version visible sur npmjs.org |

## 4. Hors périmètre

- changement Sentropic ou lecture de son keyring privé ;
- administration générale des comptes llm-mesh ;
- clés API et cluster ;
- modification du routage, des mappings modèles ou de la gateway ;
- suppression automatique de credentials utilisateur.
