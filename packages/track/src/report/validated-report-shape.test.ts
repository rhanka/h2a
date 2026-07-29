// The shape the owner validated — `docs/specs/examples/track-report-contextual.md`, as constrained by
// `docs/specs/2026-07-29-track-report-period.md` and its two corrections.
//
// Every test below names the criterion it closes. Where the correction and the original 15 conflict, the
// correction wins: 10 is split into 10a/10b/10c, 14 is scoped, 15 is replaced by 15a/15b/15c, 17 is
// compactness-accounting rather than completeness, and 16/18/19 are the anti-fabrication floor.
//
// These tests bind the RENDERER. They cannot bind a cold agent reading the skill — that is stated in the
// skill itself and repeated here so nobody quotes this file as proof of a guarantee it cannot give.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import type { DecisionRow, ReportRow } from './build.js'
import { buildWpConductorView, formatWpConductor, handleTokenRegex, type ReportView } from './format.js'
import { formatWpConductorHtml } from './html.js'
import { computeWpTree } from './rollup.js'
import { renderSnapshot } from './snapshot.js'
import { reportText, resolveHandle } from '../read/commands.js'
import { TrackReader } from '../read/contract.js'
import { runCli } from '../cli/index.js'

/** The ULID shape criterion 10a forbids in any column the owner reads. */
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/u

let dir: string
let eventsPath: string
let t: Track

const now = (): string => '2026-07-29T00:00:00.000Z'
const cfg = { baselineCommit: 'c1', requireAccepted: false }
const base = { baselineCommit: 'c1' as const, decisions: true, wpTree: true }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-validated-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  t = new Track(new EventStore(eventsPath), { by: 'human:x', now })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const wp = (title: string, parentId?: string): string =>
  t.createItem({ kind: 'chore', title, workspace: 'ws', role: 'workpackage', ...(parentId !== undefined ? { parentId } : {}) })
const leaf = (title: string, parentId: string): string =>
  t.createItem({ kind: 'chore', title, workspace: 'ws', parentId })
const done = (id: string): string => {
  t.setRealization(id, 'in-progress')
  t.setRealization(id, 'done')
  return id
}
const dossier = (options: { id: string; title: string; summary: string }[], recommended: string) => ({
  context: 'contexte enregistré',
  options,
  qa: [],
  recommendation: { optionId: recommended, rationale: 'raison enregistrée' },
})

/**
 * A representative forest: a closed WP, an open WP gated on a STRUCTURED dossier, an open WP gated on a
 * spec, a WP with nothing at all (the compression candidate), an unstructured dossier, and a row outside
 * the rollup. Every criterion below is checked against this one shape.
 */
function seed(): { blocked: string; structuredId: string } {
  const wp1 = wp('WP1 — Closed')
  done(leaf('livraison enregistrée', wp1))

  const wp2 = wp('WP2 — Gated')
  const blocked = t.createItem({ kind: 'feature', title: 'travail bloqué', workspace: 'ws', parentId: wp2 })
  const structuredId = t.createDecision({
    decisionKind: 'commitment',
    title: '1/6 — Un nom de session peut-il envoyer une commande ?',
    workspace: 'ws',
    targets: [blocked],
    dossier: dossier(
      [
        { id: 'never', title: 'Jamais', summary: 'racine résolue et vivante' },
        { id: 'unique', title: 'Oui si unique', summary: 'la résolution suffit' },
      ],
      'never',
    ),
  })

  const wp3 = wp('WP3 — Spec')
  leaf('à spécifier', wp3)

  wp('WP4 — Empty') // no leaf, no directive, no completion: the omission candidate

  t.createItem({ kind: 'feature', title: 'orphelin ouvert', workspace: 'ws' })
  done(t.createItem({ kind: 'feature', title: 'orphelin terminé', workspace: 'ws' }))
  return { blocked, structuredId }
}

const view = (): ReportView => {
  const report = new TrackReader(eventsPath).report(base)
  return buildWpConductorView(report.wpTree ?? [], report.decisions ?? [], report.outsideRollup, 'global', {
    baselineCommit: 'c0ffee1234567890',
  })
}
const text = (): string => reportText(new TrackReader(eventsPath), base, 'text')
const md = (): string => reportText(new TrackReader(eventsPath), base, 'md')
const html = (): string => {
  const report = new TrackReader(eventsPath).report(base)
  return formatWpConductorHtml(report.wpTree ?? [], report.decisions ?? [], undefined, report.outsideRollup)
}
const section = (v: ReportView, id: string) => v.tables.find((table) => table.id === id)!

