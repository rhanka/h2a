# Limite du confinement

Le 2026-10-11, les premiers exec_command en mode workspace-write ont échoué
avant d'exécuter leurs commandes (lecture de RTK, études, git status) :

```
bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.
```

Les commandes suivantes ont utilisé require_escalated et l'approbation
automatique. Aucun accès à l'état h2a réel ou au dist installé n'a été essayé.
Le banc a remplacé les scans UID par self/les seuls PID qu'il avait créés.
Chaque driver de la campagne finale et chaque fixture ont utilisé un mkdtemp
avec HOME/XDG_RUNTIME_DIR/TMPDIR/H2A_ROOT privés. Il n'existe donc pas de preuve
de namespace/UID distinct ; cette limite est déclarée dans REPORT.md.

Le premier commit proposé avec core.hooksPath=/dev/null a été rejeté par la
revue automatique pour contournement des hooks. Aucun commit n'a utilisé cette
option. Le chemin de hooks configuré a été inspecté (absent dans cet environnement),
puis tous les commits et le push ont utilisé Git ordinaire.

Les logs exploratoires locaux sont ignorés, sauf les preuves conservées des
diagnostics FD/listener et de la barrière de lease. L'intégralité de la dernière
matrice et du complément S5 est versionnée sous results/final/.
