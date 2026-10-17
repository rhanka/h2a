import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { runCli } from './index.js'

const bundle = join(__dirname, '../../skills/present-decision')
const read = (file: string) => readFileSync(join(bundle, file), 'utf8').replace(/\s+/g, ' ')

// Pin the owner contract in the instructions, reusable question and audit independently.
describe('present-decision readability contract', () => {
  it.each(['SKILL.md', 'assets/dossier-template.md', 'assets/self-audit.md'])('%s defaults to the shipped portable Focus builder', (file) => {
    const text = read(file)
    expect(text).toContain('h2a focus build dossier.json -o dossier.html')
    expect(text).toMatch(/(?:portable Focus|Focus.*portable|portable.*Focus)/)
    expect(text).toMatch(/ecosystem/)
    expect(text).toMatch(/never a claude.ai artifact|no claude.ai artifact/)
  })
  it.each(['assets/dossier-template.md', 'assets/self-audit.md'])('%s requires a diagram before the native question and pending fallback', (file) => {
    const text = read(file)
    expect(text).toMatch(/diagram.*before.*native question tool/i)
    expect(text).toMatch(/unavailable.*decision pending/i)
    expect(text).toMatch(/never a bare text question/i)
  })
  it.each(['SKILL.md', 'assets/dossier-template.md', 'assets/self-audit.md'])('%s keeps the question short and complete', (file) => {
    const text = read(file)
    for (const clause of ['decision object', 'plain words', '<title>', '1.25rem', 'thin band', 'hero',
      '2 minutes', '400 words', '2–4 short options', 'no nested sub-options', 'recommendation']) {
      expect(text.toLowerCase(), `${file}: ${clause}`).toContain(clause.toLowerCase())
    }
    expect(text).toMatch(/subject/)
    expect(text).toMatch(/one (?:short )?line/i)
    expect(text).toMatch(/visible title and `<title>` must be identical|`<title>` (?:identical to|matches) (?:the )?visible title/)
    expect(text).toMatch(/(?:proportional to|fits) (?:the )?stakes/)
    expect(text).toMatch(/literal.*(?:request|passage)|(?:request|passage).*literal/i)
    expect(text).toMatch(/date|dated/)
    expect(text).toMatch(/source/)
    expect(text).toMatch(/representative/)
    expect(text).toMatch(/risk/)
    expect(text).toMatch(/implied choice/)
    expect(text).toMatch(/opaque codes/)
    expect(text).toMatch(/self-contained|without (?:opening those )?links/)
    expect(text).toMatch(/no (?:mandatory long appendix|choices or material risks hidden|choice or material risk)/)
  })

  it('keeps instructions and audit within their reviewed reading budgets', () => {
    expect(read('SKILL.md').split(' ').length).toBeLessThanOrEqual(850)
    expect(read('assets/self-audit.md').split(' ').length).toBeLessThanOrEqual(300)
  })

  it('reserves the criteria table for sourced requirements of the actual decision', () => {
    const text = read('assets/owner-criteria.template.md')
    const rows = text.split('|').map((cell) => cell.trim())
    expect(rows).toContain('<specific demand, quoted literally>')
    expect(text).toMatch(/self-audit\.md/)
    expect(text).toMatch(/only.*(?:subject|business)|(?:subject|business).*only/i)
    expect(text).not.toMatch(/Reading budget|Plain words;|All choices explicit;|Distinguishable title/)
  })
})

describe('present-decision documented Track commands', () => {
  it.each(['new', 'dossier', 'select'])('%s works using the instructions', (verb) => {
    const root = mkdtempSync(join(tmpdir(), 'present-decision-cli-'))
    try {
      mkdirSync(join(root, '.track'))
      const store = new EventStore(join(root, '.track/events.jsonl'))
      const track = new Track(store, { by: 'human:owner' })
      const target = track.createItem({ kind: 'feature', title: 'Delivery', workspace: 'ws' })
      const options = [{ id: 'A', title: 'Ship', summary: 'Deliver now' }, { id: 'B', title: 'Wait', summary: 'Reduce risk' }]
      const values: Record<string, string> = {
        '<kind>': 'orientation', '<title>': 'Delivery timing', '<workspace>': 'ws', '<targets>': target,
        '<c>': 'Choose delivery timing', '<json>': JSON.stringify(options), '<optionId>': 'B', '<r>': 'Lower risk',
      }
      const commands = [...readFileSync(join(bundle, 'SKILL.md'), 'utf8').matchAll(/`(track decision [^`]+)`/g)].map((m) => m[1]!)
      const command = (verb: string) => {
        const line = commands.find((c) => c.startsWith(`track decision ${verb} `))
        expect(line, `missing documented ${verb} command`).toBeDefined()
        const args = line!.slice('track '.length).split(' ').map((token) => values[token] ?? token)
        let out = '', err = ''
        const code = runCli(args, { cwd: root, out: (s) => { out += s }, err: (s) => { err += s } })
        expect(code, `${line}: ${err}`).toBe(0)
        return out.trim()
      }
      if (verb === 'new') {
        const id = command('new')
        expect(new Track(store).state().decisions.get(id)?.dossier).toMatchObject({ options, recommendation: { optionId: 'B' } })
        return
      }
      // Historical prose-only fixture: today's public writer correctly forbids creating one.
      store.appendCommand([{
        id: 'legacy-event', type: 'decision.created', aggregate: 'decision', aggregateId: 'legacy',
        at: '2026-07-28T00:00:00.000Z', by: 'legacy-fixture',
        payload: { decisionKind: 'orientation', title: 'Old decision', workspace: 'ws', targets: [target],
          dossier: { context: 'old prose', options: [], qa: [] } },
      }])
      values['<decisionId>'] = 'legacy'
      if (verb === 'dossier') {
        command('dossier')
        expect(new Track(store).state().decisions.get('legacy')?.dossier).toMatchObject({ options, recommendation: { optionId: 'B' } })
      } else {
        values['<decisionId>'] = track.createDecision({ decisionKind: 'orientation', title: 'Delivery', workspace: 'ws',
          targets: [target], dossier: { context: 'Delivery timing', options, qa: [], recommendation: { optionId: 'B', rationale: 'Lower risk' } } })
        command('select')
        expect(new Track(store).state().decisions.get(values['<decisionId>']!)).toMatchObject({ outcome: 'go', dossier: { selectedOptionId: 'B' } })
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
