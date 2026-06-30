/**
 * EVO-13 — remote presence mirror (DEC-125). Local agents push signed snapshots
 * of their state to a remote h2a so its read-only surface reflects reality.
 * P1: instances only. Core stays dep-free; this lives in @sentropic/h2a.
 */
export {
  buildInstanceMirror,
  H2A_MIRROR_BODY_KIND,
  type H2AInstanceMirrorBody
} from "./build.js";
export {
  acceptMirrorEnvelope,
  type AcceptMirrorOptions,
  type H2AMirrorRejection,
  type H2AMirrorResult
} from "./accept.js";
export {
  mirrorServerForStore,
  mirrorRejectionStatus,
  type MirrorServerForStoreOptions
} from "./serve.js";
