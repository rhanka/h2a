// Neutral verification artifact emitted by harness checks.
//
// `VerificationRun` is the host-agnostic JSON a check run produces. harness EMITS it
// and never writes into `@sentropic/track`; a track-side adapter ingests it. It is a
// superset of track's `TestRun{ commit, env, runner, result, at }` so the seam holds.
//
// `category` is the BR25 **D3** verification taxonomy (APPROVED 2026-06-04), bound to this
// field. `security` is reserved NOW as a frozen v0 slot (DEC §2 / §6): adding an enum value
// after the freeze would be a major bump, so the slot is locked even though the security
// verify-hook is not wired yet. In v0 `security` stays schema-artifact-only / OFF-WIRE (OQ-7).
export {};
