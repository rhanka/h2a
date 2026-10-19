# Résumé — Spec de remédiation lane « MCP unique partagé »

**Conclusion principale : les deux PR restent non fusionnables en l'état.**
Aucun client réel n'accède au MCP partagé, la commande d'upgrade livrée n'est pas branchée, le pont registre sert un serveur indépendant au lieu du central, et une édition concurrente de config est détruite par le chemin de refus.
La spec complète (EN) est dans [SPEC_EVOL_MCP_LANE_REMEDIATION.md](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/mcpfix/SPEC_EVOL_MCP_LANE_REMEDIATION.md).
Aucun code n'a été écrit ni poussé pour cette tâche : « Spec d'abord » (owner, 18/10).

## Réponse à la question owner

| Question | Réponse |
|---|---|
| « mcp unique sera quand dans quelle version ? » | **0.98.8** (décision owner 17/10 : `main` sort en 0.98.7, la lane passe en 0.98.8). Aucune date promise. |
| Le MCP décroche-t-il encore à l'upgrade ? | Cible : non (RQ-03). État actuel : `not covered`, aucun client admis pour le prouver. |
| Faut-il reconfigurer chaque CLI ? | Cible : non, une entrée `h2a` stable par hôte, sélection par le lock seul (RQ-08, RQ-17). |
| MCP et skills via registres ? | MCP h2a + Track : dans cette lane. Skill Focus + MCP `ui://` : hors lane (NC-3, après R3 côté Sentropic). |

## Défauts à corriger (2 revues concordantes, dédupliqués)