describe('criterion 1 — the header carries the acceptance baseline, and no window it cannot support', () => {
  it('names the baseline, says the report covers the whole log, and never invents a period', () => {
    seed()
    const header = view().header
    expect(header.baselineCommit).toBe('c0ffee123456')
    expect(header.window).toContain('intégralité du journal')
    const rendered = formatWpConductor(computeWpTree(t.state(), cfg), 'text', [], [], 'global', {
      baselineCommit: 'c0ffee1234567890',
    })
    expect(rendered).toContain('baseline d’acceptance : c0ffee123456')
    // `--since`/`--until`/`--period` do not ship in this increment, so no named window may appear.
    expect(rendered).not.toMatch(/journée du|semaine du|période :/u)
  })

  it('carries no bucket counters', () => {
    seed()
    for (const rendered of [text(), md(), html()]) {
      expect(rendered).not.toMatch(/DONE \d+ · TO-DO \d+/u)
      expect(rendered).not.toMatch(/AWAITED \d+ · DROPPED \d+/u)
    }
  })
})

describe('criterion 2 — exactly four sections, same set and same order in all four formats', () => {
  it('json/text/md/html agree on FAIT · À-FAIRE · DÉCISIONS · RECOMMANDATION and carry nothing else', () => {
    seed()
    const v = view()
    expect(v.tables.map((table) => table.id)).toEqual(['done', 'todo', 'decisions', 'recommendation'])
    const titles = ['FAIT', 'À-FAIRE', 'DÉCISIONS', 'RECOMMANDATION']
    expect(v.tables.map((table) => table.title)).toEqual(titles)

    const order = (rendered: string): string[] =>
      titles.filter((title) => rendered.includes(title)).sort((a, b) => rendered.indexOf(a) - rendered.indexOf(b))
    expect(order(text())).toEqual(titles)
    expect(order(md())).toEqual(titles)
    expect(
      [...html().matchAll(/<section class="report-section" data-section="([a-z-]+)">/gu)].map((m) => m[1]),
    ).toEqual(['done', 'todo', 'decisions', 'recommendation'])

    for (const rendered of [text(), md(), html()]) {
      for (const removed of ['À-FAIRE SANS WP', 'HORS ROLLUP', 'À INSTRUIRE', 'HISTORIQUE NON STRUCTURÉ', 'ACTIONS DÉRIVÉES']) {
        expect(rendered).not.toContain(removed)
      }
    }
  })
})

describe('criteria 3/4 — FAIT names the last recorded actions, and declares its own compression', () => {
  it('the third column is `dernières actions`, never `constat`, never a restatement of the arithmetic', () => {
    seed()
    const fait = section(view(), 'done')
    expect(fait.columns.map((c) => c.label)).toEqual(['scope', 'avancement', 'dernières actions'])
    for (const row of fait.rows) {
      expect(row['lastActions']).not.toBe('agrégat de périmètre; pas une action')
      expect(row['lastActions']).not.toBe('WP clos (état enregistré)')
    }
    expect(fait.rows.map((r) => r['lastActions']).join(' ')).toContain('livraison enregistrée')
  })

  it('declares the compression instead of hiding a tail', () => {
    const w = wp('WP1 — Many')
    for (const n of ['a1', 'a2', 'a3', 'a4', 'a5']) done(leaf(n, w))
    const fait = section(buildWpConductorView(computeWpTree(t.state(), cfg)), 'done')
    expect(fait.rows[1]!['lastActions']).toMatch(/3 des 5 actions enregistrées/u)
  })
})

