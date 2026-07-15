import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli, type CliIO } from './index.js'

let dir: string
let adapter: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-ai-cli-'))
  const bin = join(dir, 'bin')
  const xdg = join(dir, 'xdg')
  mkdirSync(bin, { recursive: true })
  mkdirSync(xdg, { recursive: true })
  const h2a = join(bin, 'h2a')
  writeFileSync(h2a, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({schema:'h2a.report-context/v1',storeRoot:${JSON.stringify(dir)},workspaceRoot:${JSON.stringify(dir)},entries:[],omitted:0}))\n`)
  chmodSync(h2a, 0o755)
  adapter = join(dir, 'adapter.mjs')
  writeFileSync(adapter, `
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
process.stdin.resume()
process.stdin.on('end', () => process.stdout.write(result))
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
      ['report', '--inline', '--format', 'md'],
      ['report', '--format', 'html', '--width', '80'],
      ['report', '--width', '39'],
      ['report', '--level', 'wp', '--wp'],
      ['report', '--raw', '--format', 'html'],
      ['snapshot', '--inline'],
    ]) {
      const result = run(args)
      expect(result.code, args.join(' ')).toBe(1)
      expect(result.err, args.join(' ')).toContain('error:')
    }
  })

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
