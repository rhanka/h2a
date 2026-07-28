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
  const result = runCli(args, { cwd: dir, out: (value) => out.push(value), err: (value) => err.push(value), env } satisfies CliIO)
  expect(typeof result).toBe('number')
  return { code: result as number, out: out.join(''), err: err.join('') }
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
})
