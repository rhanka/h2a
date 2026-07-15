import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from './index.js'

let dir: string
let adapter: string
let env: NodeJS.ProcessEnv
let adapterMarker: string
let collectorMarker: string
let gitMarker: string
let capture: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-ai-cli-'))
  const bin = join(dir, 'bin')
  const xdg = join(dir, 'xdg')
  mkdirSync(bin, { recursive: true })
  mkdirSync(xdg, { recursive: true })
  const h2a = join(bin, 'h2a')
  adapterMarker = join(dir, 'adapter-called')
  collectorMarker = join(dir, 'h2a-called')
  gitMarker = join(dir, 'git-called')
  capture = join(dir, 'captured-context.json')
  writeFileSync(h2a, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(collectorMarker)}, 'called')
process.stdout.write(JSON.stringify({schema:'h2a.report-context/v1',storeRoot:${JSON.stringify(dir)},workspaceRoot:${JSON.stringify(dir)},entries:[],omitted:0}))
`)
  chmodSync(h2a, 0o755)
  const git = join(bin, 'git')
  writeFileSync(git, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(gitMarker)}, 'called')
const args = process.argv.slice(2)
if (args.includes('--show-toplevel')) process.stdout.write(${JSON.stringify(dir)} + '\\n')
else if (args[0] === 'rev-parse') process.stdout.write('c1\\n')
`)
  chmodSync(git, 0o755)
  adapter = join(dir, 'adapter.mjs')
  writeFileSync(adapter, `
import { writeFileSync } from 'node:fs'
const empty = () => []
const result = JSON.stringify({
  schema: 'track.ai-report.result/v1',
  adapter: { provider: 'fake', model: 'fake-model', identity: 'adapter-reported' },
  sections: {
    summary: [{ id: 'summary-1', text: 'Status <b>interpreted</b>', citations: [{ ref: 'source:git' }] }],
    facts: empty(), changes: empty(), activeWork: empty(), blockers: empty(),
    ownerDecisions: empty(), suggestions: empty(), uncertainty: empty()
  }
})
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  writeFileSync(${JSON.stringify(adapterMarker)}, 'called')
  writeFileSync(${JSON.stringify(capture)}, input)
  process.stdout.write(result)
})
`)
  env = {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    HOME: process.env['HOME'],
    XDG_CONFIG_HOME: xdg,
    H2A_ROOT: dir,
    TRACK_REPORT_AI_ARGV: JSON.stringify([process.execPath, adapter]),
  }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(args: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { cwd: dir, out: (value) => out.push(value), err: (value) => err.push(value), env }
  const code = runCli(args, io)
  expect(typeof code).toBe('number')
  return { code: code as number, out: out.join(''), err: err.join('') }
}

