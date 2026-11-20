#!/usr/bin/env node
/**
 * Acceptance check of delivery lot S of the Track owner table
 * (docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md, section 9).
 *
 * Read-only: it reads the spec and the plans, writes nothing, and exits 1 on the
 * first kind of defect it can prove.
 *
 *   1. TRACEABILITY — every invariant (V*) and every refusal class (G*, E*)
 *      declared by the spec has a row in its traceability annex naming at least
 *      one test; every test identifier the spec names is defined by exactly one
 *      plan, in the plan of its own lot; the eleven build lots each have a plan.
 *   2. PRIVATE-TERM GATE — the spec and the plans pass the reader's own gate
 *      (`banned-word`: banned word, private term, private path, private digest).
 *      The gate is the one compiled in the given Track build: it is called, not
 *      re-implemented here.
 *
 * USAGE
 *   node scripts/owner-table-spec-check.mjs --track-dist <packages/track/dist>
 *        [--policy <file>] [--also <file>]... [--skip-gate]
 *
 *   --policy   private-term policy (salted digests). Defaults to
 *              TRACK_OWNER_POLICY_FILE. Without a policy the gate still checks
 *              banned words, private paths and private digests, and says that
 *              private terms were not checked.
 *   --also     one more text file to pass through the gate (a pull-request
 *              body, a commit message). Repeatable.
 *
 * EXIT CODES   0 conforming · 1 a check failed · 2 usage error
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = 'docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md'
const PLAN_DIR = 'plan'
const LOTS = ['0', 'd', '3q', '1', '2', '4a', '3a', '3b', '3c', '4b', '5a']
const TEST_ID = /\bT(0|D|3q|3a|3b|3c|4a|4b|5a|1|2)-[a-z]\b/gu
const PLAN_FILE = /^\d{2}-BRANCH_track-owner-table-lot-([0-9a-z]+)-[a-z0-9-]+\.md$/u
// A test definition inside a plan: - [ ] `T1-a` — `path/to/test-file` — title
const TEST_DEFINITION = /^\s*- \[[ x]\] `(T(?:0|D|3q|3a|3b|3c|4a|4b|5a|1|2)-[a-z])` — `([^`]+)` — (\S.*)$/u

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { trackDist: undefined, policy: process.env.TRACK_OWNER_POLICY_FILE, also: [], skipGate: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${arg} requires a value`)
      return argv[++i]
    }
    if (arg === '--track-dist') opts.trackDist = value()
    else if (arg === '--policy') opts.policy = value()
    else if (arg === '--also') opts.also.push(value())
    else if (arg === '--skip-gate') opts.skipGate = true
    else throw new UsageError(arg === '--help' || arg === '-h' ? '' : `unknown argument: ${arg}`)
  }
  if (!opts.skipGate && !opts.trackDist) {
    throw new UsageError('--track-dist <packages/track/dist> is required (the gate is the compiled reader), or pass --skip-gate')
  }
  return opts
}

/** Lot of a test identifier, in the lower case used by plan file names: T1-a -> 1, TD-a -> d. */
function lotOf(testId) {
  return testId.slice(1, testId.lastIndexOf('-')).toLowerCase()
}

