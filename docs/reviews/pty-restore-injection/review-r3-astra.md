NO-GO
Reviewer: astra-max

Re-revue indépendante v3, SHA-256 `dc2ae07600cf67faf965c7fa6a72f4f1494eb08fdcc4e1adfafb27acd13ef065`. Références : demandes verbatim, analyses Wonder/Astra, revues R2, code `spec-pty` à `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, capital #375 à `d5d34e20ba3cd3fecd1280647f29619bfeb3187a` et amendement pré-B ratifié.

`SPEC:ligne` = `docs/specs/pty-restore-injection/SPEC_EVOL_PTY_RESTORE_INJECTION.md` ; `R/` = `packages/h2a-runtime/`.

Recontrôle des réserves R2, avant le défaut résiduel :

| Finding R2 | Vérification v3 |
|---|---|
| Astra 1, P2 — primaire déjà utilisé | **Chemin positif ajouté** : D6(iii), adaptateur nommé, drainage et callback readline (`SPEC:631`), fichiers L2, couple shell vide/brouillon consommé (`SPEC:1166`) et dépendance L1b. La preuve du brouillon reste incomplète pour une commande multiligne : finding 1 ci-dessous. |
| Astra 2 / Sol 1, P2 — barrière et preload | **Corrigé** : commandes complètes avec launcher et `--import ./…` (`SPEC:720`), refus avant évaluation hors confinement et contrôle positif atteignant le writer (`SPEC:791`, `SPEC:872`). |
| Sol 2, P2 — CI et tests de contrat hors liste | **Corrigé** : quatre workflows et deux suites explicitement autorisés (`SPEC:840`), commande sûre exacte et indépendance du trust root conservées (`SPEC:889`). |
| Astra 3 / Sol 3, P2 — frontière humaine figée | **Corrigé** : `+N` chunks humains, `+M` injections, aucun incrément croisé, contrôles injection seule et redélivrance (`SPEC:1150`, `SPEC:1244`). Conforme à l’avancement D21 de `PR375:R/src/native-terminal/host.ts:1336`. |
| Astra 4, P3 — faux RED déjà-actif | **Corrigé** : exit 0 reclassé contrôle conservé ; RED sur observations, ledger et totaux (`SPEC:1010`). |

Les corrections v1 déjà closes en R2 restent présentes : réservation commune D3, transaction et autorité D5/D7, revalidation des réponses D10, catalogue préalable L6a, VTE réel L4, absence de veto Q5 et exception pré-B D15/D17. Aucune seconde implémentation d’upgrade ni qualification B5 revendiquée.

1. **P2 — Une ligne readline vide ne prouve pas l’absence d’un brouillon Bash multiligne.** `SPEC:638`, `SPEC:647`, `SPEC:1166` — D6(iii), acceptations L2/L1b.

   L’attestation prescrite porte sur `READLINE_LINE`, `READLINE_POINT`, le prompt et les octets consommés ; elle ne distingue pas le prompt principal d’une continuation du parseur. Après `printf '%s\n' 'draft` puis Entrée, Bash attend la fermeture de la quote au prompt secondaire : la ligne readline courante est vide, mais le brouillon humain existe toujours dans le parseur. Le wrapper réel lance bien Bash (`R/src/tmux.ts:131`) ; son hook `PROMPT_COMMAND` (`:127`) ne constitue pas cette preuve supplémentaire.

   **Vérifié hors produit** dans un Bash interactif sans fichiers de démarrage, environnement vidé, `HOME=/nonexistent`, `INPUTRC=/dev/null`, historique vers `/dev/null` : un callback `bind -x` renvoie `ATTEST len=0 point=0` au prompt principal **et** après cette quote inachevée au prompt secondaire. La ligne témoin `printf RESUME` est ensuite incorporée à l’argument humain, au lieu d’être exécutée. Challenge frais et drainage ne changent pas cet état ; l’attestation décrite pourrait donc autoriser une reprise qui altère le brouillon.

   **Correction minimale :** ajouter à D6(iii) une preuve positive de lecture d’une **nouvelle commande au prompt principal**, sans continuation, here-document ou lecture imbriquée en cours. Invalider cette preuve dès l’acceptation d’une ligne, jusqu’au retour principal attesté ; ne pas la déduire du texte du prompt ni de `READLINE_LINE` seul. Ajouter dans les fichiers L2/L1b déjà autorisés le cas quote/commande multiligne avec ligne courante vide : après consommation et expiration du délai, zéro octet de reprise, brouillon intégral préservé ; conserver le succès au vrai prompt principal vide.

Aucun test/build du dépôt exécuté : les RED produit restent à mesurer. Seul le rapport est écrit ; aucun état h2a réel consulté, aucun Python, aucun commit. Les demandes A1–A5/B/C/D restent couvertes et les questions OPEN conservent leurs défauts recommandés ; la réserve porte uniquement sur la preuve de sûreté du nouveau chemin primaire.
