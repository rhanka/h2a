// Lot 2 (D10, P3) — any user language, nothing language-specific hardcoded.
//
// Identical structured demand data in Spanish, Japanese and Arabic, without
// an owner-quote marker, yields identical ids, attachment, stage, status,
// gates and option identities. Translation changes no order, period,
// percentages, handles or selectable options; dossier matching uses original
// ids/data, never translations. Structured audits stay identical across
// locales: a translated focus placeholder remains uninstructed, and a
// translated gate-class action remains a gate-class violation because its
// kind/step code is unchanged.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { reportText } from '../read/commands.js'
import { TrackReader } from '../read/contract.js'
import { Track } from '../track.js'
import {
  auditNextActions,
  describeRowNextActions,
  type NextActionAuditDescriptor,
} from './format.js'
import { resolveStageStatusLabels } from './stage-status-lexicon.js'

let dir: string
let store: EventStore
let track: Track

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-owner-language-'))
  store = new EventStore(join(dir, 'events.jsonl'))
  track = new Track(store, { by: 'language-fixture', now: () => '2026-10-18T12:00:00.000Z' })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const DEMANDS = {
  es: 'Quiero reanudar mi sesión donde la dejé',
  ja: 'セッションを中断したところから再開したい',
  ar: 'أريد استئناف جلستي من حيث توقفت',
} as const

/** Same structure in every language: one demand promoted to one item, one answerable dossier. */
function seed(request: string): { itemId: string; decisionId: string } {
  // An (empty) WP root keeps the conductor forest non-empty so the served
  // report carries the view; the item itself stays parentless (outside-wp).
  track.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
  const demand = track.raiseDemand({
    type: 'feature', workspace: 'ws', raw: { text: request }, source: { kind: 'human' }, handler: 'h',
  })
  track.claimDemand(demand, { handler: 'h' })
  const [promoted] = track.agreeDemand(demand, { items: [{ title: 'technical title', links: [{ kind: 'pr-open', locator: 'https://example.test/pr/7' }] }] })
  const itemId: string = promoted!
  const decisionId = track.createDecision({
    decisionKind: 'commitment', title: 'Share ?', workspace: 'ws', targets: [itemId],
    dossier: {
      context: 'Connection choice.', qa: [], readability: { readingBudgetMinutes: 2 },
      options: [
        { id: 'a', title: 'Share', summary: 'One connection' },
        { id: 'b', title: 'Isolate', summary: 'Two connections' },
      ],
      recommendation: { optionId: 'a', rationale: 'Fewer connections' },
      artifacts: [{ kind: 'rendered-view', viewRef: 'https://example.test/dossier/native' }],
    },
  })
  track.setRealization(itemId, 'in-progress')
  track.openBlocker({ targetId: itemId, kind: 'decision', ref: decisionId, reason: 'pending choice' })
  return { itemId, decisionId }
}

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const code = runCli(['--track-dir', dir, ...args], { cwd: dir, out: (s) => { out += s }, err: (s) => { err += s } })
  expect(typeof code).toBe('number')
  return { code: code as number, out, err }
}

describe('the deterministic layer is language-neutral', () => {
  it.each(['es', 'ja', 'ar'] as const)('identical structure in %s yields identical machine facts', (lang) => {
    // Amendment D1 — the single validated report serves every language; the
    // machine facts below are identical whatever the demand prose says.
    const { itemId, decisionId } = seed(DEMANDS[lang])
    const parsed = JSON.parse(
      cli(['report', '--status-table', '--commit', 'c1', '--format', 'json']).out,
    ) as {
      buckets: Record<string, Array<{ id: string; stage?: string; status?: string; wpId?: string }>>
      view: {
        handles: Array<{ handle: string; id: string }>
        tables: Array<{ id: string; rows: Array<Record<string, string>> }>
      }
    }
    const rows = Object.values(parsed.buckets).flat()
    const row = rows.find((candidate) => candidate.id === itemId)!
    expect(row).toMatchObject({ stage: 'pr', status: 'decision-awaited' })
    // Attachment rides on ancestry, not language: no WP ancestor here, identically.
    expect(row.wpId).toBeUndefined()
    // Dossier matching uses original ids/data, never translations.
    expect(parsed.view.handles.some((handle) => handle.id === decisionId)).toBe(true)
    const decisions = parsed.view.tables.find((table) => table.id === 'decisions')!
    expect(JSON.stringify(decisions)).toContain('Share ?')
    // Same set and order in every language.
    expect(parsed.view.tables.map((table) => table.id)).toEqual(['done', 'todo', 'decisions', 'recommendation'])
  })

  it('an unprepared language renders codes in the new surface with no closed enum', () => {
    seed(DEMANDS.es)
    const labels = resolveStageStatusLabels('xx')
    expect(labels.matched).toBe(false)
    const coded = cli(['report', '--status-table', '--commit', 'c1', '--lang', 'xx', '--format', 'text'])
    expect(coded.code, coded.err).toBe(0)
    // The blue row's code identity survives verbatim; no language is refused.
    expect(coded.out).toContain('decision-awaited')
  })

  it('changing only the output language changes no ids, order, period, percentages, handles or options', () => {
    seed(DEMANDS.ja)
    const base = ['report', '--status-table', '--commit', 'c1', '--now', '2026-10-18T12:00:00.000Z', '--format', 'json']
    const fr = JSON.parse(cli(base).out) as {
      buckets: Record<string, Array<Record<string, unknown>>>
      view: { handles: unknown; header: { period: unknown; progress: unknown } }
    }
    const ja = JSON.parse(cli([...base, '--lang', 'ja']).out) as typeof fr
    const ids = (report: typeof fr): unknown[] =>
      Object.values(report.buckets).flat().map((row) => row['id'])
    const statuses = (report: typeof fr): unknown[] =>
      Object.values(report.buckets).flat().map((row) => row['status'])
    expect(ids(ja)).toEqual(ids(fr))
    expect(statuses(ja)).toEqual(statuses(fr))
    expect(ja.view.handles).toEqual(fr.view.handles)
    expect(ja.view.header.period).toEqual(fr.view.header.period)
    expect(ja.view.header.progress).toEqual(fr.view.header.progress)
  })
})

