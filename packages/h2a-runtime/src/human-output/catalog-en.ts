/**
 * Lot L6a: default (English) human-output catalog data.
 *
 * Data module compiled into `dist` (not per-language code branches, not
 * runtime file reads). The French twin must carry the exact same key set —
 * enforced by `human-output.test.ts`. Consumer lots (L1a, LG, L4-hint, L6)
 * add their keys to BOTH data files as part of their own allow-lists.
 */
export const locale = "en" as const;

export const strings: Record<string, string> = {
  "restore.ledger.alreadyActive": "Already active",
  "restore.ledger.noCandidates": "No sessions to restore",
  "restore.group.shared": "Shared",
};
