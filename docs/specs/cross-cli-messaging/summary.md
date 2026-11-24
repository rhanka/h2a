# Résumé — Spec de remise en état messagerie live inter-CLI

Spec complète (anglais) : `SPEC_EVOL_CROSS_CLI_MESSAGING.md`, même dossier.
Branche : `origin/feat/live-cross-cli-messaging` (`97f93e72`, 17 commits).
Verdict des deux revues (Astra max, Sol 6.1 xhigh) : **NON-FUSIONNABLE**.
Décision owner 18/10 : « Spec d'abord ». Ce lot ne contient aucun code.

## Réponse courte aux trois demandes owner

| Demande owner (verbatim tronqué) | État factuel aujourd'hui | Ce que la spec prévoit |
| --- | --- | --- |
| « fonctions live … ENTRE cli … est-ce que ca fonctionne la » | 1/36 réel, Claude → Claude. Aucune paire entre CLI différentes qualifiée | Définition §3 (8 étapes `measured-OK`), campagne réelle §6, déblocages §11 |
| « tests sur TOUTES les cli, TOUTES les fonctions, TOUTES combinaisons, dans le CI CD » | CI = simulation 36/36 + oracles config Claude/Codex. Une seule sonde par paire | Inventaire §5 (44 outils MCP + verbes CLI), tiers S/C/R1/R2, cliquet, voies §7 |
| « les test de send inter cli... tjs pas ok » | Confirmé. Codex sans MCP, Muse quitte après Trust, AGY/Gemini sans login, Vibe bloqué Python | Lots L9a–L9d par famille, statut par tier §5.5, non-couvert §12 |

## Périmètre chiffré (ne pas confondre les dénominateurs)

| Univers | Nombre | Condition |
| --- | --- | --- |
| 6 familles (claude, codex, agy, gemini, muse, vibe), paires orientées | 36 | Sièges pour les 6 familles |
| 4 familles des sièges actuels (claude, codex, muse, agy) | 16 | 6 sièges actuels : 2 Claude, 1 Codex, 2 Muse, 1 agy |
| 6 sièges, directions entre sièges distincts | 30 | Mêmes 6 sièges, comptés par siège |

## Lots (un lot principal par constat de revue, RED d'abord)

| Lot | Constats | Objet | Estimation agent |
| --- | --- | --- | --- |
| L1 | F4 (P1) | Rebase sur `main`, 3 conflits sous contrat §10 | 1–2 h, 1 revue |
| L2 | F2 (P1) | Gates globaux raccordés au confinement PID, garde conservée | 2–4 h, 2 revues |
| L3 | F1 (P1) | Preuve de réveil autonome, rejet du polling (nouveau contrôle négatif) | 2–3 h, 1 revue |
| L4 | F5, F6 (P2) | Preuves filtrées (canari) + copie login sans traversée de liens | 2–3 h, 1 revue |
| L5 | F7 (P2) | Worker perdu = nettoyage non prouvé, campagne arrêtée | 1–2 h, 1 revue |
| L6 | F8 (P2) | Garde Python fiable (`python3.14`, wrappers, descendants possédés) | 1–2 h, 1 revue |
| L7 | Vibe (F3/F9) | Dossier de décision D1, puis voie de qualification choisie | dossier + 2–4 h |
| L8 | F9 (P2) | Manifeste de sièges par rôle, plafonds, précontrôles, statut par tier | 4–6 h, 2 revues |
| L9 | Déblocages | Codex, Muse, AGY, garde Claude (diagnostic puis diagonale) | 2–4 h / famille + quota |
| L10 | F10 (P3) | Doc d'entrée conforme au bilan réel 1/36 | ~1 h |
| L11 | F3 (P1) | Voie campagne réelle protégée + manifeste matrice + gate release | 4–8 h + quota, 2 revues |

Remise en état jusqu'à branche fusionnable (L1–L6, L8, L10, sans campagne
réelle) : ~15–25 heures-agent plus les tours de revue indiqués. La
qualification R1 jusqu'à 16/16 ajoute le diagnostic par famille et la
consommation de quota partagé, mesurable seulement en campagne.

## Qualification réelle avec les sièges owner (mécanismes; chiffres = propositions)

