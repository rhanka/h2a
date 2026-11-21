#!/usr/bin/env node
/**
 * Read-only measurement of the owner-table state across Track journals.
 *
 * Reproduces the measurements A1 to A4 (annex C) of
 * docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md with a given
 * `track` build, so every figure quoted by that spec can be re-derived instead
 * of trusted.
 *
 *   A1  per journal: events, `demand.*` events, unsettled decisions (pending and
 *       deferred, with and without options), unanswered dossier questions, the
 *       exit code and violation count of `track report --owner-table`, the
 *       `track validate` verdict, `OWNER GATE` occurrences, workspace labels
 *   A2  how the recorded demands were captured (timing, text versus title,
 *       transport, idempotency key)
 *   A3  replay of the fail-open hole on a DISPOSABLE COPY: an unsettled decision
 *       (pending or deferred) without options is skipped, so the table states
 *       that nothing is pending
 *   A4  divergence between a journal of reference and a copy of it
 *
 * READ-ONLY CONTRACT
 *   - No listed journal is ever handed to a mutating Track verb. The only
 *     mutating calls (`ingest`, `demand number`) of A3 receive a copy created
 *     under `--scratch`, and the script refuses a scratch directory located
 *     inside a measured `.track` directory.
 *   - Every measured journal is fingerprinted (bytes of `events.jsonl` and
 *     `head.json`, plus the directory listing) before and after. A difference
 *     makes the run exit 3. A journal with a live writer can legitimately move
 *     during a run: the script cannot tell the two causes apart and says so.
 *   - Nothing is written outside `--scratch`. Without `--scratch`, A3 is
 *     skipped and reported as skipped.
 *   - Journal paths are never printed unless `--show-paths` is passed: the
 *     output is labelled by the labels of the journal list.
 *
 * USAGE
 *   node scripts/owner-table-measure.mjs --track-bin <.../track/dist/cli/bin.js>
 *        [--journals <file>] [--journal [label=]<dir>]...
 *        [--a3 <label|[label=]dir> --scratch <dir>]
 *        [--a4 <main> <copy>]...          each side: a label of the list, or [label=]dir
 *        [--only A1,A2,A3,A4] [--format md|json] [--show-paths]
 *
 *   A journal list is one entry per line, `label<TAB>dir` or `dir`; `#` starts
 *   a comment. `dir` is a `.track` directory or the folder that contains one.
 *   A1 and A2 cover the listed journals only; a copy compared by --a4 does not
 *   need to be listed.
 *
 * EXIT CODES
 *   0 measured · 2 usage error · 3 a measured journal changed during the run
 *   4 a Track invocation could not be executed
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

const SECTIONS = ['A1', 'A2', 'A3', 'A4']

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message)
}

function parseArgs(argv) {
  const opts = {
    trackBin: process.env.TRACK_BIN,
    journalFiles: [],
    journals: [],
    a3: undefined,
    scratch: undefined,
    a4: [],
    only: new Set(SECTIONS),
    format: 'md',
    showPaths: false,
  }
  const need = (i, flag) => {
    if (i >= argv.length) usage(`${flag} requires a value`)
    return argv[i]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--track-bin':
        opts.trackBin = need(++i, arg)
        break
      case '--journals':
        opts.journalFiles.push(need(++i, arg))
        break
      case '--journal':
        opts.journals.push(need(++i, arg))
        break
      case '--a3':
        opts.a3 = need(++i, arg)
        break
      case '--scratch':
        opts.scratch = need(++i, arg)
        break
      case '--a4': {
        const main = need(++i, arg)
        const copy = need(++i, arg)
        opts.a4.push([main, copy])
        break
      }
      case '--only': {
        const wanted = need(++i, arg).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        for (const w of wanted) if (!SECTIONS.includes(w)) usage(`--only accepts ${SECTIONS.join(',')} (got ${w})`)
        opts.only = new Set(wanted)
        break
      }
      case '--format':
        opts.format = need(++i, arg)
        if (!['md', 'json'].includes(opts.format)) usage('--format must be md or json')
        break
      case '--show-paths':
        opts.showPaths = true
        break
      case '--help':
      case '-h':
        usage('')
        break
      default:
        usage(`unknown argument: ${arg}`)
    }
  }
  if (!opts.trackBin) usage('--track-bin <path to track dist/cli/bin.js> is required (or TRACK_BIN)')
  return opts
}

/** Accept a `.track` directory or the folder holding one; return the `.track` directory. */
function toTrackDir(input) {
  const abs = resolve(input)
  const direct = basename(abs) === '.track' ? abs : join(abs, '.track')
  if (!existsSync(join(direct, 'events.jsonl'))) {
    usage(`no events.jsonl under ${basename(abs) === '.track' ? '.track' : `${basename(abs)}/.track`}`)
  }
  return realpathSync(direct)
}