| ID | Gravité | PR | Défaut |
|---|---|---|---|
| F-01 | P1 | [#355](https://github.com/rhanka/h2a/pull/355) | `clients: []` : aucun Claude admis au central, tout reste en stdio individuel. |
| F-02 | P1 | [#355](https://github.com/rhanka/h2a/pull/355) | Nouveau `h2a upgrade` (status/resume/…) non raccordé à la CLI ; status et dry-run installent. |
| F-03 | P1 | [#354](https://github.com/rhanka/h2a/pull/354) | Le bridge contourne le central (serveur stdio indépendant, 60 outils) et perd l'identité (`identity_disabled`). |
| F-04 | P1 | [#354](https://github.com/rhanka/h2a/pull/354) | Le refus d'une édition concurrente efface cette édition. |
| F-05 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Échec d'installation : config migrée laissée sans lock. |
| F-06 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Codex : JSON écrit dans `config.toml` (format natif = TOML). |
| F-07 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Plan compilé modifiable ; contrôle d'intégrité comparé à lui-même (`h2a_send` exclu puis exécuté). |
| F-08 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | `hosted-lock activate` publie un brouillon refusé par `verify` (`missing_binding`). |
| F-09 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Définition publiée inutilisable : le loader ne fournit pas la `Map` de handlers. |
| F-10 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Résolution Track liée au monorepo ; `ENOENT` dans un arbre npm valide. |
| F-11 | P2 | [#354](https://github.com/rhanka/h2a/pull/354) | Une compilation refusée remplace déjà les handlers actifs. |
| CI-01..03 | CI | [#355](https://github.com/rhanka/h2a/pull/355) | Timeout local 230 s du test d'empaquetage ; oracle chunks fragmentés ; artefacts de tentative 3 absents. Pas un dépassement du budget global (35 min). |

CI lue par les relecteurs : [#354](https://github.com/rhanka/h2a/pull/354) 18/18 verts, [#355](https://github.com/rhanka/h2a/pull/355) 17 verts / 1 rouge. État frais du jour : `unverified` (SG-5 de la spec, à relire en LOT-0).

## Lots de remédiation (RED d'abord, dans l'ordre)

| Lot | Branche | Contenu | Clôt |
|---|---|---|---|
| LOT-0 | #355 puis #354 | Rebase sur `origin/main` courant, baseline, aucun changement de comportement. | — |
| LOT-1 | #355 | Raccorder `h2a upgrade` H4 à la CLI (status/resume/abort/compensate/unmanage, codes 0/1/2, zéro install sur diagnostic). | F-02 |
| LOT-2A | #355 | Prouver le mécanisme de qualification sans inventer de client qualifié. | F-01 (moitié code) |
| LOT-3 | #354 | Le bridge s'attache au central authentifié, ou refuse de façon typée. Jamais de serveur de substitution. | F-03 |
| LOT-4 | #354 | Bootstrap hôte transactionnel sans perte + formats natifs (Codex TOML) + continuité des noms `mcp__h2a__*`. | F-04, F-05, F-06 |
| LOT-5 | #354 | Plan immuable, compilation atomique, admission vérifiée à l'activation du lock hébergé. | F-07, F-11, F-08 |
| LOT-6 | #354 | Définitions publiées utilisables dans les deux layouts installés (monorepo et arbre npm). | F-09, F-10 |
| LOT-2B | tête intégrée | Campagne de qualification sur vrai Claude (MH-L8 borné) : ≥ 1 build admis sur preuve mesurée, sinon échec explicite. | F-01 |
| LOT-7 | intégration | Réparer la preuve CI (timings d'abord, aucun budget relevé sans preuve) + qualification d'intégration. | CI-01..03 |

Rebase mesuré le 18/10 : base commune `5ccc98198`, `origin/main` local `d0b1afa38` ([#377](https://github.com/rhanka/h2a/pull/377)), lane en retard de 66 commits, 6 fichiers modifiés des deux côtés seulement. Règle : rebase + `--force-with-lease`, jamais de merge de `main`, fusion en merge commit.

## Non couvert (explicite)

| Sujet | Où il vit |
|---|---|
| Adaptateurs centraux codex/agy/muse/vibe (R5-CA), qualification native réelle (R7b) | Lots ultérieurs ; refus typés maintenus d'ici là. |
| R2 → R7a → R3 Sentropic (routage distant, `sentropic-registry`, registre SKILLS), skill Focus, MCP `ui://` | Sentropic, après immo [#679](https://github.com/rhanka/sentropic/pull/679). |
| Bascule live du service hébergé, serveur filtré pour sélections partielles | Décision de déploiement / incrément ultérieur. |
| Restes MH (B2-3, M18, E3b2b, E3c/U07/U11, charge M17, gateway MH-L7), propriété PTY 0.99.x | Leurs lots et versions propres. |
| Déclencheurs de reconnexion auto + `h2a restore` (D-013, item 2026-08-21), voisins WP12 (x4 tiers, x5, dossiers, D-058, EVO-12) | Specs WP2.2/WP12 ultérieures. |
| macOS/Windows, contrat registre v9, bump 0.98.8, publication, install poste + reboot | Qualification ultérieure ; v9 = décision D-03 ; release = conducteur. |

## Décisions à trancher avant le code

| ID | Décision | Recommandation de la spec (`[PROPOSITION]`) |
|---|---|---|
| D-01 | Fusionner la machinerie avant la qualification vrai Claude, avec promesse réduite ? | **Non.** Rester non fusionné jusqu'à LOT-2B. |
| D-02 | Quel build Claude qualifier en premier, avec quels sièges ? | Le build owner courant (sonde relecteurs : `2.1.296`), Linux, sièges existants en quota partagé. |
| D-03 | Contrat registre v8 (relu) ou v9 (delta non relu) ? | **v8** ; v9 en amendement séparé relu. |
| D-04 | Budget du test d'empaquetage relevable ? | Seulement avec table de timings, assertions intactes, double revue. |
| D-05 | Garder les noms de branches `feat/0.98.7-*` pour livrer 0.98.8 ? | **Oui** ; corriger titres et docs, pas les refs. |

Chaîne prévue : double revue de cette spec → réconciliation → GO-CODE owner → LOT-0.
Estimations par lot en heures d'agent et tours de revue : §7 de la spec (total indicatif 43–81 h-agent hors attente CI et disponibilité des sièges, à recalibrer après LOT-0 ; estimation, pas une mesure).

## Sources et écarts

| Point | Statut |
|---|---|
| Revues `rev355a-last.md` (Astra max) + `rev355s-last.md` (Sol 6.1 xhigh) | Lues en entier ; les 11 sites fichier:ligne revérifiés aux têtes `ef9bde52a` / `e8508e394` : tous présents. |
| Rapports `mhl6-report.md` + `r5r6-report.md` | Têtes et sections NON couvert lues ; annexes de preuve échantillonnées : `partial` (SG-6). |
| Contrats | Spec handover v7 (§8.1, §10.2, §1.3, §12) ; contrat registre v8 (§6, §7.1–7.4, §9, §10), SHA-256 revérifié `9114b5ad…` ; addenda owner 0987/0988 ; `DECISIONS-owner.md`. |
| Track WP2.2 (8 items) + WP12 (10 items) | Énumérés + `item show` en lecture seule. Écart SG-1 : le chemin CLI installé indiqué est absent du confinement ; repli sur le binaire du dépôt, dans `/home/antoinefa/src/h2a`, sans aucune écriture. Écart SG-2 : ce checkout est sale (`.track` modifié) ; les citations reflètent cet état. Écart SG-3 : l'item MCP unique dit encore « Version : 0.98.7 », la décision 17/10 (0.98.8) prime. |
| Tests exécutés pour cette tâche | Aucun (tâche = spec seule, aucun code). Aucun accès à l'état h2a réel, au binaire installé, ni à un processus étranger. Aucun Python. |
