# Réserves Argon — 16 octobre 2026

Référence : revue indépendante `revmhl3.md`, cible `c96792f3`, branche
`feat/0.98.7-mh-l3`. Le propriétaire demande de lever les réserves avant toute
fusion. Ce dossier fournit les corrections et leurs preuves ; la nouvelle revue
indépendante appartient au conducteur. Aucune fusion n'est effectuée ici.
Commit des corrections : `413e7b32a0c43aef6192cb91368fe6f7cfc02c8f`.

| Constat | Traitement et oracle |
|---|---|
| 1 — Autostart au premier tick après perte SSE | Toutes les transitions de perte depuis READY arment le premier palier normatif, 1 s × jitter 50–100 %. Supervision et demande aval respectent `nextRecovery`. Trois oracles contrôlent EOF SSE, erreur SSE et disparition du marqueur, un tick immédiatement après la perte, une demande aval pendant le délai, une publication externe pendant ce délai, la reprise et le maintien de l'autostart si aucun tiers ne publie. |
| 2 — Égalité avec les digests du central à l'enregistrement | L'inventaire décrit la vue effectivement servie. Le shim transmet `sourceView` (génération ou null, build, profil, digests) ; le central valide son schéma et sa concordance avec l'annonce, l'identité de l'attachment et son epoch. Les clients anciens dont le catalogue est identique gardent leur registration sans ce champ. Une annonce divergente sans provenance est refusée. |
| 2 — Compatibilité toujours sous H4 | Le vrai central est construit avec le contrat d'un outil modifié ; le vrai bridge compilé conserve sa vue embarquée, s'enregistre et sonde les offres. Chaque digest peut diverger indépendamment. Aucun `listChanged` ni installation sans preuve ; l'outil modifié reste interdit. Provenance incohérente, format invalide, identité étrangère, epoch incorrect et ACK sans offre restent refusés. |
| 3 — `physicalPrefix` 0775 sous umask 0002 | Garde conservée, comportement attendu. Le préfixe détermine l'installation physique et l'autorité persistée ; autoriser son remplacement par un autre membre du groupe invaliderait cette confiance. Git ne versionne pas le mode des répertoires. Un umask 022 appliqué au runner ne corrige donc pas un worktree 0775 déjà créé. Les tests sensibles utilisent une copie privée 0755 ; aucune permission du worktree n'est changée. |

Les cas sont dans `packages/h2a/test/mh-l3-argon.test.js`. Les doubles de faute
sont derrière le vrai transport HTTP signé. L'horloge et le tick de supervision
sont pilotés dans les trois tests de course ; l'autostart y est compté à sa
frontière `ensure`, sans créer un démon. Le vrai redémarrage par SIGTERM et
`mcp-central-serve` est couvert séparément par `mcp-central-attachments.test.js`.
Le délai ne réserve aucune priorité permanente à un redémarrage externe : passé
le palier, l'autostart et les verrous d'élection normaux restent applicables.

`sourceView` est une extension additive du corps de registration, séparée de
`shimInventoryItem`. Son schéma reprend exactement la source déjà normative dans
`compatibilityEvidence`. Cette provenance est nécessaire pour qu'un catalogue
embarqué (génération null) ou retenu d'une ancienne génération ne soit pas
réattribué au central nouvellement connecté. Elle n'accorde aucune acceptation,
publication, acquisition ou admission métier supplémentaire.

| Preuve initiale | Résultat observé |
|---|---|
| `/usr/bin/node scripts/mh-l3-test.mjs packages/h2a/test/mh-l3-argon.test.js argon-before` | Sortie 1 : 4 échecs `ERR_ASSERTION`, 1 succès ; zéro skip/annulation/enfant restant. [TAP](evidence/mh-l3-argon.test.js-node22-argon-before.log) |
| Premier diagnostic après correction | Échec de la fixture de statut lors de la reprise et constat d'absence de fencing sur la route register. La fixture parle désormais le vrai statut signé ; le register vérifie l'epoch. [Diagnostic](evidence/mh-l3-argon.test.js-node22-argon-after.log) |
| Même fichier, fixture complète | Sortie 0 : 5/5 ; zéro skip/annulation/enfant restant. [TAP](evidence/mh-l3-argon.test.js-node22-argon-after-fixture-status.log) |