describe('criteria 5/6 — À-FAIRE has five columns, ordered by priority, and says so', () => {
  it('has exactly `WP · av. · à faire · bloqué · prochaine action` and no `cible action`', () => {
    seed()
    const todo = section(view(), 'todo')
    expect(todo.columns.map((c) => c.id)).toEqual(['wp', 'progress', 'todo', 'blocked', 'nextAction'])
    expect(todo.columns.map((c) => c.label)).toEqual(['WP', 'av.', 'à faire', 'bloqué', 'prochaine action'])
    expect(todo.columns.map((c) => c.id)).not.toContain('actionTarget')
    for (const rendered of [text(), md(), html()]) expect(rendered).not.toContain('cible action')
  })

  it('prints the ordering rule in every rendered format', () => {
    seed()
    for (const rendered of [text(), md(), html()]) {
      expect(rendered).toContain('ordre = priorité ; les cinq premiers sont le focus')
    }
  })

  it('puts the decision-gated rows first (canonical urgency), not tree order', () => {
    seed()
    const rows = section(view(), 'todo').rows
    expect(rows[0]!['blocked']).toMatch(/^D\d/u)
  })
})

describe('criteria 7/19 — `bloqué` points at the answer, and is empty ONLY when nothing is recorded', () => {
  it('names the D-number of the dossier that unblocks, never a restated question', () => {
    seed()
    const gated = section(view(), 'todo').rows.find((row) => row['todo'].includes('travail bloqué'))!
    expect(gated['blocked']).toBe('D1')
    expect(gated['blocked']).not.toContain('En attente d’une décision')
    expect(gated['blocked']).not.toContain('?')
  })

  it('a recorded gate NEVER renders as `—`, and `—` is reserved for "no blockage recorded"', () => {
    seed()
    for (const row of section(view(), 'todo').rows) {
      const hasGate = (row['gateDetail'] ?? '') !== ''
      if (hasGate) expect(row['blocked'], `gate recorded on ${row['wp']}`).not.toBe('—')
      else expect(row['blocked'], `no gate on ${row['wp']}`).toBe('—')
    }
  })
})

describe('criterion 8 — `prochaine action` names its executor', () => {
  it('carries the routing executor; the model comes from owner context, which the log does not hold', () => {
    seed()
    const acting = section(view(), 'todo').rows.filter((row) => row['nextAction'] !== '—')
    expect(acting.length).toBeGreaterThan(0)
    for (const row of acting) expect(row['nextAction']).toMatch(/^(action|engagement) \((subagent|local|h2a)\)/u)
    // The log records no model or reasoning effort; the renderer must not invent one.
    expect(JSON.stringify(section(view(), 'todo').rows)).not.toMatch(/xhigh|sol |terra /u)
  })
})

describe('criteria 9/16 — DÉCISIONS is a drawn, numbered table and never invents an alternative', () => {
  it('draws `# · sujet · alternatives · préco`, numbers D1…Dn, and puts the préco on its option line', () => {
    seed()
    const decisions = section(view(), 'decisions')
    expect(decisions.render).toBe('drawn')
    expect(decisions.columns.map((c) => c.label)).toEqual(['#', 'sujet', 'alternatives', 'préco'])
    const rendered = text()
    expect(rendered).toContain('┌')
    expect(decisions.rows[0]!['n']).toBe('D1')
    expect(decisions.rows[0]!['alternatives']).toContain('A Jamais — racine résolue et vivante')
    expect(decisions.rows[0]!['alternatives']).toContain('B Oui si unique — la résolution suffit')
    // The recommendation letter sits on the line of ITS OWN option (index 0 here, not a continuation).
    const altLines = decisions.rows[0]!['alternatives']!.split('\n')
    const precoLines = decisions.rows[0]!['preco']!.split('\n')
    expect(altLines[0]).toContain('A Jamais')
    expect(precoLines[0]).toBe('A')
    expect(precoLines.slice(1, altLines.findIndex((l) => l.startsWith('B ')))).toEqual(
      altLines.slice(1, altLines.findIndex((l) => l.startsWith('B '))).map(() => ''),
    )
    // ...and the same alignment survives the terminal render.
    const lines = rendered.split('\n')
    const optionLine = lines.find((line) => line.includes('A Jamais'))!
    expect(optionLine).toMatch(/A\s+│$/u)
    const otherLine = lines.find((line) => line.includes('B Oui si unique'))!
    expect(otherLine).not.toMatch(/\b[AB]\s+│$/u)
  })

  it('an unstructured dossier reserves no D-number, carries no letters, and reads `à structurer`', () => {
    seed()
    const report = new TrackReader(eventsPath).report(base)
    const unstructured: DecisionRow = {
      id: 'legacy-1', title: 'Dossier sans options', workspace: 'ws', decisionKind: 'orientation',
      realization: 'to-do', outcome: 'pending', structured: false,
    }
    const v = buildWpConductorView(report.wpTree ?? [], [...(report.decisions ?? []), unstructured], report.outsideRollup)
    const legacy = section(v, 'decisions').rows.find((row) => row['subject'] === 'Dossier sans options')!
    expect(legacy['n']).toMatch(/^Q\d+$/u)
    expect(legacy['alternatives']).toBe('non enregistrées')
    expect(legacy['preco']).toBe('à structurer')
    // ...and it is NOT offered in the reply line.
    expect(section(v, 'recommendation').lines!.at(-1)).not.toContain(legacy['n']!)
  })

  it('with zero structured pending dossiers, RECOMMANDATION says so verbatim and invites no letter', () => {
    const w = wp('WP1')
    leaf('travail', w)
    const rendered = formatWpConductor(computeWpTree(t.state(), cfg), 'text', [
      { id: 'legacy', title: 'Sans options', workspace: 'ws', decisionKind: 'orientation', realization: 'to-do', outcome: 'pending', structured: false },
    ])
    expect(rendered).toContain('Aucun D# disponible : aucun dossier structuré sélectionnable dans le journal.')
    expect(rendered).not.toMatch(/« D1 [A-Z]/u)
  })
})

