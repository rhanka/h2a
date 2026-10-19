AMENDEMENT-MODIFIÉ

Je recommande **A**, avec ce texte :

> Les propriétaires pré-B déjà chargés sans barrière effective sont exemptés des seules obligations de refus des créations et de retrait automatique, y compris pour les connexions v1 établies et nouvelles. Un marqueur ne constitue pas un drainage garanti. Leurs sessions, y compris celles créées ultérieurement, restent accessibles sur leur propriétaire ; l’upgrade ne le signale pas, ne retire pas son endpoint et ne migre pas ses sessions. Les installations nécessaires restent conservées.
>
> L’inventaire et tous les chemins d’upgrade rapportent explicitement `admission: unfenced`, `retirement: deferred`. Cette coexistence peut durer indéfiniment : le propriétaire unique de D2/H2 reste la cible, sans garantie de convergence pendant cette exception.
>
> B5 peut être qualifié par plateforme avec cette exception précisément identifiée. Les pré-B restent soumis aux exigences de préservation des sessions et de rétention ; seule leur fermeture d’admission et leur retraite automatique sont exemptées. La qualification B5 ne transforme pas leur résultat d’upgrade `deferred` en transition accomplie. La barrière reste obligatoire pour chaque propriétaire coopérant, indépendamment du protocole client/frontend.
>
> Le contre-exemple hérité, les quatre fichiers B5 complets, la cohorte réelle non vide et les gates D27 restent obligatoires, sans ignore, TODO ni annulation. Aucun lot L ne commence dans un environnement contenant un pré-B non coopérant ou dont l’absence reste inconnue. Le vert B5 de la plateforme et les exigences D23 concernant tous les écrivains anciens ou inconnus restent nécessaires.

**Option A — recommandée sous cette forme.** Les faits techniques sont confirmés : le pré-B appelle directement `host.create`, sans passer par la barrière de [owner-process.ts](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/owner-process.ts:362). Le même chemin direct existe dans la base historique `7670fbed6`. Le maintien conservatoire est déjà explicite dans [supervisor.ts](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/supervisor.ts:126).

Le risque pour l’owner est une transition sans échéance : même le client actuel peut sélectionner un pré-B annonçant `launchFence`, comme le montre [op.ts](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/op.ts:204). Les nouvelles sessions peuvent donc entretenir cette situation et repousser L indéfiniment. L’amendement doit rendre explicite cette conséquence pour D2/H2, au-delà de D5/B5.

Une incohérence concrète restera à corriger après ratification : le résultat d’upgrade « uniquement pré-B » annonce encore `"legacy fused host drains in place"` et omet les champs `unfenced/deferred` dans [upgrade/index.ts](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a/src/runtime/upgrade/index.ts:536). Qualifier le contrat amendé exigera de vérifier aussi ce chemin.

**Option B — conserve les sessions, mais laisse le blocage ouvert.** Les signaux d’arrêt déclenchent `stopAll`, puis éventuellement `forceStopAll` dans [process.ts](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/process.ts:189). Un `list` vide suivi d’un signal ne ferme donc pas la course avec une création.

Surtout, attendre l’absence des pré-B sur une machine ne satisfait pas à lui seul le contrat B5 inchangé : [la fixture](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts:79) recrée systématiquement un propriétaire non coopérant. Le critère strict restera rouge. Une qualification limitée aux installations sans pré-B nécessiterait elle aussi un amendement.

Texte minimal pour B :

> Sans dérogation ratifiée, le critère universel reste bloquant. L’absence opérationnelle des anciens endpoints ne prouve pas leur capacité de refus et ne dispense d’aucun scénario B5 obligatoire.

Relecture effectuée sur `d91a53ff…`, sans modification ni réexécution. Les rapports JSON confirment **8/8** pour le contre-exemple conservé et **7/8** pour chacune des assertions strictes Node 22/24. Cela établit le défaut d’admission ; **B5 reste non qualifié**. Ce verdict est une recommandation indépendante, à soumettre à la ratification de l’owner.