| Mécanisme | Règle |
| --- | --- |
| Manifeste | Un siège par rôle (`claude-a:claude-b` exprimable), versions et empreintes figées, `sharedSeat` explicite en diagonale mono-siège |
| Isolation | `mkdtemp` par cellule, HOME/XDG/store/socket privés `0700`, build source sans Python, host privé, seuls PIDs possédés arrêtés |
| Logins | Liste auth autorisée seulement, `0600`, chemins résolus sans lien, effacés avec la cellule. Sans manifeste, aucun login lu |
| Fuites | Preuves en vocabulaire fermé, identifiants limités aux instances de la cellule, test canari + scan de jetons avant publication |
| Quota (proposition D2) | 60 s/cellule, 1 essai (+1 retry infra seulement), compteur de tours par siège, arrêt siège au premier `provider-quota`, arrêt campagne au premier nettoyage non prouvé |
| Nettoyage | Arrêt clôturé prouvé + suppression revérifiée, sinon `blocked` et campagne stoppée (worker perdu inclus) |

## CI/CD : où tournent les vrais logins

| Voie | Déclencheur | Secrets | Effet gate |
| --- | --- | --- | --- |
| PR (existante, étendue) | Chaque PR / push branche | Aucun. Sûre pour les forks | Bloque la fusion. Ne dit rien des modèles réels |
| Campagne réelle (nouvelle) | Manuel + hebdo + préparation release | Par siège, scopés environnement, jamais sur fork | Bloque la release si une ligne obligatoire manque, bloque ou échoue |
| Release | Tag | Reçu de campagne au SHA exact exigé | Pas de reçu au SHA exact = pas de release |

Proposition de séquence : campagnes locales sous contrôle du conducteur
jusqu'à 16/16, puis même ligne de commande sur la voie protégée (décision
D3 : GitHub-hosted + secrets d'environnement, ou runner éphémère
auto-hébergé). Rafraîchissement des secrets par cron, ré-enrôlement si le
refresh device est perdu (décision owner 12/10).

## Vibe sans Python livré (arbitrage owner requis, D1)

Faits : `vibe-rs` (ELF) répond à `--version` sans Python, mais son lanceur
(`vibe/cli/_rust.py`) branche le client Rust sur `vibe-app-server`, point
d'entrée Python. Aucun app-server compatible sans Python n'est démontré.
QO4 owner : « l'essentiel est que nous on livre 0 python » — le runtime
fournisseur est admis, tout ce que nous livrons reste à 0 Python.

| Option | Effet |
| --- | --- |
| V-A : interdiction d'exécution maintenue (défaut actuel) | 11 cellules Vibe `not covered` durablement. « TOUTES les CLI » reste faux, affiché comme tel |
| V-B : QO4 littéral (recommandée pour revue owner) | Le produit fournisseur tourne tel quel; harness, MCP, tests et CI restent 0 Python. Cellules étiquetées `vendor-runtime: python (not shipped)` |
| V-C : `vibe-rs` + app-server sans Python | Bloquée sur un artefact inexistant. Dépendance amont, aucun contournement par wrapper |

## Décisions owner avant code (un dossier Focus avec diagramme, §13)

| ID | Décision | Défaut si non tranchée |
| --- | --- | --- |
| D1 | Frontière Python Vibe (V-A / V-B / V-C) | V-A. L7 code en attente |
| D2 | Plafonds chiffrés par campagne | Mécanismes actifs, 16 paires, campagnes locales seulement |
| D3 | Emplacement du runner de campagne | Campagnes locales conducteur. Workflow L11 en attente |
| D4 | Siège Gemini fourni ou non | Gemini `not covered`, dénominateur affiché 16 + bloqués |

Ensuite : double revue max de la spec (Astra max + Sol 6.1 max), puis code
par lots sous verrou v1, chaque lot avec double revue de code avant fusion.

## Ce qui reste NOT covered après cette spec (avant exécution des lots)

| Sujet | État |
| --- | --- |
| Messagerie réelle inter-CLI (35 cellules, dont 29 non rejouées) | `not covered` / `unverified` |
| Fonctions au-delà de la sonde (résolution par nom, `pop`, sessions, négociations, boucles, délégation…) | `partial` → `not covered` par ligne jusqu'au cliquet §5.4 |
| Gemini (pas de siège), Vibe (11 cellules, D1) | `missing source` / bloqué décision |
| Enrôlement live des sièges (#348 = synthétique; façade L1 non publiée au dernier contrôle) | `partial`. La copie de fichiers n'est pas un enrôlement |
| Gates globaux `npm test` / release, intermittence runtime Astra | `unverified` / cause `unknown` jusqu'à L2 + suite complète du conducteur |
| macOS, Windows, logins réels en CI GitHub, registre MCP | `not covered` |
