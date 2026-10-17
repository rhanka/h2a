// Diagnostics only: execution-evidence verification remains the authority.
export function reportSuiteDurations(report, { label, write = text => process.stdout.write(text), limit = 10 } = {}) {
  const suites = report?.testResults ?? []
  const timed = suites.map(suite => ({
    name: suite.name,
    ms: suite.durationMs ?? (suite.endTime - suite.startTime),
  })).filter(suite => Number.isFinite(suite.ms) && suite.ms >= 0)
    .sort((a, b) => b.ms - a.ms || String(a.name).localeCompare(String(b.name)))
  write(`\n=== Slowest suites: ${label} (${timed.length}/${suites.length} timed) ===\n`)
  for (const suite of timed.slice(0, limit)) write(`  ${(suite.ms / 1000).toFixed(1)}s ${suite.name}\n`)
  const slow = timed.filter(suite => suite.ms > 60_000)
  if (slow.length) write(`WARNING: ${slow.length} suite(s) exceed the 60.0s diagnostic budget; investigate growth before increasing the CI job budget.\n`)
  if (timed.length < suites.length) write(`WARNING: ${suites.length - timed.length} suite(s) without timing; no duration inferred.\n`)
}
