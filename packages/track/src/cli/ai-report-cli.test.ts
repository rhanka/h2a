import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from './index.js'

let dir: string
let env: NodeJS.ProcessEnv
let adapterMarker: string
let h2aMarker: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-deterministic-report-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  adapterMarker = join(dir, 'adapter-called')
  h2aMarker = join(dir, 'h2a-called')
  const h2a = join(bin, 'h2a')
  const git = join(bin, 'git')
  const adapter = join(dir, 'adapter.mjs')
  writeFileSync(h2a, `require('node:fs').writeFileSync(${JSON.stringify(h2aMarker)}, 'called')\n`)
  writeFileSync(adapter, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(adapterMarker)}, 'called')\n`)
  writeFileSync(git, `if (process.argv.includes('rev-parse')) process.stdout.write('c1\\n')\n`)
  chmodSync(h2a, 0o755)
  chmodSync(git, 0o755)
  env = {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    TRACK_REPORT_AI_ARGV: JSON.stringify([process.execPath, adapter]),
  }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function run(args: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { cwd: dir, out: (value) => out.push(value), err: (value) => err.push(value), env }
  const code = runCli(args, io)
  expect(typeof code).toBe('number')
  return { code: code as number, out: out.join(''), err: err.join('') }
}

function seed(): string {
  expect(run(['init']).code).toBe(0)
  const wp = run(['item', 'new', '--kind', 'chore', '--title', 'Report WP', '--workspace', 'ws', '--role', 'workpackage'])
  expect(wp.code, wp.err).toBe(0)
  const leaf = run(['item', 'new', '--kind', 'feature', '--title', 'deterministic leaf', '--workspace', 'ws', '--parent', wp.out.trim()])
  expect(leaf.code, leaf.err).toBe(0)
  return leaf.out.trim()
}

describe('deterministic report CLI', () => {
  it('never invokes a configured AI adapter, h2a collector, or network-backed report path', () => {
    expect(run(['init']).code).toBe(0)
    expect(run(['item', 'new', '--kind', 'feature', '--title', 'x', '--workspace', 'ws']).code).toBe(0)

    for (const args of [
      ['report'],
      ['report', '--format', 'md'],
      ['report', '--format', 'html'],
      ['report', '--inline', '--width', '40'],
      ['report', '--flat'],
      ['report', '--format', 'json', '--wp', '--decisions'],
    ]) {
      const result = run(args)
      expect(result.code, `${args.join(' ')}: ${result.err}`).toBe(0)
    }

    expect(existsSync(adapterMarker)).toBe(false)
    expect(existsSync(h2aMarker)).toBe(false)
  })

  it('renders the conductor by default for text and md, with --flat as the legacy opt-out', () => {
    const leaf = seed()
    const decision = run([
      'decision', 'new', '--kind', 'orientation', '--title', 'Choose a delivery route', '--workspace', 'ws', '--targets', leaf,
      '--context', 'Choose a recorded route',
      '--options-json', '[{"id":"a","title":"Safe route","summary":"Require proof"},{"id":"b","title":"Fast route","summary":"Use the alias"}]',
      '--recommendation', 'a', '--rationale', 'The safe route has the lower risk',
    ])
    expect(decision.code, decision.err).toBe(0)

    const text = run(['report', '--commit', 'c1'])
    expect(text.code, text.err).toBe(0)
    expect(text.out).toContain('FAIT')
    expect(text.out).toContain('À-FAIRE')
    expect(text.out).toContain('DÉCISIONS')
    expect(text.out).toContain('a: Safe route')
    expect(text.out).not.toMatch(/^AWAITED \(/m)

    const md = run(['report', '--format', 'md', '--commit', 'c1'])
    expect(md.code, md.err).toBe(0)
    expect(md.out).toContain('## FAIT')
    expect(md.out).toContain('## DÉCISIONS')
    expect(md.out).not.toMatch(/^AWAITED \(/m)

    const flat = run(['report', '--flat', '--commit', 'c1'])
    expect(flat.code, flat.err).toBe(0)
    expect(flat.out).toMatch(/^AWAITED \(/m)
    expect(flat.out).not.toMatch(/^FAIT$/m)
  })

  it('uses deterministic renderers for json, html, and inline output without invoking an adapter', () => {
    seed()

    const json = run(['report', '--format', 'json', '--commit', 'c1'])
    expect(json.code, json.err).toBe(0)
    expect(JSON.parse(json.out)).toHaveProperty('buckets')

    const jsonWp = run(['report', '--format', 'json', '--wp', '--commit', 'c1'])
    expect(jsonWp.code, jsonWp.err).toBe(0)
    expect(JSON.parse(jsonWp.out)).toHaveProperty('wpTree')

    const html = run(['report', '--format', 'html', '--commit', 'c1'])
    expect(html.code, html.err).toBe(0)
    expect(html.out).toContain('<article class="report-document"')
    expect(html.out).toContain('data-section="done"')

    const inline = run(['report', '--inline', '--width', '40', '--commit', 'c1'])
    expect(inline.code, inline.err).toBe(0)
    expect(inline.out.split('\n').filter(Boolean).every((line) => line.length <= 40)).toBe(true)
  })

  it('rejects incompatible and no-op report flag combinations before reading the log', () => {
    for (const args of [
      ['report', '--wp', '--flat'],
      ['report', '--format', 'json', '--flat'],
      ['report', '--format', 'html', '--flat'],
      ['report', '--inline', '--format', 'md'],
      ['report', '--format', 'html', '--width', '80'],
      ['report', '--width', '39'],
      ['report', '--width', '241'],
      ['report', '--width', 'wide'],
    ]) {
      const result = run(args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.err, args.join(' ')).toContain('error:')
    }
  })
})
