/**
 * Automatically enables correlated local dispatch evidence for the Linux x64,
 * h2a + Playwright direct profile (no sidecar, bare mode or gateway).
 * The isolated qualification and its limits are documented in
 * docs/reviews/launch-latency-l0-l1.md, "Qualification locale du dispatch livré".
 * This private diagnostic format proves dispatch, not remote acceptance or G1.
 */
export const QUALIFIED_CLAUDE_NATIVE_VERSIONS: readonly string[] = ["2.1.296"];
