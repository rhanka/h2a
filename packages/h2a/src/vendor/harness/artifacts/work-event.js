// Neutral work-event emitted by harness method/branch verbs.
//
// `WorkEvent` is the host-agnostic JSON a NON-pass/fail act produces — `brainstorm`, `debug`,
// `review`, `plan`, `branch`, `test`, `skills`. harness EMITS it and never writes into
// `@sentropic/track`; a track-side adapter ingests it (the same emit-only seam as
// `VerificationRun`). It records the NARRATIVE of an act (a session opened/closed, a request),
// NOT a verification verdict — cognition is not shoehorned into the verification taxonomy.
export {};
