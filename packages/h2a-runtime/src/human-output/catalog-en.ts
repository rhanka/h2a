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
  "restore.ledger.launched": "launched",
  "restore.ledger.blocked": "blocked",
  "restore.ledger.occupiedHuman": "occupied by a live human session — refusing to relaunch",
  "restore.ledger.remedyAttach": "attach it live with",
  "restore.facet.liveAgentCli": "live agent CLI",
  "restore.facet.shell": "shell",
  "restore.facet.consumableTranscript": "consumable transcript",
  "restore.facet.unknown": "unknown",
  "upgrade.alreadyCurrent": "already current",
  "upgrade.registryUnreachable":
    "registry unreachable, staying on the current version",
  "upgrade.upgradedTo": "upgraded",
  "upgrade.verified": "verified",
  "upgrade.deferredPropagation":
    "update published but not yet installable; retry later",
  "upgrade.failed": "upgrade failed",
  "upgrade.hostsConverged": "hosts converged",
  "upgrade.hostsPartial": "hosts partially repaired",
  "upgrade.details": "details",
  "upgrade.hostOk": "ok",
  "upgrade.hostFailed": "failed",
  "restore.sharedWindow": "shared window",
  "restore.capDropped": "session(s) dropped, cap reached",
  "restore.excludedSecondary":
    "secondary session(s) excluded by delegation provenance",
  "restore.optinHint": "restore with --include-secondary:",
  "restore.excludedUnclassified":
    "unclassified session(s) listed separately, never auto-restored:",
  "restore.wouldClassifyPrefix": "dry-run:",
  "restore.wouldClassifyBody": "row(s) that would be classified once and persisted:",
  "restore.summaryTitle": "restore:",
  "restore.count.opened": "opened",
  "restore.count.blocked": "blocked",
  "restore.count.skipped": "skipped",
  "restore.count.planned": "planned",
  "restore.count.tabs": "tab(s)",
  "restore.nothingToDo": "nothing to relaunch",
  "restore.noRemoteSessions": "no SCW sessions (h2a ls empty) for the remote group",
  "restore.centralDegraded":
    "central MCP unavailable, falling back to per-session sidecar",
  "restore.windowOpened": "window",
  "restore.skippedLive": "session(s) already visible or controlled skipped",
  "restore.skippedLiveHint":
    "--reattach only reopens views that can attach without a second controller",
  "restore.controllerUnknown":
    "controller visibility UNKNOWN for running native session",
  "restore.attachManually": "attach manually",
  "restore.vanishedLive":
    "was live at plan time but is gone; no resolved conversation exists to relaunch it",
  "restore.dualHost":
    "recorded on BOTH local hosts (local-tmux AND local-native); clean up the conflicting registry rows before restoring it",
  "restore.ambiguousSlug": "local session slug is ambiguous",
  "restore.attachExplicitly": "attach explicitly with",
  "restore.wordOr": "or",
  "restore.unknownHost": "native host state UNKNOWN — not launched (fail closed)",
  "restore.unknownHostNoAttach":
    "native host state UNKNOWN — neither relaunched nor attached (fail closed)",
  "restore.ambiguousOwner": "ambiguous-owner for",
  "restore.refuseAttachRecreate": "refusing attach or recreation",
  "restore.unresolvedConvId": "no resolved conversation id",
  "restore.notARealConversation": "is not a real conversation",
  "restore.remoteBacked": "session(s) already on remote control — no local relaunch",
};