function loadJournals(opts) {
  const entries = []
  const push = (label, dir) => {
    const trackDir = toTrackDir(dir)
    entries.push({ label: label ?? basename(dirname(trackDir)), trackDir })
  }
  for (const file of opts.journalFiles) {
    for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.replace(/#.*$/u, '').trim()
      if (line === '') continue
      const tab = line.indexOf('\t')
      if (tab === -1) push(undefined, line)
      else push(line.slice(0, tab).trim(), line.slice(tab + 1).trim())
    }
  }
  for (const spec of opts.journals) {
    const { label, dir } = splitLabel(spec)
    push(label, dir)
  }
  const seen = new Set()
  for (const e of entries) {
    if (seen.has(e.label)) usage(`duplicate journal label: ${e.label}`)
    seen.add(e.label)
  }
  return entries
}

/** Split an optional `label=` prefix off a directory argument. */
function splitLabel(spec) {
  const eq = spec.indexOf('=')
  if (eq > 0 && !spec.slice(0, eq).includes(sep)) return { label: spec.slice(0, eq), dir: spec.slice(eq + 1) }
  return { label: undefined, dir: spec }
}

/** A label of the list, a directory, or `label=directory`; returns `{ label, trackDir }`. */
function lookup(journals, ref) {
  const byLabel = journals.find((j) => j.label === ref)
  if (byLabel) return byLabel
  const { label, dir } = splitLabel(ref)
  const trackDir = toTrackDir(dir)
  if (label !== undefined) return { label, trackDir }
  return journals.find((j) => j.trackDir === trackDir) ?? { label: basename(dirname(trackDir)), trackDir }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Bytes of the two journal files plus the directory listing: any write shows. */
function fingerprint(trackDir) {
  const hash = createHash('sha256')
  for (const name of ['events.jsonl', 'head.json']) {
    const file = join(trackDir, name)
    hash.update(`${name}\0`)
    hash.update(existsSync(file) ? readFileSync(file) : Buffer.alloc(0))
    hash.update('\0')
  }
  const listing = readdirSync(trackDir)
    .sort()
    .map((name) => {
      const st = statSync(join(trackDir, name))
      return `${name}:${st.isDirectory() ? 'dir' : st.size}`
    })
  hash.update(listing.join('\n'))
  return hash.digest('hex')
}

function readEvents(trackDir) {
  const raw = readFileSync(join(trackDir, 'events.jsonl'), 'utf8')
  const events = []
  let malformed = 0
  let ownerGateLines = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    if (line.includes('OWNER GATE')) ownerGateLines++
    try {
      events.push(JSON.parse(line))
    } catch {
      malformed++
    }
  }
  return { events, malformed, ownerGateLines }
}

