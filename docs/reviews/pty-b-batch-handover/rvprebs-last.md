AMENDEMENT-GO

Je recommande **A**, sous ratification explicite de l’owner : elle permet d’avancer sur B en préservant ses sessions, avec une limite de transition clairement annoncée.

Texte retenu :

> Un processus pré-B déjà chargé, dépourvu de barrière propriétaire effective sur toutes ses connexions, est exempté du refus de nouvelles créations. Un marqueur ne le place pas dans un état de drainage garanti. Il reste accessible, inventorié `unfenced/deferred`, avec ses installations conservées, sans signal, retrait automatique ni migration de ses sessions. B5 peut être qualifié avec cette exception explicitement rapportée ; le verdict nomme les propriétaires coopérants couverts et les pré-B exclus de la garantie. La barrière demeure obligatoire et testée pour chaque propriétaire coopérant, quel que soit le protocole client/frontend. Aucun lot L ne commence sur une plateforme tant qu’un pré-B non coopérant y subsiste ou que son absence reste inconnue.

| Option | Faits vérifiés contre le code | Risque pour les sessions et recommandation |
|---|---|---|
| **A — Exception explicite** | Le pré-B appelle directement [`host.create`](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/server.ts:254). La barrière du [propriétaire B](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/owner-process.ts:362) ne couvre pas ce chemin. Le [superviseur](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/supervisor.ts:126) conserve déjà le pré-B sans le signaler ni retirer son endpoint. | Préserve les sessions pendant l’upgrade. Les nouvelles créations peuvent prolonger indéfiniment la présence du pré-B, la conservation des installations et le blocage des lots L. Aucun redémarrage à chaud de ces anciennes sessions n’est acquis. **Recommandée avec ces conséquences explicites.** |
| **B — Maintenir l’exigence universelle** | Le protocole pré-B n’offre pas de commande de gel. Ses [signaux d’arrêt](/home/antoinefa/src/h2a/tmp/worktrees/ptycode/packages/h2a-runtime/src/native-terminal/process.ts:189) déclenchent `stopAll`, puis éventuellement `forceStopAll`. Installer un nouveau build ne change pas ce processus déjà chargé. | L’attente préserve les sessions ; provoquer son arrêt peut les terminer. B5 et la livraison restent bloqués sans échéance garantie. **Solution de repli si l’owner refuse A.** |

Pour **B**, le texte minimal serait :

> Sans barrière effective couvrant toutes les admissions pré-B, B5 reste non qualifié. Conserver les sessions, endpoints et installations sans arrêt automatique. La levée du blocage exige la fin volontaire des propriétaires et clients pré-B et une preuve positive d’absence ; une liste vide ne suffit pas.

Les rapports relus confirment **8/8** pour le contre-exemple conservé et **7/8** avec l’assertion stricte sous Node 22 et 24 : les deux créations réussissent après marqueur. Le même chemin sans gel existe dans le code pré-B d’`origin/main`.

Ce GO concerne **l’amendement**, pas la qualification B5 ni la fusion. Les quatre fichiers complets, la cohorte réelle non vide et les gates Linux puis macOS ARM64 restent obligatoires, sans ignore/TODO/annulation. Un véritable build historique et les CLI enrôlés restent à qualifier. Revue effectuée en lecture seule ; aucun test relancé.