Les résultats finaux et les mutations sont consignés dans les manifestes Argon
Node 22/24 et leurs sorties TAP. Les preuves historiques de `QUALIFICATION.md`
concernent `c96792f3` et ne sont pas réattribuées aux corrections.

| Commande / périmètre final | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| `$N scripts/mh-l3-test.mjs <fichier> argon-final [vitest]`, 17 fichiers explicites dans la copie privée puis `mh-l0-formats.test.js` dans le worktree Git | **18 fichiers, 80/80**, sortie 0 | **18 fichiers, 80/80**, sortie 0 |
| Même runner, `packages/h2a/test/mh-l3-argon.test.js` | 5/5, sortie 0 | 5/5, sortie 0 |
| Même runner, `packages/h2a/test/mcp-central-attachments.test.js`, dont le vrai redémarrage SIGTERM | 33/33, sortie 0 | 33/33, sortie 0 |
| Même runner, `packages/h2a/test/mh-l3-transfer.test.js`, M21 | 1/1, sortie 0 | 1/1, sortie 0 |
| Huit cas `scripts/mh-l3-mutate.mjs` listés ci-dessous | **8 rouges ERR_ASSERTION → 8 verts 1/1**, fichiers restaurés | **8 rouges ERR_ASSERTION → 8 verts 1/1**, fichiers restaurés |
| Skips / annulations / propres enfants restants | **0 / 0 / 0** | **0 / 0 / 0** |

`$N` vaut `/usr/bin/node` pour Node 22 et
`/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node` pour Node 24,
avec le répertoire du binaire Node 24 en tête de PATH pour ce profil. La copie
privée est `/tmp/mh-l3-qualification-QCpN2Q/source`, modes 0755 ; le worktree
original reste 0775. `npm ci --ignore-scripts --no-audit --no-fund` puis
`npm run build` sortent 0 dans cette copie ; [sortie de build](evidence/argon-build-node22.log).
Les 15 fichiers référents sont tous couverts ; les trois autres sont les oracles
de catalogue/H4 (state, evidence, source-offer). Aucune suite globale exécutée.

Commande de mutation exécutée sur chaque profil, depuis la copie privée :

```sh
$N scripts/mh-l3-mutate.mjs argon-recovery-1 argon-recovery-2 argon-recovery-3 argon-register-descriptor argon-register-contract argon-register-epoch argon-register-source argon-prefix-mode
```

Les cas restaurent séparément les deux égalités avec le central, retirent le
backoff, le fencing, une liaison de provenance et la garde de mode. Le dernier
cas tue précisément la proposition de relâcher la garde d'écriture du préfixe.

Les [commandes Node 22](argon-regressions-node22.json),
[commandes Node 24](argon-regressions-node24.json),
[mutations Node 22](argon-mutations-node22.json) et
[mutations Node 24](argon-mutations-node24.json) pointent vers chaque sortie
complète. [L'audit borné](argon-proof-audit.json) compare huit fichiers source,
test, runner et schéma au commit `413e7b32` et à la copie qualifiée, ainsi que
quatre JS compilés. Il vérifie 18 fichiers / 80 tests par profil, les huit paires
par profil, les hashes restaurés et tous les reçus. Sortie observée : 0, zéro
skip/annulation/enfant restant. Les campagnes historiques et leurs anciens
hashes restent attachés à leur livraison ; elles n'ont pas été rejouées ici.

| Non couvert ici | Responsable / limite |
|---|---|
| Nouveau verdict indépendant sans réserves | Conducteur ; `harness-review` exige le serveur h2a installé, explicitement interdit dans ce confinement. Aucun consensus revendiqué. |
| Suite globale | Conducteur, une seule fois à l'intégration. |
| M09 complet, endurance/RSS/FD, vrai Claude et produit .8 | Limites de qualification MH-L3 déjà déclarées, inchangées par cette correction bornée. |
| Registre cluster-mesh | Contrat futur attendu ; frontière de découverte conservée. |

Écarts à la spec : aucun changement de politique de compatibilité ou d'autorité.
Extension de transport `sourceView` explicitée ci-dessus. Aucun allongement des
délais produit : le premier backoff prescrit est désormais appliqué à la perte.
