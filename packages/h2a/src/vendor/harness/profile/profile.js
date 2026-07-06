// HarnessProfile — the policy SPI.
//
// The engine (parser, C1/C2 checks) is generic; all Sentropic-specific policy is data in a
// profile module. This slice exposes ONLY the fields C1/C2 actually consume — deferred
// checks (C4/C5/C6/C8) add their fields with their lots, so there is no dead config.
//
// Genericity is proven, not asserted: a second `stub` profile differs on a C2-consumed
// dimension and the Lot 4 test asserts DIVERGENT outcomes on the same input.
export {};
