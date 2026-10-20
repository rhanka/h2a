# Baseline du laboratoire — 20 octobre 2026

Candidat : `origin/main`, commit `05bcd23ccf79fcd865ac4085e6d681bfc0103bec`, version `0.98.7`. Node `v22.22.1`, npm `9.2.0`. Build propre, vrais contrôles prepack, installation des tarballs dans le préfixe privé. Aucun changement produit.

Commande exécutée depuis `tmp/worktrees/owner-lab` :

```sh
TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-CuZysF node scripts/owner-lab/run.mjs --ref origin/main --output tmp/owner-lab/baseline-final
```

Sortie : **exit 1**, **2 PASS, 5 FAIL**. La release n'est pas qualifiée.

| # | Scénario | Verdict | Preuve |
|---|---|---|---|
| 1 | Commit dans son lot worktree | PASS | [s1.json](s1.json) : nouveau commit et HEAD parent conservé. |
| 2 | Merge PR modifiant package.json | FAIL | [s2.json](s2.json) : non-bump refusé `UNVERIFIABLE`; [API](s2-api.json). |
| 3 | Push après release upstream intégrée | FAIL | [s3.json](s3.json) : baseline/release/HEAD et refus `VERSION_BUMP`. |
| 4 | Guard par défaut inactif, opt-in fonctionnel | FAIL | [s4.json](s4.json) : deux hooks par défaut et installation par défaut active. La [suite opt-in](s4-opt-in-suite.log) exécute 294 tests : 294 PASS, 0 FAIL, 0 skip. Auto-protection `OWNER_ONLY` confirmée. |
| 5 | Send entre PTYs, fenêtre destinataire attachée | FAIL | [idle](s5-idle.json), [draft](s5-draft.json), [fenêtre](s5-terminals.json), [MCP](s5-recipient-mcp.log) : enveloppes signées présentes, contrôleur humain attaché, aucun réveil injecté; brouillon intact. |
| 6 | Restore après upgrade | PASS | [s6.json](s6.json) : mêmes PID/incarnations, deux humains attachés et I/O vérifiées, job et background exclus, second restore sans doublon. [Swap effectué](s6-upgrade-state.json). |
| 7 | Upgrade lisible | FAIL | [s6-upgrade.log](s6-upgrade.log) : staging/swap réussi mais rapport doctor sérialisé avec `\n` et `\"`. |

[candidate.json](candidate.json) contient les SHA-256 des tarballs; [invocation.json](invocation.json) les arguments et l'environnement privés. Les tarballs et tous les journaux de commandes restent dans le répertoire de preuves ignoré `tmp/owner-lab/baseline-final`.

[cleanup.json](cleanup.json) confirme que `/home/antoinefa/.cache-tmp/h2a-test/run-WxKJ4h` a été supprimé. Tous les diagnostics précédents ont également nettoyé leur scratch. Le vrai HOME, le vrai `/tmp`, les sockets et l'installation h2a du propriétaire n'ont pas été montés dans les laboratoires.

Contrôles ciblés du banc :

```sh
TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-CuZysF node --test --test-reporter=tap scripts/owner-lab/oracles.test.mjs
```

[oracles.log](oracles.log) : **4 tests, 4 PASS, 0 FAIL, 0 skip**, exit 0. Les contrôles rejettent skip/TODO/absence de preuve, sortie JSON échappée, champs/sélecteurs GitHub invalides; l'échec de lancement produit sept FAIL et supprime son scratch.

Contrôle positif indépendant du scénario 2 :

```sh
TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-CuZysF node scripts/owner-lab/run.mjs --ref origin/fix/guard-prbump-gh-field --only 2 --output tmp/owner-lab/pr384-positive-control
```

Commit `04f0b7d083acd8f6cba47775823b383e08bcb14c` (#384). [s2.json](pr384-control/s2.json) confirme le merge non-bump, le refus `VERSION_BUMP`, puis le merge via grant release signé. **Scénario 2 PASS**, contre FAIL sur main. Exit global 1 : les six scénarios non sélectionnés sont FAIL, sans qualification globale implicite. [Nettoyage](pr384-control/cleanup.json) confirmé.