describe('structured audits are identical across locales', () => {
  const FOCUS_PLACEHOLDERS = [
    'à instruire : ouvrir l’item et nommer le geste',
    'por instruir: abrir el elemento y nombrar el gesto',
    'アイテムを開いて手順を指定すること',
    'يجب التوجيه: افتح العنصر وحدد الإجراء',
  ] as const

  it.each(FOCUS_PLACEHOLDERS)('a translated focus placeholder %s remains uninstructed', (placeholder) => {
    // A plain string without audit metadata cannot certify an investigated action.
    const descriptors: NextActionAuditDescriptor[] = [
      { focus: true, instruction: 'investigated', action: placeholder },
    ]
    expect(auditNextActions(descriptors).uninstructed).toBe(1)
  })

  it('a translated gate-class action remains a violation through its kind/step code', () => {
    const translatedGateAction = 'acción (subagente): redactar la especificación'
    const audit = auditNextActions([
      {
        focus: true,
        instruction: 'investigated',
        action: translatedGateAction,
        actionOrigin: 'gate-class',
        gateSteps: ['amend-spec'],
      },
      {
        focus: false,
        instruction: 'investigated',
        action: 'Abrir run.ts y nombrar el gesto concreto',
        actionOrigin: 'investigated',
        gateSteps: [],
      },
    ])
    expect(audit.gateClauses).toEqual([translatedGateAction])
    expect(audit.ok).toBe(false)
  })

  it('all locale variants produce identical audit facts for the same states', () => {
    const states = FOCUS_PLACEHOLDERS.map((placeholder) => ({
      focus: true,
      instruction: 'investigated' as const,
      action: placeholder,
    }))
    const audits = states.map((state) => auditNextActions([state]))
    for (const audit of audits) {
      expect(audit).toEqual({ uninstructed: 1, repeated: [], gateClauses: [], ok: true })
    }
  })

  it('the served report requires both uninstructed = 0 and ok = true', () => {
    const served = (descriptors: NextActionAuditDescriptor[]): boolean => {
      const audit = auditNextActions(descriptors)
      return audit.uninstructed === 0 && audit.ok === true
    }
    expect(served([{ focus: true, instruction: 'to-instruct' }])).toBe(false)
    expect(served([
      { focus: true, instruction: 'investigated', action: 'a', actionOrigin: 'investigated' },
      { focus: true, instruction: 'investigated', action: 'a', actionOrigin: 'investigated' },
      { focus: true, instruction: 'investigated', action: 'a', actionOrigin: 'investigated' },
    ])).toBe(false)
    expect(served([
      { focus: true, instruction: 'investigated', action: 'Ouvrir run.ts et nommer le geste', actionOrigin: 'investigated' },
      { focus: false, instruction: 'not-instructed' },
    ])).toBe(true)
  })

  it('deterministic renderer markers describe owed work, never violations', () => {
    const seedTrack = new Track(new EventStore(join(dir, 'events.jsonl')), {
      by: 'language-fixture',
      now: () => '2026-10-18T12:00:00.000Z',
    })
    const wp = seedTrack.createItem({ kind: 'chore', title: 'WP', workspace: 'ws', role: 'workpackage' })
    seedTrack.createItem({ kind: 'chore', title: 'open work', workspace: 'ws', parentId: wp })
    const view = JSON.parse(
      reportText(new TrackReader(join(dir, 'events.jsonl')), { baselineCommit: 'c1', decisions: true, wpTree: true }, 'json', '2026-10-18T12:00:00.000Z'),
    ).view as { tables: Array<{ id: string; rows: Array<Record<string, string>> }> }
    const todo = view.tables.find((table) => table.id === 'todo')!
    const audit = auditNextActions(describeRowNextActions(todo.rows))
    expect(audit.uninstructed).toBeGreaterThan(0)
    expect(audit.ok).toBe(true)
  })
})
