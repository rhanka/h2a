/**
 * Lot L6a: French human-output catalog data.
 *
 * Same key set as the default catalog, exactly — enforced by
 * `human-output.test.ts`. Consumer lots (L1a, LG, L4-hint, L6) add their
 * keys to BOTH data files as part of their own allow-lists.
 */
export const locale = "fr" as const;

export const strings: Record<string, string> = {
  "restore.ledger.alreadyActive": "Déjà active",
  "restore.ledger.noCandidates": "Aucune session à restaurer",
  "restore.group.shared": "Partagées",
  "restore.ledger.launched": "relancée",
  "restore.ledger.blocked": "bloquée",
  "restore.ledger.occupiedHuman": "occupée par une session humaine active — relance refusée",
  "restore.ledger.remedyAttach": "rattacher avec",
  "restore.facet.liveAgentCli": "CLI agent en direct",
  "restore.facet.shell": "shell",
  "restore.facet.consumableTranscript": "transcription réutilisable",
  "restore.facet.unknown": "inconnue",
  "upgrade.alreadyCurrent": "déjà à jour",
  "upgrade.registryUnreachable":
    "registre injoignable, version actuelle conservée",
  "upgrade.upgradedTo": "mise à jour effectuée",
  "upgrade.verified": "vérifié",
  "upgrade.deferredPropagation":
    "mise à jour publiée mais pas encore installable ; réessayer plus tard",
  "upgrade.failed": "échec de la mise à jour",
  "upgrade.hostsConverged": "hôtes convergés",
  "upgrade.hostsPartial": "hôtes partiellement réparés",
  "upgrade.details": "détails",
  "upgrade.hostOk": "ok",
  "upgrade.hostFailed": "échoué",
  "hint.resumeInShell": "reprendre dans ce shell",
  "hint.orEndSession": "ou Ctrl-D pour terminer cette session",
  "hint.sessionEndedRecreate": "session terminée — la recréer avec :",
  "hint.detachedReattach": "détaché de la session native (la session continue) — se rattacher avec :",
  "hint.runInsideOwnSession": "h2a run refusé dans sa propre session",
  "hint.resumeInPlace": "reprendre sur place avec :",
  "restore.sharedWindow": "fenêtre partagée",
  "restore.capDropped": "session(s) ignorée(s), plafond atteint",
  "restore.groupCapDropped": "onglet(s) au-delà du plafond du groupe",
  "restore.emptyGroups": "groupe(s) configuré(s) vide(s)",
  "restore.unmatchedSessions": "session(s) sans groupe correspondant",
  "restore.excludedSecondary": "session(s) secondaire(s) exclue(s) — délégation",
  "restore.optinHint": "restaurer avec --include-secondary :",
  "restore.excludedUnclassified":
    "session(s) non classée(s) listée(s) séparément, jamais restaurée(s) automatiquement :",
  "restore.wouldClassifyPrefix": "dry-run :",
  "restore.wouldClassifyBody": "ligne(s) qui seraient classées une fois puis persistées :",
  "restore.summaryTitle": "restauration :",
  "restore.count.opened": "ouverte(s)",
  "restore.count.blocked": "bloquée(s)",
  "restore.count.skipped": "ignorée(s)",
  "restore.count.planned": "prévue(s)",
  "restore.count.tabs": "onglet(s)",
  "restore.nothingToDo": "rien à relancer",
  "restore.noRemoteSessions": "aucune session SCW (h2a ls vide) pour le groupe remote",
  "restore.centralDegraded": "MCP central indisponible, repli sur les sidecars par session",
  "restore.windowOpened": "fenêtre",
  "restore.skippedLive": "session(s) déjà visibles ou contrôlées ignorées",
  "restore.skippedLiveHint":
    "--reattach rouvre seulement les vues pouvant être attachées sans second contrôleur",
  "restore.controllerUnknown":
    "visibilité du contrôleur UNKNOWN pour la session native active",
  "restore.attachManually": "rattacher manuellement",
  "restore.vanishedLive":
    "était vivante au moment du plan mais a disparu ; aucune conversation résolue pour la relancer",
  "restore.dualHost":
    "enregistrée sur les DEUX hôtes locaux (local-tmux ET local-native) ; nettoyer les lignes de registre en conflit avant de la restaurer",
  "restore.ambiguousSlug": "le slug de session locale est ambigu",
  "restore.attachExplicitly": "rattacher explicitement avec",
  "restore.wordOr": "ou",
  "restore.unknownHost": "état de l'hôte natif UNKNOWN — non lancée (fail closed)",
  "restore.unknownHostNoAttach":
    "état de l'hôte natif UNKNOWN — ni relancée ni rattachée (fail closed)",
  "restore.ambiguousOwner": "propriétaire ambigu pour",
  "restore.refuseAttachRecreate": "refus de rattacher ou de recréer",
  "restore.unresolvedConvId": "aucun identifiant de conversation résolu",
  "restore.notARealConversation": "n'est pas une vraie conversation",
  "restore.remoteBacked": "session(s) déjà sur le contrôle distant — pas de relance locale",
};