function makeRunner(trackBin) {
  const bin = resolve(trackBin)
  if (!existsSync(bin)) usage(`--track-bin not found: ${basename(bin)}`)
  const env = { ...process.env }
  // The journal is always designated by --track-dir; an ambient TRACK_DIR must never redirect a call.
  delete env.TRACK_DIR
  return (args, cwd) => {
    const res = spawnSync(process.execPath, [bin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    })
    if (res.error) {
      const failure = new Error(`cannot execute track: ${res.error.message}`)
      failure.exitCode = 4
      throw failure
    }
    return { rc: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  }
}

function parseJsonArray(text) {
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function decisionStats(run, trackDir, cwd, outcome) {
  const res = run(['decision', 'ls', '--outcome', outcome, '--format', 'json', '--track-dir', trackDir], cwd)
  const list = res.rc === 0 ? parseJsonArray(res.stdout) : undefined
  if (list === undefined) return { error: `rc=${res.rc}`, count: 0, noOptions: 0, openQuestions: 0, ids: [] }
  return {
    count: list.length,
    noOptions: list.filter((d) => (d.optionCount ?? 0) === 0).length,
    openQuestions: list.reduce((sum, d) => sum + (d.openQuestionCount ?? 0), 0),
    ids: list.map((d) => ({ id: d.id, optionCount: d.optionCount ?? 0 })),
  }
}

const VIOLATION_RE = /^- \[([a-z-]+)\]/u

function ownerTable(run, trackDir, cwd) {
  const res = run(['report', '--owner-table', '--format', 'md', '--track-dir', trackDir], cwd)
  const codes = []
  for (const line of res.stderr.split('\n')) {
    const m = VIOLATION_RE.exec(line)
    if (m) codes.push(m[1])
  }
  return {
    rc: res.rc,
    renders: res.rc === 0,
    violations: codes.length,
    firstCode: codes[0] ?? (res.rc === 0 ? '' : 'other'),
    stdout: res.stdout,
    stderr: res.stderr,
  }
}

function validateVerdict(run, trackDir, cwd) {
  const res = run(['validate', '--track-dir', trackDir], cwd)
  const first = res.stdout.split('\n')[0] ?? ''
  const invalid = /^INVALID: (\d+) integrity \+ (\d+) desync/u.exec(first)
  if (invalid) return { rc: res.rc, integrity: Number(invalid[1]), desync: Number(invalid[2]) }
  if (/integrity \+ desync clean/u.test(first)) return { rc: res.rc, integrity: 0, desync: 0 }
  return { rc: res.rc, integrity: undefined, desync: undefined, note: first.slice(0, 80) }
}

function measureA1(run, journal) {
  const { trackDir } = journal
  const cwd = dirname(trackDir)
  const before = fingerprint(trackDir)
  const { events, malformed, ownerGateLines } = readEvents(trackDir)
  const pending = decisionStats(run, trackDir, cwd, 'pending')
  const deferred = decisionStats(run, trackDir, cwd, 'deferred')
  const table = ownerTable(run, trackDir, cwd)
  const validation = validateVerdict(run, trackDir, cwd)

  const createdAt = new Map()
  const workspaces = new Set()
  let demandEvents = 0
  let lastAt = ''
  for (const e of events) {
    if (typeof e.type === 'string' && e.type.startsWith('demand.')) demandEvents++
    if (e.type === 'decision.created') createdAt.set(e.aggregateId, e.at)
    if (e.type === 'item.created' || e.type === 'decision.created' || e.type === 'demand.raised') {
      workspaces.add(typeof e.payload?.workspace === 'string' ? e.payload.workspace : '(none)')
    }
    if (typeof e.at === 'string' && e.at > lastAt) lastAt = e.at
  }
  let oldest
  for (const [outcome, stats] of [['pending', pending], ['deferred', deferred]]) {
    for (const d of stats.ids) {
      const at = createdAt.get(d.id)
      if (at !== undefined && (oldest === undefined || at < oldest.at)) {
        oldest = { at, outcome, optionCount: d.optionCount }
      }
    }
  }
  const after = fingerprint(trackDir)
  return {
    label: journal.label,
    events: events.length,
    malformedLines: malformed,
    duplicateIdLines: events.length - new Set(events.map((e) => e.id)).size,
    demandEvents,
    pending: { count: pending.count, noOptions: pending.noOptions, openQuestions: pending.openQuestions, error: pending.error },
    deferred: { count: deferred.count, noOptions: deferred.noOptions, openQuestions: deferred.openQuestions, error: deferred.error },
    report: { rc: table.rc, renders: table.renders, violations: table.violations, firstCode: table.firstCode },
    validate: validation,
    ownerGateLines,
    workspaceLabels: workspaces.size,
    lastEventAt: lastAt,
    oldestUnsettled: oldest,
    unchanged: before === after,
  }
}

function summarizeA1(rows) {
  const unsettled = (r) => r.pending.count + r.deferred.count
  const withUnsettled = rows.filter((r) => unsettled(r) > 0)
  const noOptions = rows.reduce((s, r) => s + r.pending.noOptions + r.deferred.noOptions, 0)
  const total = rows.reduce((s, r) => s + unsettled(r), 0)
  const firstCodes = {}
  for (const r of rows) {
    if (!r.report.renders) firstCodes[r.report.firstCode] = (firstCodes[r.report.firstCode] ?? 0) + 1
  }
  let oldest
  for (const r of rows) {
    if (r.oldestUnsettled && (oldest === undefined || r.oldestUnsettled.at < oldest.at)) {
      oldest = { ...r.oldestUnsettled, label: r.label }
    }
  }
  return {
    journals: rows.length,
    refuse: rows.filter((r) => !r.report.renders).length,
    render: rows.filter((r) => r.report.renders).length,
    withDemandEvents: rows.filter((r) => r.demandEvents > 0).length,
    unsettledDecisions: total,
    journalsWithUnsettled: withUnsettled.length,
    unsettledWithOptions: total - noOptions,
    unsettledWithoutOptions: noOptions,
    openDossierQuestions: rows.reduce((s, r) => s + r.pending.openQuestions + r.deferred.openQuestions, 0),
    ownerGateLines: rows.reduce((s, r) => s + r.ownerGateLines, 0),
    journalsWithDuplicateIds: rows.filter((r) => r.duplicateIdLines > 0).map((r) => `${r.label} (${r.duplicateIdLines})`),
    firstViolationCodes: firstCodes,
    oldestUnsettled: oldest,
    allUnchanged: rows.every((r) => r.unchanged),
  }
}

function measureA2(journal) {
  const { events } = readEvents(journal.trackDir)
  const raised = events.filter((e) => e.type === 'demand.raised')
  if (raised.length === 0) return undefined
  const byType = {}
  for (const e of events) {
    if (typeof e.type === 'string' && e.type.startsWith('demand.')) byType[e.type] = (byType[e.type] ?? 0) + 1
  }
  const rows = raised.map((e) => {
    const text = typeof e.payload?.raw?.text === 'string' ? e.payload.raw.text : ''
    return {
      at: e.at,
      textEqualsTitle: e.payload?.raw?.title !== undefined && text === e.payload.raw.title,
      textLength: text.length,
      transport: e.prov?.transport ?? '(none)',
      idempotencyKey: e.clientToken !== undefined,
    }
  })
  const times = rows.map((r) => Date.parse(r.at)).filter((t) => !Number.isNaN(t))
  const lengths = rows.map((r) => r.textLength)
  return {
    label: journal.label,
    demandRaised: rows.length,
    firstAt: rows[0]?.at,
    lastAt: rows[rows.length - 1]?.at,
    spanSeconds: times.length > 0 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : undefined,
    textEqualsTitle: rows.filter((r) => r.textEqualsTitle).length,
    textLengthMin: Math.min(...lengths),
    textLengthMax: Math.max(...lengths),
    transports: [...new Set(rows.map((r) => r.transport))],
    withIdempotencyKey: rows.filter((r) => r.idempotencyKey).length,
    demandEventsByType: byType,
    rows,
  }
}

function isInside(child, parent) {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p + sep)
}

function replayA3(run, journal, scratch, journals) {
  if (scratch === undefined) return { label: journal.label, skipped: '--scratch not provided' }
  if (!existsSync(scratch) || !statSync(scratch).isDirectory()) usage('--scratch must be an existing directory')
  const scratchReal = realpathSync(scratch)
  for (const j of [journal, ...journals]) {
    if (isInside(scratchReal, j.trackDir)) usage('--scratch must not be inside a measured .track directory')
  }
  const sourceBefore = fingerprint(journal.trackDir)
  const work = mkdtempSync(join(scratchReal, 'owner-table-a3-'))
  let outcome
  try {
    outcome = replayOnCopy(run, journal, work, scratchReal)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  outcome.cleanup = {
    copyRemoved: !existsSync(work),
    sourceUnchanged: sourceBefore === fingerprint(journal.trackDir),
  }
  return outcome
}

/** Every mutating call below targets `copy`, a directory created under --scratch and removed by the caller. */
function replayOnCopy(run, journal, work, scratchReal) {
  const copy = join(work, '.track')
  const steps = []
  mkdirSync(copy)
  for (const name of ['events.jsonl', 'head.json']) {
    const from = join(journal.trackDir, name)
    if (existsSync(from)) copyFileSync(from, join(copy, name))
  }
  if (!isInside(copy, scratchReal) || isInside(copy, journal.trackDir)) {
    throw new Error('refusing to mutate: the copy is not confined to --scratch')
  }
  // The hole skips every UNSETTLED decision without options: pending or deferred alike.
  const unsettledWithoutOptions = () =>
    decisionStats(run, copy, work, 'pending').noOptions + decisionStats(run, copy, work, 'deferred').noOptions
  const withoutOptionsBefore = unsettledWithoutOptions()
  const { events } = readEvents(copy)
  const demandEvents = events.filter((e) => typeof e.type === 'string' && e.type.startsWith('demand.')).length
  if (demandEvents > 0 || withoutOptionsBefore === 0) {
    return {
      label: journal.label,
      skipped: `preconditions not met (needs 0 demand.* and at least 1 unsettled decision without options; got ${demandEvents} and ${withoutOptionsBefore})`,
    }
  }

  const before = ownerTable(run, copy, work)
  steps.push({ step: 'report before', rc: before.rc, firstCode: before.firstCode, violations: before.violations })

  const input = join(work, 'in.jsonl')
  const workEvent = {
    v: 1,
    kind: 'demand.raise',
    payload: {
      type: 'feature',
      raw: { text: 'A3 replay', title: 'A3 replay' },
      source: { kind: 'human' },
      workspace: 'a3-replay',
    },
  }
  writeFileSync(input, `${JSON.stringify(workEvent)}\n`)
  const ingest = run(['ingest', input, '--workspace', 'a3-replay', '--track-dir', copy], work)
  const demandId = ingest.stdout.trim().split('\n')[0] ?? ''
  steps.push({ step: 'ingest one demand.raise', rc: ingest.rc })

  const number = run(['demand', 'number', demandId, '--number', '1', '--track-dir', copy], work)
  steps.push({ step: 'demand number --number 1', rc: number.rc })

  const after = ownerTable(run, copy, work)
  const absolutePhrase = after.stdout.includes('Aucune décision en attente.')
  const absoluteReply = after.stdout.includes('Réponse : aucune décision en attente')
  steps.push({ step: 'report after', rc: after.rc, absolutePhrase, absoluteReply })

  const withoutOptionsAfter = unsettledWithoutOptions()
  steps.push({ step: 'decision ls (pending and deferred)', unsettledWithoutOptions: withoutOptionsAfter })

  // Run every command the refusal message quotes, as written, with its placeholders filled against a
  // second, still unnumbered demand: a quoted command that cannot run is a defect of the message.
  const second = run(['ingest', input, '--workspace', 'a3-replay', '--track-dir', copy], work)
  const secondId = second.stdout.trim().split('\n')[0] ?? ''
  const fill = { '<id>': secondId, '<demandId>': secondId, '<n>': '2', '<file.jsonl>': input, '<w>': 'a3-replay', '<dossier>': copy }
  const cited = [...before.stderr.matchAll(/`(track [^`]+)`/gu)].map((m) => m[1])
  let failing = 0
  for (const command of cited) {
    const argv = command.split(/\s+/u).slice(1).map((token) => fill[token] ?? token)
    if (!argv.includes('--track-dir')) argv.push('--track-dir', copy)
    const res = run(argv, work)
    if (res.rc !== 0) failing++
    steps.push({ step: `cited: ${command.replace(/[<>]/gu, '')}`, rc: res.rc, message: res.rc === 0 ? 'runs' : firstLine(res.stderr) })
  }

  return {
    label: journal.label,
    steps,
    hole: holeVerdict(after, absolutePhrase, withoutOptionsAfter),
    citedCommands: cited.length,
    citedCommandsFailing: failing,
    afterStdout: after.stdout,
  }
}

/**
 * yes: the table renders and states that nothing is pending while such a decision exists.
 * no: the table renders without that statement, or refuses BECAUSE of that decision.
 * not observable: the table refuses for other gaps, which hides the hole either way.
 */
function holeVerdict(after, absolutePhrase, withoutOptions) {
  if (withoutOptions === 0) return 'not observable (no unsettled decision without options left)'
  if (after.rc === 0) return absolutePhrase ? 'yes' : 'no'
  const refusesTheDecision = /must carry a question, at least 2 options/u.test(after.stderr)
  return refusesTheDecision ? 'no (the table now refuses because of that decision)' : 'not observable (the table refuses for other gaps)'
}

function firstLine(text) {
  return (text.split('\n').find((l) => l.trim() !== '') ?? '').replace(/<[^>]*>/gu, '<…>').slice(0, 100)
}

function countIds(events) {
  const counts = new Map()
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1)
  return counts
}

function compareA4(run, main, copy) {
  const mainBefore = fingerprint(main.trackDir)
  const copyBefore = fingerprint(copy.trackDir)
  const a = readEvents(main.trackDir).events
  const b = readEvents(copy.trackDir).events
  // Event LINES, not distinct ids: a journal may hold the same event id on several lines, and the
  // figures of measurement A4 are line counts. Common lines = multiset intersection of the two id lists.
  const mainCounts = countIds(a)
  const copyCounts = countIds(b)
  let common = 0
  for (const [id, n] of mainCounts) common += Math.min(n, copyCounts.get(id) ?? 0)
  const last = (events) => events.reduce((m, e) => (typeof e.at === 'string' && e.at > m ? e.at : m), '')
  const mainAggregates = new Set(a.map((e) => e.aggregateId))
  const copyPending = decisionStats(run, copy.trackDir, dirname(copy.trackDir), 'pending')
  return {
    main: main.label,
    copy: copy.label,
    mainEvents: a.length,
    copyEvents: b.length,
    common,
    onlyMain: a.length - common,
    onlyCopy: b.length - common,
    mainDuplicateIdLines: a.length - mainCounts.size,
    copyDuplicateIdLines: b.length - copyCounts.size,
    mainLastAt: last(a),
    copyLastAt: last(b),
    copyPendingDecisions: copyPending.count,
    copyPendingAbsentFromMain: copyPending.ids.filter((d) => !mainAggregates.has(d.id)).length,
    unchanged: mainBefore === fingerprint(main.trackDir) && copyBefore === fingerprint(copy.trackDir),
  }
}

// ---- rendering ---------------------------------------------------------------------------------

const day = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '—')

function table(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const r of rows) out.push(`| ${r.join(' | ')} |`)
  return out.join('\n')
}

function renderMd(result, opts) {
  const lines = []
  lines.push(`# Owner-table measurement`)
  lines.push('')
  lines.push(`track ${result.trackVersion} · node ${process.version} · ${result.measuredAt}`)
  if (result.a1) {
    lines.push('', '## A1 — journals', '')
    lines.push(
      table(
        ['Journal', 'Events', 'demand.*', 'Pending (no options)', 'Deferred (no options)', 'Open dossier questions', 'Exit', 'Violations', 'First violation', 'Validate', 'OWNER GATE', 'Workspace labels', 'Last event', 'Unchanged'],
        result.a1.rows.map((r) => [
          r.label,
          r.events,
          r.demandEvents,
          `${r.pending.count} (${r.pending.noOptions})`,
          `${r.deferred.count} (${r.deferred.noOptions})`,
          r.pending.openQuestions + r.deferred.openQuestions,
          r.report.rc,
          r.report.renders ? '0, renders' : r.report.violations,
          r.report.firstCode || '—',
          r.validate.integrity === undefined ? `rc=${r.validate.rc}` : r.validate.integrity + r.validate.desync === 0 ? 'clean' : `${r.validate.integrity} integrity + ${r.validate.desync} desync`,
          r.ownerGateLines,
          r.workspaceLabels,
          day(r.lastEventAt),
          r.unchanged ? 'yes' : 'NO',
        ]),
      ),
    )
    const s = result.a1.summary
    lines.push('')
    lines.push(`- Journals: ${s.journals} · refuse: ${s.refuse} · render: ${s.render} · with \`demand.*\` events: ${s.withDemandEvents}`)
    lines.push(`- First violation of the refusals: ${Object.entries(s.firstViolationCodes).map(([k, v]) => `[${k}] × ${v}`).join(', ') || '—'}`)
    lines.push(`- Unsettled decisions: ${s.unsettledDecisions} in ${s.journalsWithUnsettled} journals — ${s.unsettledWithOptions} with options, ${s.unsettledWithoutOptions} without`)
    lines.push(`- Unanswered dossier questions (pending and deferred decisions): ${s.openDossierQuestions}`)
    lines.push(`- \`OWNER GATE\` occurrences: ${s.ownerGateLines}`)
    lines.push(`- Journals holding the same event id on several lines: ${s.journalsWithDuplicateIds.join(', ') || 'none'}`)
    if (s.oldestUnsettled) {
      lines.push(`- Oldest unsettled decision: created ${s.oldestUnsettled.at} (${s.oldestUnsettled.label}, ${s.oldestUnsettled.outcome}, ${s.oldestUnsettled.optionCount} option(s))`)
    }
    lines.push(`- Fingerprints identical before and after: ${s.allUnchanged ? 'yes, all journals' : 'NO — see the Unchanged column'}`)
    if (opts.showPaths) {
      lines.push('', table(['Journal', 'Path'], result.a1.paths.map((p) => [p.label, p.trackDir])))
    }
  }
  if (result.a2) {
    lines.push('', '## A2 — how recorded demands were captured', '')
    if (result.a2.length === 0) lines.push('No measured journal holds a `demand.raised` event.')
    for (const j of result.a2) {
      lines.push(`**${j.label}** — ${j.demandRaised} \`demand.raised\` between ${j.firstAt} and ${j.lastAt} (${j.spanSeconds} s)`)
      lines.push(`- text identical to title: ${j.textEqualsTitle} of ${j.demandRaised} · text length: ${j.textLengthMin} to ${j.textLengthMax} characters`)
      lines.push(`- transport: ${j.transports.join(', ')} · with an idempotency key: ${j.withIdempotencyKey} of ${j.demandRaised}`)
      lines.push(`- \`demand.*\` events by type: ${Object.entries(j.demandEventsByType).map(([k, v]) => `${k} × ${v}`).join(', ')}`)
      lines.push('')
    }
  }
  if (result.a3) {
    lines.push('', '## A3 — fail-open hole replayed on a disposable copy', '')
    const a3 = result.a3
    if (a3.skipped) {
      lines.push(`Skipped (${a3.label}): ${a3.skipped}.`)
    } else {
      lines.push(table(['Step', 'Observed'], a3.steps.map((s) => [s.step, Object.entries(s).filter(([k]) => k !== 'step').map(([k, v]) => `${k}=${v}`).join(' · ')])))
      lines.push('')
      lines.push(`- Hole reproduced (exit 0 and the absolute sentence while an unsettled decision without options exists): **${a3.hole}**`)
      lines.push(`- Commands quoted by the refusal message that fail as written: **${a3.citedCommandsFailing} of ${a3.citedCommands}**`)
      lines.push('', '```text', a3.afterStdout.trimEnd(), '```')
    }
    if (a3.cleanup) {
      lines.push(`- Copy removed: ${a3.cleanup.copyRemoved ? 'yes' : 'NO'} · source journal unchanged: ${a3.cleanup.sourceUnchanged ? 'yes' : 'NO'}`)
    }
  }
  if (result.a4) {
    lines.push('', '## A4 — divergent copies (event lines)', '')
    if (result.a4.length === 0) lines.push('No pair requested (`--a4 <main> <copy>`).')
    else {
      lines.push(
        table(
          ['Main', 'Copy', 'Main events', 'Copy events', 'Common', 'Only in main', 'Only in copy', 'Duplicate-id lines (main / copy)', 'Last event (main)', 'Last event (copy)', 'Pending in copy', 'Pending in copy absent from main', 'Unchanged'],
          result.a4.map((p) => [p.main, p.copy, p.mainEvents, p.copyEvents, p.common, p.onlyMain, p.onlyCopy, `${p.mainDuplicateIdLines} / ${p.copyDuplicateIdLines}`, day(p.mainLastAt), day(p.copyLastAt), p.copyPendingDecisions, p.copyPendingAbsentFromMain, p.unchanged ? 'yes' : 'NO']),
        ),
      )
    }
  }
  return lines.join('\n') + '\n'
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const run = makeRunner(opts.trackBin)
  const journals = loadJournals(opts)
  const version = run(['--version'], process.cwd())
  const result = {
    trackVersion: version.stdout.trim() || `unknown (rc=${version.rc})`,
    measuredAt: new Date().toISOString(),
  }
  let changed = false

  if (opts.only.has('A1')) {
    if (journals.length === 0) usage('A1 needs at least one journal (--journals <file> or --journal <dir>)')
    const rows = journals.map((j) => measureA1(run, j))
    result.a1 = { rows, summary: summarizeA1(rows), ...(opts.showPaths ? { paths: journals } : {}) }
    if (!result.a1.summary.allUnchanged) changed = true
  }
  if (opts.only.has('A2')) {
    result.a2 = journals.map((j) => measureA2(j)).filter((x) => x !== undefined)
  }
  if (opts.only.has('A3') && opts.a3 !== undefined) {
    const target = lookup(journals, opts.a3)
    const a3 = replayA3(run, target, opts.scratch, journals)
    if (a3.cleanup && !a3.cleanup.sourceUnchanged) changed = true
    result.a3 = a3
  }
  if (opts.only.has('A4')) {
    result.a4 = opts.a4.map(([m, c]) => compareA4(run, lookup(journals, m), lookup(journals, c)))
    if (result.a4.some((p) => !p.unchanged)) changed = true
  }

  process.stdout.write(opts.format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : renderMd(result, opts))
  if (changed) {
    process.stderr.write(
      'owner-table-measure: a measured journal changed during the run (this script, or a concurrent writer of that journal). Re-run on a quiet journal before trusting the figures.\n',
    )
    return 3
  }
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  if (error instanceof UsageError) {
    if (error.message) process.stderr.write(`owner-table-measure: ${error.message}\n`)
    process.stderr.write(
      'usage: node scripts/owner-table-measure.mjs --track-bin <track/dist/cli/bin.js> [--journals <file>] [--journal [label=]<dir>]... ' +
        '[--a3 <label|dir> --scratch <dir>] [--a4 <main> <copy>]... [--only A1,A2,A3,A4] [--format md|json] [--show-paths]\n',
    )
    process.exitCode = 2
  } else {
    process.stderr.write(`owner-table-measure: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = error?.exitCode ?? 4
  }
}
