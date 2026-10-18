/** Deliberate fail-closed startup refusals share exit 3, with stable diagnostic
 * codes and literals (T8). Unexpected process deaths keep their normal exit. */
export const PUBLICATION_REFUSALS = {
  H2A_MACHINE_ID_UNREADABLE: "native host machine-id is unreadable or invalid; recovery remains blocked until a valid machine identity is restored; see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md, Phase 0 (machine-id durablement illisible)",
  H2A_PROC_FRAME_UNKNOWN: "native host process frame is unknown; refusing socket publication",
  H2A_ENDPOINT_PROBE_TIMEOUT: "native host endpoint probe timed out; refusing socket publication",
  H2A_PUBLICATION_LOCK_TIMEOUT: "terminal socket publication lock timed out",
  H2A_SOCKET_PUBLICATION_TIMEOUT: "terminal host socket publication timed out",
  H2A_ENDPOINT_OWNER_UNPROVEN: "terminal host owner death is unproven; refusing socket publication",
  H2A_STALE_SOCKET_UNPROVEN: "terminal host owner death is unproven; refusing stale socket reclamation",
  H2A_ENDPOINT_LIVE_OWNER: "terminal host endpoint owned by a live older host; refusing double publication",
  H2A_ENDPOINT_OWNER_MALFORMED: "native endpoint owner identity is malformed or not a private owned file; refusing socket publication",
  H2A_PUBLICATION_LOCK_ID_MALFORMED: "terminal socket publication lock identity is malformed or not a private owned file; refusing socket publication",
  H2A_PUBLICATION_LOCK_PATH_UNUSABLE: "terminal socket publication lock path exceeds the unix socket path budget; refusing socket publication",
  H2A_ENDPOINT_SCAN_UNKNOWN: "native host active scan is unknown; refusing socket publication",
  H2A_ENDPOINT_REGISTRY_UNKNOWN: "native endpoint owner registry is unreadable or corrupted; refusing socket publication",
} as const;

export class NativeTerminalPublicationRefusal extends Error {
  readonly exitCode = 3;
  constructor(readonly code: keyof typeof PUBLICATION_REFUSALS) {
    super(PUBLICATION_REFUSALS[code]);
    this.name = "NativeTerminalPublicationRefusal";
  }
}