describe('criterion 10a — no ULID in any column the owner reads, in every format', () => {
  it('text, Markdown and HTML table bodies are ULID-free', () => {
    seed()
    for (const [format, rendered] of [['text', text()], ['md', md()], ['html', html()]] as const) {
      // The resolution block is the machine's half of the page (10b) and is the ONE place an id lives.
      const body = rendered.split(/RÉSOLUTION DES HANDLES|report-resolution/u)[0]!
      expect(ULID.test(body), `${format} body carries a ULID`).toBe(false)
    }
  })

  it('every declared column value of the JSON view is ULID-free', () => {
    seed()
    for (const table of view().tables) {
      for (const row of table.rows) {
        for (const column of table.columns) {
          expect(ULID.test(row[column.id] ?? ''), `${table.id}.${column.id}`).toBe(false)
        }
      }
    }
  })
})

describe('criteria 10b/10c — the identifier is relocated, not removed', () => {
  it('every actionable row carries a positional `[n.m]` handle', () => {
    seed()
    section(view(), 'todo').rows.forEach((row, index) => {
      if (row['todo'] === '') return
      expect(row['todo']).toContain(`[${index + 1}.1]`)
    })
  })

  it('the report ends with a resolution block mapping each handle to its item id and naming the command', () => {
    seed()
    const v = view()
    expect(v.handles.length).toBeGreaterThan(0)
    // The block is machine-facing in every format: `md` fences it (no backslash escaping) and `html`
    // uses ordinary entity encoding, which any HTML consumer decodes. Both are checked, not assumed.
    for (const [format, rendered] of [['text', text()], ['md', md()]] as const) {
      const block = rendered.slice(rendered.indexOf('RÉSOLUTION DES HANDLES'))
      expect(block, format).toContain('track report --resolve <handle>')
      for (const handle of v.handles) expect(block, format).toContain(`${handle.handle}\t${handle.id}`)
      expect(block, format).not.toMatch(/\\[[\]<>]/u)
    }
    const htmlBlock = html().slice(html().indexOf('report-resolution'))
    expect(htmlBlock).toContain('track report --resolve &lt;handle&gt;')
    for (const handle of v.handles) expect(htmlBlock).toContain(handle.id)
  })

  it('yields the SAME handle set in text, Markdown and HTML — a handle is machine-readable in all three', () => {
    seed()
    // The defect this pins: `md` escaped every handle to `\\[1.1\\]`, so a consumer parsing the Markdown
    // for a handle found NONE, while text and html carried 61. It rendered fine and broke the documented
    // report-row → `--resolve` path in exactly one format. Per-format expectations missed it; comparing
    // the formats against EACH OTHER is what catches it.
    const extract = (rendered: string): string[] => {
      const body = rendered.split(/RÉSOLUTION DES HANDLES|report-resolution/u)[0]!
      return [...body.matchAll(handleTokenRegex())].map((m) => m[0]).sort()
    }
    const perFormat = { text: extract(text()), md: extract(md()), html: extract(html()) }
    expect(perFormat.text.length).toBeGreaterThan(0)
    expect(perFormat.md).toEqual(perFormat.text)
    expect(perFormat.html).toEqual(perFormat.text)
    // ...and no format smuggles them in backslash-escaped instead.
    for (const [format, rendered] of Object.entries({ text: text(), md: md(), html: html() })) {
      expect(rendered, `${format} escapes a handle`).not.toMatch(/\\\[\d+\.\d+\\\]/u)
    }
  })

  it('the handle exemption does not weaken title escaping, and is not an injection route', () => {
    const w = wp('WP1')
    // A title that MIMICS a handle and then tries to complete a markdown link with it.
    leaf('[9.9](https://evil.example) **gras**', w)
    const rendered = formatWpConductor(computeWpTree(t.state(), cfg), 'md')
    const body = rendered.slice(0, rendered.indexOf('RÉSOLUTION DES HANDLES'))
    expect(body).toContain('\\*\\*gras\\*\\*') // titles are still escaped
    expect(body).toContain('\\(https') // the link parens a `[x](y)` needs are still escaped
    expect(body).not.toContain('](https://evil.example)') // so no link can form
    expect(body).toContain('[1.1]') // ...while the real handle is still verbatim
  })

  it('a title carrying a code fence cannot break out of the machine blocks in md', () => {
    const w = wp('WP1')
    leaf('```\n# INJECTED', w)
    const rendered = formatWpConductor(computeWpTree(t.state(), cfg), 'md')
    const block = rendered.slice(rendered.indexOf('RÉSOLUTION DES HANDLES'))
    // The fence around a machine block is chosen longer than any backtick run inside it, so the block
    // still closes where the renderer says it closes.
    const fences = rendered.split('\n').filter((line) => /^`{3,}$/u.test(line))
    expect(fences.length % 2).toBe(0)
    const resolutionFence = fences[fences.length - 1]!
    expect(resolutionFence.length).toBeGreaterThan(3) // the block carries a ``` run, so ``` would not hold
    // Exactly one occurrence inside the block: the CLOSING fence, and it is the block's last line.
    const blockLines = block.split('\n').filter((line) => line.trim() !== '')
    expect(blockLines.filter((line) => line === resolutionFence)).toHaveLength(1)
    expect(blockLines[blockLines.length - 1]).toBe(resolutionFence)
    expect(block).toContain('# INJECTED') // the content is preserved verbatim, inside the fence
    expect(rendered.split('\n').some((line) => line.startsWith('# INJECTED'))).toBe(false)
  })

  it('states that handles are per-report, so a reply quoting one without its report is not actionable', () => {
    seed()
    for (const rendered of [text(), md(), html()]) {
      expect(rendered).toContain('n’est pas actionnable')
    }
  })

  it('resolves a handle back to its item through the one documented command', () => {
    seed()
    const first = view().handles[0]!
    const out = resolveHandle(new TrackReader(eventsPath), base, first.handle)
    expect(out).toContain(first.id)
    expect(resolveHandle(new TrackReader(eventsPath), base, 'nope')).toContain('handle introuvable')

    // ...and the CLI really exposes it, so the sentence the report prints is not a promise on paper.
    const out2: string[] = []
    const err: string[] = []
    const io = { cwd: dir, out: (s: string) => out2.push(s), err: (s: string) => err.push(s) }
    expect(runCli(['report', '--resolve', first.handle, '--commit', 'c1'], io)).toBe(0)
    expect(out2.join('')).toContain(first.id)
    expect(runCli(['report', '--help'], io)).toBe(0)
    expect(out2.join('')).toContain('--resolve <handle>')
  })
})

describe('criteria 11/12 — subjects and WP labels are short, and never a stored title pasted whole', () => {
  it('drops the enumeration counter a stored decision title carries', () => {
    seed()
    const subjects = section(view(), 'decisions').rows.map((row) => row['subject'])
    expect(subjects).toContain('Un nom de session peut-il envoyer une commande ?')
    expect(subjects.join(' ')).not.toContain('1/6 —')
  })

  it('renders a WP as `WPn · short name`, with the redundant stored prefix stripped', () => {
    seed()
    for (const row of section(view(), 'todo').rows) {
      if (row['wp']!.startsWith('hors WP')) continue
      expect(row['wp']).toMatch(/^(WP|S)[\d.]*[a-z]? · /iu)
      expect(row['wp']).not.toMatch(/WP\d+ — /u)
    }
  })
})

describe('criterion 13 — RECOMMANDATION is restored, with a single reply line', () => {
  it('states what starts with no answer, what each answer unblocks, and one reply line', () => {
    seed()
    const lines = section(view(), 'recommendation').lines!
    expect(lines[0]).toMatch(/^Sans décision : /u)
    expect(lines.some((line) => /^D1 A → débloque /u.test(line))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^Réponds « vas y »/u)
    expect(lines[lines.length - 1]).toContain('D1 A')
    for (const rendered of [text(), md(), html()]) expect(rendered).toContain('RECOMMANDATION')
  })
})

describe('criterion 14 (scoped) — a row with open work carries a next action UNLESS a decision gates it', () => {
  it('every open row either has a `prochaine action` or a D-number in `bloqué`', () => {
    seed()
    for (const row of section(view(), 'todo').rows) {
      if (row['todo'] === '') continue
      const gatedOnDecision = /^[DQ]\d/u.test(row['blocked'] ?? '')
      expect(row['nextAction'] !== '—' || gatedOnDecision, `row ${row['wp']}`).toBe(true)
    }
  })
})

describe('criteria 15a/15c — the deterministic layer is reproducible and declares its input', () => {
  it('two runs over the same log and baseline produce identical bytes', () => {
    seed()
    expect(text()).toBe(text())
    expect(md()).toBe(md())
    expect(html()).toBe(html())
  })

  it('names the deterministic projection as its source; the other two inputs belong to the synthesis', () => {
    seed()
    expect(view().header.sources).toEqual(['projection déterministe du journal (track report --wp --decisions)'])
    for (const rendered of [text(), md(), html()]) expect(rendered).toContain('sources : projection déterministe')
  })
})

describe('criteria 17/18 — compression is declared; open work and pending dossiers are never omitted', () => {
  it('states both counts, and the two numbers reconcile with what was omitted', () => {
    seed()
    const v = view()
    expect(v.coverage.projected).toBeGreaterThan(v.coverage.rendered)
    expect(v.coverage.projected - v.coverage.rendered).toBe(v.coverage.omitted.length)
    // The coverage line is machine-facing too: it must read the same, unescaped, in all three formats.
    for (const rendered of [text(), md(), html()]) {
      expect(rendered).toMatch(/couverture : \d+ lignes projetées · \d+ rendues/u)
      expect(rendered).toMatch(/\d+ omise/u)
    }
  })

  it('only omits a WP with no open work, no recorded gate and no recorded completion', () => {
    seed()
    const v = view()
    expect(v.coverage.omitted).toEqual(['WP4 · Empty'])
  })

  it('every WP carrying open work appears, and every pending dossier appears', () => {
    const { structuredId } = seed()
    const v = view()
    const todo = section(v, 'todo').rows.map((row) => `${row['wp']} ${row['todo']}`).join('\n')
    expect(todo).toContain('WP2 · Gated')
    expect(todo).toContain('WP3 · Spec')
    expect(todo).toContain('orphelin ouvert') // a row outside the rollup is still open work
    const decisions = section(v, 'decisions').rows.map((row) => row['subject']).join('\n')
    expect(decisions).toContain('Un nom de session peut-il envoyer une commande ?')
    expect(v.handles.some((handle) => handle.id === structuredId)).toBe(true)
    // A completed row outside the rollup is restituted in FAIT rather than dropped.
    expect(section(v, 'done').rows.map((row) => row['lastActions']).join('\n')).toContain('orphelin terminé')
  })

  it('the raw projection carries the SAME two counts, so the header is checkable from `report --raw`', () => {
    seed()
    const snapshot = new TrackReader(eventsPath).snapshot({ baselineInput: 'c1', resolvedCommit: 'c1' })
    expect(snapshot.coverage).toEqual(view().coverage)
    const diagnostic = renderSnapshot(snapshot, 'text')
    expect(diagnostic).toMatch(/\d+ lignes projetées · \d+ rendues · \d+ omise/u)
  })

  it('a deletion cannot turn a criterion green: dropping the gated WP breaks 18, not 17', () => {
    seed()
    const report = new TrackReader(eventsPath).report(base)
    const pruned = (report.wpTree ?? []).filter((node) => !node.title.includes('Gated'))
    const deleted = buildWpConductorView(pruned, report.decisions ?? [], report.outsideRollup)
    const todo = section(deleted, 'todo').rows.map((row) => row['todo']).join('\n')
    expect(todo).not.toContain('travail bloqué') // the deletion is visible…
    // …and the pending dossier it hid is STILL rendered, so the report cannot pretend the gate is gone.
    expect(section(deleted, 'decisions').rows.some((row) => row['n'] === 'D1')).toBe(true)
  })
})

describe('the four formats stay one report', () => {
  it('a crafted title cannot inject markup into md or html', () => {
    const w = wp('WP1')
    leaf('**gras** [lien](x) <img src=y onerror=z>', w)
    expect(formatWpConductor(computeWpTree(t.state(), cfg), 'md')).toContain('\\*\\*gras\\*\\*')
    const fragment = formatWpConductorHtml(computeWpTree(t.state(), cfg))
    expect(fragment).not.toContain('<img src=y')
    expect(fragment).toContain('&lt;img src=y')
  })

  it('an outside-rollup row and a scope-less dossier are folded in, not exiled to their own section', () => {
    seed()
    const rows = section(view(), 'todo').rows.map((row) => row['wp'])
    expect(rows).toContain('hors WP · items')
    expect(view().tables.map((table) => table.id)).not.toContain('outside-rollup')
  })
})

describe('an empty log still renders the four sections', () => {
  it('never crashes and never claims a dossier it does not have', () => {
    const rendered = formatWpConductor([], 'text')
    for (const title of ['FAIT', 'À-FAIRE', 'DÉCISIONS', 'RECOMMANDATION']) expect(rendered).toContain(title)
    expect(rendered).toContain('aucun dossier enregistré')
    expect(rendered).toContain('Aucun D# disponible')
    expect(ULID.test(rendered)).toBe(false)
  })

  it('an outside-rollup-only repo keeps its rows visible', () => {
    const outside: ReportRow = {
      id: 'x', title: 'orphelin', kind: 'feature', workspace: 'ws', bucket: 'TO-DO',
      realization: 'to-do', acceptance: 'unknown', detail: { acceptanceLabel: 'recette non évaluée' },
    }
    const rendered = formatWpConductor([], 'text', [] as DecisionRow[], [outside])
    expect(rendered).toContain('orphelin')
  })
})

// ---- the skill must instruct the SAME shape the renderer emits ------------------------------------
// The skill is the only surface a cold agent reads, and nothing executes it. These assertions are the
// weakest rung of the ladder — a string check on a document — and they are stated as such: they prove the
// clause is PRESENT, never that an agent followed it.

describe('the skill instructs the shape this renderer emits', () => {
  const SKILL = join(__dirname, '..', '..', '..', 'h2a', 'skills', 'harness', 'track-report', 'SKILL.md')
  const skill = (): string => readFileSync(SKILL, 'utf8')

  it('mandates the four sections and forbids the five removed ones as top-level sections', () => {
    const s = skill()
    expect(s).toContain('**FAIT**, **À-FAIRE**, **DÉCISIONS**,\n**RECOMMANDATION**')
    expect(s).toMatch(/There is no `À-FAIRE SANS WP`, no\s+`HORS ROLLUP`, no `À INSTRUIRE`, no `HISTORIQUE NON STRUCTURÉ`, no `ACTIONS DÉRIVÉES`/u)
  })

  it('says `dernières actions`, not `constat`, and keeps the global-row clause', () => {
    const s = skill()
    expect(s).toContain('`scope · avancement · dernières actions`')
    expect(s).toContain('`agrégat de périmètre; pas une action` and `WP clos (état enregistré)` are both forbidden')
    expect(s).toContain('never turn its count into an accomplishment sentence')
  })

  it('states the five À-FAIRE columns, the ordering line, and the `bloqué` rule', () => {
    const s = skill()
    expect(s).toContain('`WP · av. · à faire · bloqué · prochaine action`')
    expect(s).toContain('There is no\n`cible action` column')
    expect(s).toContain('ordre = priorité ; les cinq premiers sont le focus')
    expect(s).toContain('An empty `bloqué` means no blockage is recorded.')
    expect(s).toContain('A recorded gate rendered `—` is a failure')
  })

  it('keeps the anti-fabrication clauses criteria 16, 17 and 15b restate', () => {
    const s = skill()
    // 16 — no invented alternative.
    expect(s).toContain('A `D` number is reserved for a dossier whose options AND recommendation are stored')
    expect(s).toContain('à structurer')
    expect(s).toContain('A report that prints alternatives absent from the log fails')
    // 17/18 — compress, never hide.
    expect(s).toContain('State both counts.')
    expect(s).toContain('every WP carrying open work, and every pending dossier')
    expect(s).toContain('Deleting a\n  row is never a way to turn a criterion green')
    // 15b — provenance of structured claims.
    expect(s).toContain('carries its\nprovenance and must be recomputable from input 1 or input 2')
    expect(s).toContain('A claim traceable to neither is a\nfabrication')
  })

  it('forbids a named window and states the handle contract (10a/10b/10c)', () => {
    const s = skill()
    expect(s).toContain('**Do not name a window**')
    expect(s).toContain('**No ULID appears in any column the owner reads.**')
    expect(s).toContain('[0-9A-HJKMNP-TV-Z]{26}')
    expect(s).toContain('report --resolve <handle>')
    expect(s).toContain('verbatim in text, Markdown and HTML')
    expect(s).toContain('Handles are **per-report and positional**')
    expect(s).toContain('is not actionable')
  })

  it('declares the three inputs of the contextual report', () => {
    const s = skill()
    expect(s).toContain('the deterministic projection')
    expect(s).toContain('the repository history over the window')
    expect(s).toContain('owner/session context')
  })

  it('still says plainly that it is advisory and that the tests do not bind an agent', () => {
    const s = skill()
    expect(s).toContain('This skill is **advisory**.')
    expect(s).toContain('The unit tests bind the *renderer*, not an agent reading this file.')
  })
})

// ---- the committed examples --------------------------------------------------------------------
// 15a asks for byte reproduction of the RAW example from a fresh clone at its named commit. That check
// needs `git show <sha>:.track/events.jsonl`, which a shallow CI checkout may not have, so it is NOT
// asserted here — the recipe is printed in the fixture header and must be run by hand. What IS asserted
// is the part that can drift silently: the committed fixture must still be the shape this renderer emits.

describe('the committed examples stay aligned with the renderer', () => {
  const example = (name: string): string =>
    readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'specs', 'examples', name), 'utf8')

  it('the raw example is the four-section deterministic report, with both counts and no ULID in a body', () => {
    const raw = example('track-report-raw.txt')
    expect(raw).toContain('report --wp --decisions --format text --commit d01368f')
    for (const title of ['FAIT', 'À-FAIRE', 'DÉCISIONS', 'RECOMMANDATION']) expect(raw).toContain(`\n${title}\n`)
    for (const removed of ['\nHORS ROLLUP\n', '\nÀ INSTRUIRE\n', '\nACTIONS DÉRIVÉES\n']) {
      expect(raw).not.toContain(removed)
    }
    expect(raw).toMatch(/couverture : \d+ lignes projetées · \d+ rendues/u)
    expect(raw).toContain('couvre l’intégralité du journal')
    expect(raw).toMatch(/│ D1\s+│/u) // the dossiers ARE structured at this baseline (criterion 16)
    const body = raw.slice(raw.indexOf('\nFAIT\n'), raw.indexOf('RÉSOLUTION DES HANDLES'))
    expect(ULID.test(body)).toBe(false)
  })

  it('the validated example is labelled a shape reference and names the gaps it still carries', () => {
    const contextual = example('track-report-contextual.md')
    expect(contextual).toContain('Référence de FORME, pas de contenu.')
    expect(contextual).toContain('aucun** dossier structuré')
    expect(contextual).toContain('critère 19')
    // Its four sections are the ones this renderer emits.
    for (const title of ['## FAIT', '## À-FAIRE', '## DÉCISIONS', '## RECOMMANDATION']) {
      expect(contextual).toContain(title)
    }
  })
})
