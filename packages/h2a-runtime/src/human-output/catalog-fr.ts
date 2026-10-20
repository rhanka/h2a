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
};
