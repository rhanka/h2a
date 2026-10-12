import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function identityPath(file) {
  try { return realpathSync(file) } catch { return resolve(file) }
}

// Discovery is all-or-nothing. A failed subtree is an unknown inventory.
export function discoverSuites(root, suffixes = ['.test.ts']) {
  const files = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        files.push(identityPath(join(dir, entry.name)))
      }
    }
  }
  try { walk(root) } catch { return [] }
  return files.sort()
}

export function readInventory(root) {
  const inventory = JSON.parse(readFileSync(join(root, 'scripts/test-inventory.json'), 'utf8'))
  const spec = readTrainRequirements(root)
  for (const file of spec.files) inventory[file] ??= []
  return inventory
}

export function readTrainRequirements(root) {
  // The gates branch still has 0.98.4 manifests. Once the conductor builds
  // the 0.98.5 candidate, every named §5 scenario is mandatory too.
  let version
  try { version = JSON.parse(readFileSync(join(root, 'packages/h2a-runtime/package.json'), 'utf8')).version } catch { return { files: [], titles: [] } }
  return version === '0.98.5' ? JSON.parse(readFileSync(join(root, 'scripts/spec-0985-test-inventory.json'), 'utf8')) : { files: [], titles: [] }
}

export function inventoryFailures(root, inventory, discovered) {
  const found = new Set(discovered.map(identityPath))
  return Object.keys(inventory).filter((file) => !found.has(identityPath(join(root, file))))
    .map((file) => `${file}: normative suite missing from discovery`)
}

// One result model for Node, Track and runtime: unique file/test identities,
// observed statuses, recomputed counts, and an independently versioned scope.
export function verifyExecutionReport(report, requiredFiles, policy = {}) {
  if (!report || !Array.isArray(report.testResults)) return ['the execution report is missing or unreadable']
  if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) return ['the required suite set is empty or could not be enumerated']
  const failures = []
  const required = new Set(requiredFiles.map(identityPath))
  if (required.size !== requiredFiles.length) failures.push('duplicate required file identity')
  const files = new Map()
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 }
  const passedNames = []
  if (report.success === false || report.numFailedTestSuites > 0 || report.unhandledErrors?.length) failures.push('the report records suite or unhandled errors')
  for (const result of report.testResults) {
    if (typeof result?.name !== 'string') { failures.push('file result without a name'); continue }
    const file = identityPath(result.name)
    if (files.has(file)) failures.push(`${file}: duplicate suite identity`)
    files.set(file, result)
    if (!required.has(file)) failures.push(`${file}: not part of the required suite set`)
    if (result.status !== 'passed' || result.message) failures.push(`${file}: suite did not pass`)
    if (!Array.isArray(result.assertionResults)) { failures.push(`${file}: no per-test results`); continue }
    const tests = new Map()
    let executed = 0
    for (const assertion of result.assertionResults) {
      const name = assertion?.fullName
      if (typeof name !== 'string' || !name.trim()) { failures.push(`${file}: unnamed test`); continue }
      if (tests.has(name)) failures.push(`${file} :: ${name}: duplicate test identity`)
      tests.set(name, assertion)
      const status = assertion.status
      if (Object.hasOwn(counts, status)) counts[status]++
      else failures.push(`${file} :: ${name}: status "${status ?? 'missing'}" is unknown`)
      if (status === 'passed' || status === 'failed') executed++
      if (status === 'passed') passedNames.push(name)
      if (status === 'failed') failures.push(`${file} :: ${name}: failed assertion`)
      if (status !== 'passed' && status !== 'failed' && !policy.allowedSkips?.some((entry) =>
        identityPath(entry.file) === file && entry.fullName === name && entry.status === status)) {
        failures.push(`${file} :: ${name}: status "${status}" is not an authorized test result`)
      }
    }
    if (executed === 0 && !policy.allowedSkips?.some((entry) => identityPath(entry.file) === file)) failures.push(`${file}: executed ZERO tests`)
    for (const name of policy.requiredTests?.[file] ?? []) {
      if (tests.get(name)?.status !== 'passed') failures.push(`${file} :: ${name}: normative test absent or not passed`)
    }
  }
  for (const file of required) if (!files.has(file)) failures.push(`${file}: NEVER EXECUTED`)
  for (const requiredTitle of policy.requiredTitles ?? []) {
    const titles = Array.isArray(requiredTitle) ? requiredTitle : [requiredTitle]
    if (!titles.some((title) => passedNames.some((name) => name === title || name.endsWith(' ' + title)))) failures.push(`${titles.join(' / ')}: normative scenario absent or not passed`)
  }
  const expected = {
    numTotalTests: Object.values(counts).reduce((sum, n) => sum + n, 0),
    numPassedTests: counts.passed, numFailedTests: counts.failed,
    numPendingTests: counts.skipped, numTodoTests: counts.todo,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!Number.isSafeInteger(report[key]) || report[key] < 0 || report[key] !== value) {
      failures.push(`${key}: report counts do not add up to observed statuses (expected ${value})`)
    }
  }
  const suiteCounts = ['numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites']
  if (suiteCounts.some((key) => Object.hasOwn(report, key))) {
    if (suiteCounts.some((key) => !Number.isSafeInteger(report[key]) || report[key] < 0) ||
        report.numTotalTestSuites !== report.numPassedTestSuites + report.numFailedTestSuites + report.numPendingTestSuites ||
        report.numTotalTestSuites < files.size || report.numPassedTestSuites < [...files.values()].filter((file) => file.status === 'passed').length) {
      failures.push('suite summary counts contradict the observed file results')
    }
  }
  return failures
}
