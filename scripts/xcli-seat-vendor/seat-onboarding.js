// Re-export of the published seat-onboarding API (llm-mesh 0.33.0,
// enrollment and node entries). The bench consumes this API for seat
// materialisation and never re-implements its validators, capture, or
// materialization stages. Provenance is pinned in VENDOR.json.
export { AGY_REQUIRED_COMPLETED_STEPS, CODEX_APPROVAL_POLICY_VALUES, MUSE_TRUST_KNOWN_SCHEMA_VERSIONS, SEAT_ENVELOPE_AUTH_FILES, SEAT_ONBOARDING_FILE_CAPS, SEAT_ONBOARDING_MAX_BYTES, SEAT_ONBOARDING_SCHEMA_VERSION, SeatOnboardingError, canonicalAgyJetskiBytes, canonicaliseAgyJetski, parseAgyJetskiPbtxt, rebindSeatOnboarding, seatLaunchGate, validateAgyJetskiContent, validateOnboardingFileContent, validateSeatEnvelope, validateSeatOnboarding } from '@sentropic/llm-mesh/enrollment';
export { CAPTURE_SOURCES, SEAT_RECORD_REL_PATH, captureSeatOnboarding, eraseSeatHome, materialiseCellHome, materialiseSeatEnvelopes } from '@sentropic/llm-mesh/node';