function checkTraceability(failures) {
  const spec = readFileSync(join(ROOT, SPEC), 'utf8')
  const lines = spec.split('\n')

  const declared = new Set()
  for (const line of lines) {
    for (const m of line.matchAll(/\*\*(V\d+|G\d+) — /gu)) declared.add(m[1])
    const element = /^\| (E\d+) \| /u.exec(line)
    if (element) declared.add(element[1])
  }

  // Rows of the traceability annex: | Id | Statement | Tests |
  const traced = new Map()
  let inAnnex = false
  for (const line of lines) {
    if (/^### A\. /u.test(line)) inAnnex = true
    else if (/^### [B-Z]\. /u.test(line)) inAnnex = false
    if (!inAnnex) continue
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 5) continue
    const id = cells[1].replace(/`/gu, '')
    if (!/^(V\d+|G\d+|E\d+|--strict)$/u.test(id)) continue
    traced.set(id, [...(cells[3].match(TEST_ID) ?? [])])
  }
  for (const id of [...declared].sort()) {
    const tests = traced.get(id)
    if (tests === undefined) failures.push(`traceability: ${id} is declared by the spec and has no row in annex A`)
    else if (tests.length === 0) failures.push(`traceability: ${id} names no test in annex A`)
  }
  for (const id of traced.keys()) {
    if (id !== '--strict' && !declared.has(id)) failures.push(`traceability: annex A lists ${id}, which the spec does not declare`)
  }

  const planDir = join(ROOT, PLAN_DIR)
  const planFiles = existsSync(planDir) ? readdirSync(planDir).filter((f) => PLAN_FILE.test(f)).sort() : []
  const definitions = new Map()
  const lotsWithPlan = new Set()
  for (const file of planFiles) {
    const lot = PLAN_FILE.exec(file)[1]
    lotsWithPlan.add(lot)
    for (const line of readFileSync(join(planDir, file), 'utf8').split('\n')) {
      const m = TEST_DEFINITION.exec(line)
      if (!m) continue
      const [, id] = m
      if (definitions.has(id)) failures.push(`plans: ${id} is defined twice (${definitions.get(id)} and ${file})`)
      else definitions.set(id, file)
      if (lotOf(id) !== lot) failures.push(`plans: ${id} is defined in the plan of lot ${lot} (${file})`)
    }
  }
  for (const lot of LOTS) {
    if (!lotsWithPlan.has(lot)) failures.push(`plans: no plan file for build lot ${lot} under ${PLAN_DIR}/`)
  }
  for (const lot of lotsWithPlan) {
    if (!LOTS.includes(lot)) failures.push(`plans: a plan exists for an unknown lot "${lot}"`)
  }

  const named = new Set(spec.match(TEST_ID) ?? [])
  for (const id of [...named].sort()) {
    if (!definitions.has(id)) failures.push(`traceability: the spec names ${id}, which no plan defines`)
  }
  for (const id of [...definitions.keys()].sort()) {
    if (!named.has(id)) failures.push(`traceability: ${definitions.get(id)} defines ${id}, which the spec never names`)
  }
  return { declared: declared.size, traced: traced.size, tests: definitions.size, plans: planFiles }
}

async function checkGate(opts, planFiles, failures) {
  const modulePath = resolve(opts.trackDist, 'report', 'owner-table.js')
  if (!existsSync(modulePath)) throw new UsageError(`no compiled reader at ${opts.trackDist}/report/owner-table.js — build Track first`)
  const { auditOwnerTable } = await import(pathToFileURL(modulePath).href)
  if (typeof auditOwnerTable !== 'function') throw new UsageError('the given Track build does not export auditOwnerTable')

  const policyPath = opts.policy && existsSync(opts.policy) ? resolve(opts.policy) : undefined
  const files = [SPEC, ...planFiles.map((f) => join(PLAN_DIR, f)), ...opts.also]
  let lineCount = 0
  for (const file of files) {
    const abs = resolve(ROOT, file)
    const texts = readFileSync(abs, 'utf8').split('\n')
    const kept = []
    texts.forEach((text, index) => {
      if (text.trim() !== '') kept.push({ line: index + 1, text })
    })
    lineCount += kept.length
    // One synthetic row per line, so the reader's own text gate judges every line.
    const view = {
      kind: 'owner-table-report',
      rows: kept.map((entry, index) => ({
        kind: 'single',
        num: index + 1,
        id: `line-${entry.line}`,
        status: 'not-started',
        etas: [{ targetStage: 'spec', when: '—', source: 'unknown' }],
        request: entry.text,
        done: '—',
        todo: '—',
        decisionRefs: [],
        hasWitness: false,
      })),
      decisions: [],
      replyLine: '',
      registeredNumbers: [],
      archivedNumbers: [],
    }
    const audit = auditOwnerTable(view, policyPath ? { policyPath } : {})
    for (const violation of audit.violations) {
      if (violation.code !== 'banned-word') continue
      const entry = kept[(violation.rowNum ?? 0) - 1]
      failures.push(`gate: ${file}:${entry?.line ?? '?'} contains a banned word, a private term, a private path or a private digest`)
    }
  }
  return { files: files.length, lines: lineCount, policy: policyPath !== undefined }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const failures = []
  const trace = checkTraceability(failures)
  process.stdout.write(
    `traceability: ${trace.declared} invariants and refusal classes declared, ${trace.traced} rows in annex A, ` +
      `${trace.tests} tests defined by ${trace.plans.length} plans\n`,
  )
  if (opts.skipGate) {
    process.stdout.write('private-term gate: skipped (--skip-gate)\n')
  } else {
    const gate = await checkGate(opts, trace.plans, failures)
    process.stdout.write(
      `private-term gate: ${gate.lines} lines of ${gate.files} files through the compiled reader gate — ` +
        (gate.policy
          ? 'policy applied (banned words, private terms, private paths, private digests)\n'
          : 'no policy configured (banned words, private paths and private digests checked; private terms NOT checked)\n'),
    )
  }
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.stderr.write(`owner-table-spec-check: ${failures.length} failure(s)\n`)
    return 1
  }
  process.stdout.write('owner-table-spec-check: conforming\n')
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    if (error instanceof UsageError) {
      if (error.message) process.stderr.write(`owner-table-spec-check: ${error.message}\n`)
      process.stderr.write(
        'usage: node scripts/owner-table-spec-check.mjs --track-dist <packages/track/dist> [--policy <file>] [--also <file>]... [--skip-gate]\n',
      )
      process.exitCode = 2
    } else {
      process.stderr.write(`owner-table-spec-check: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  },
)