describe('human AI report CLI', () => {
  it('should invoke the configured adapter and render text, Markdown, HTML, and inline safely', () => {
    expect(run(['init']).code).toBe(0)
    expect(run(['item', 'new', '--kind', 'feature', '--title', 'x', '--workspace', 'ws']).code).toBe(0)

    const text = run(['report', '--commit', 'c1'])
    expect(text.code, text.err).toBe(0)
    expect(text.out).toContain('AI-prepared interpretation')
    expect(text.out).toContain('Status <b>interpreted</b>')

    const md = run(['report', '--format', 'md', '--wp', '--decisions', '--active-roster', '--commit', 'c1'])
    expect(md.code).toBe(0)
    expect(md.out).toContain('Status \\<b\\>interpreted\\</b\\>')
    expect(md.out).toContain('adapter\\-reported: fake/fake\\-model')
    const mdContext = JSON.parse(readFileSync(capture, 'utf8')) as {
      context: { request: { emphasis: string; decisionEmphasis: string; activeRoster: boolean } }
    }
    expect(mdContext.context.request).toMatchObject({
      emphasis: 'workpackages', decisionEmphasis: 'all', activeRoster: true,
    })

    const flat = run(['report', '--flat', '--commit', 'c1'])
    expect(flat.code).toBe(0)
    const flatContext = JSON.parse(readFileSync(capture, 'utf8')) as { context: { request: { emphasis: string } } }
    expect(flatContext.context.request.emphasis).toBe('flat')

    const html = run(['report', '--format', 'html', '--commit', 'c1'])
    expect(html.code).toBe(0)
    expect(html.out).toContain('&lt;b&gt;interpreted&lt;/b&gt;')
    expect(html.out).not.toContain('<b>interpreted</b>')

    const inline = run(['report', '--inline', '--width', '40', '--commit', 'c1'])
    expect(inline.code).toBe(0)
    expect(inline.out.split('\n').every((line) => line.length <= 40)).toBe(true)
  })

  it('should enforce the normative incompatible combinations before adapter invocation', () => {
    for (const args of [
      ['report', '--commit'],
      ['report', '--format'],
      ['report', '--width'],
      ['report', '--level'],
      ['report', '--inline', '--format', 'md'],
      ['report', '--inline', '--format', 'json'],
      ['report', '--inline', '--format', 'html'],
      ['report', '--format', 'html', '--width', '80'],
      ['report', '--width', '39'],
      ['report', '--width', '241'],
      ['report', '--width', 'wide'],
      ['report', '--wp', '--flat'],
      ['report', '--level', 'wp', '--wp'],
      ['report', '--level', 'wp', '--flat'],
      ['report', '--level', 'wp', '--inline'],
      ['report', '--level', 'wp', '--width', '80'],
      ['report', '--level', 'wp', '--decisions'],
      ['report', '--level', 'wp', '--active-roster'],
      ['report', '--level', 'wp', '--raw'],
      ['report', '--level', 'wp', '--format', 'html'],
      ['report', '--raw', '--format', 'html'],
      ['report', '--raw', '--format'],
      ['report', '--raw', '--commit'],
      ['report', '--raw', '--inline'],
      ['report', '--raw', '--width', '80'],
      ['report', '--raw', '--wp'],
      ['report', '--raw', '--flat'],
      ['report', '--raw', '--decisions'],
      ['report', '--raw', '--active-roster'],
      ['snapshot', '--commit'],
      ['snapshot', '--format'],
      ['snapshot', '--format', 'html'],
      ['snapshot', '--raw'],
      ['snapshot', '--inline'],
      ['snapshot', '--width', '80'],
      ['snapshot', '--wp'],
      ['snapshot', '--flat'],
      ['snapshot', '--decisions'],
      ['snapshot', '--active-roster'],
      ['snapshot', '--level', 'wp'],
    ]) {
      const result = run(args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.err, args.join(' ')).toContain('error:')
      expect(existsSync(gitMarker), `git invoked before rejecting ${args.join(' ')}`).toBe(false)
      expect(existsSync(collectorMarker), `h2a invoked before rejecting ${args.join(' ')}`).toBe(false)
      expect(existsSync(adapterMarker), `adapter invoked before rejecting ${args.join(' ')}`).toBe(false)
    }
  })

  it('should accept every normative report/snapshot/status format and width boundary', () => {
    expect(run(['init']).code).toBe(0)
    for (const args of [
      ['report'],
      ['report', '--format', 'text'],
      ['report', '--format', 'md'],
      ['report', '--format', 'html'],
      ['report', '--inline'],
      ['report', '--inline', '--format', 'text'],
      ['report', '--width', '40'],
      ['report', '--width', '240', '--format', 'text'],
      ['report', '--wp'],
      ['report', '--flat'],
      ['report', '--decisions'],
      ['report', '--active-roster'],
      ['report', '--format', 'json', '--wp', '--decisions', '--active-roster'],
      ['report', '--raw'],
      ['report', '--raw', '--format', 'text'],
      ['report', '--raw', '--format', 'md'],
      ['snapshot'],
      ['snapshot', '--format', 'text'],
      ['snapshot', '--format', 'md'],
      ['report', '--level', 'wp', '--format', 'json'],
      ['report', '--level', 'wp', '--format', 'text'],
      ['report', '--level', 'wp', '--format', 'md'],
    ]) {
      const result = run(args)
      expect(result.code, `${args.join(' ')}: ${result.err}`).toBe(0)
    }
  }, 20_000)

  it('should fail honestly without configuration while JSON and raw paths remain provider-free', () => {
    delete env['TRACK_REPORT_AI_ARGV']
    const missing = run(['report', '--commit', 'c1'])
    expect(missing.code).toBe(1)
    expect(missing.err).toMatch(/missing-configuration.*track snapshot/s)

    expect(run(['report', '--format', 'json', '--commit', 'c1']).code).toBe(0)
    expect(run(['report', '--raw', '--commit', 'c1']).code).toBe(0)
    expect(run(['snapshot', '--commit', 'c1']).code).toBe(0)
  })
})
