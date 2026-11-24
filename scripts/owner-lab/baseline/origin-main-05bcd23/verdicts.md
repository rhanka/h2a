| # | Owner workflow | Verdict | Evidence |
|---|---|---|---|
| 1 | Commit dans le worktree du lot | PASS | s1.json: commit créé dans tmp/worktrees/lot; parent intact |
| 2 | Merge PR package.json et voie release | FAIL | Non-bump PR refused: UNVERIFIABLE  2 !== 0  |
| 3 | Push après bumps upstream déjà publiés | FAIL | Published upstream bump blocks ordinary push: VERSION_BUMP  2 !== 0  |
| 4 | Guard opt-in, protections et auto-protection | FAIL | Workspace guard active by default: 2 packaged hooks; host installer=true |
| 5 | Send attaché et brouillon humain préservé | FAIL | Expected values to be strictly deep-equal: + actual - expected  + [ +   'Attached recipient wake line: deadline expired; last={"pid":16329,"tty":true,"draft":"","lines":[]}', +   'Attached recipient wake line: deadline expired; last={"pid":16329,"tty":true,"draft":"human draft with spaces — do not overwrite","lines":[]}' + ] - []  |
| 6 | Restore après upgrade, sans doublon ni délégué | PASS | s6.json: 2 CLIs repris en place; 2 délégués exclus; second restore sans doublon |
| 7 | Sortie upgrade lisible avec convergence des hosts | FAIL | Escaped JSON wall in user output |
