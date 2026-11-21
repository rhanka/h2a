import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { captureRegistryPath, readCaptureRegistry } from './registry.js'

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(home: string): void {
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_WRITER_TOKEN: process.env['TRACK_WRITER_TOKEN'],
  }
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_WRITER_TOKEN']
  process.env['TRACK_STATE_HOME'] = home
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

function cli(
  cwd: string,
  args: string[],
  opts: { stdin?: string } = {},
): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const code = runCli(args, {
    cwd,
    out: (s) => {
      out += s
    },
    err: (s) => {
      err += s
    },
    ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
  })
  return { code: code as number, out, err }
}

describe('capture registry and header display (T3a-n, lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-registry-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-n: records each CLI with mode and lastCaptureAt in mode 0600, and header shows it', () => {
    const project = join(scratch, 'proj-reg')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    // Empty registry header
    const repEmpty = cli(project, ['report', '--owner-table'])
    expect(repEmpty.code, repEmpty.err).toBe(0)
    expect(repEmpty.out).toContain('Captation : aucune CLI recensée')
    expect(repEmpty.out).toContain('captation inactive')

    // Register three CLIs with distinct modes
    expect(
      cli(project, ['capture', 'register', '--cli', 'claude', '--version', '2.1.0', '--mode', 'direct']).code,
    ).toBe(0)
    expect(
      cli(project, ['capture', 'register', '--cli', 'vibe', '--version', '1.4.0', '--mode', 'deferred']).code,
    ).toBe(0)
    expect(
      cli(project, ['capture', 'register', '--cli', 'agy', '--version', '0.9.0', '--mode', 'not-covered']).code,
    ).toBe(0)

    const regPath = captureRegistryPath(process.env)
    expect(statSync(regPath).mode & 0o777).toBe(0o600)

    const beforeCap = readCaptureRegistry(process.env)
    expect(beforeCap.version).toBe(1)
    expect(beforeCap.clis['claude']).toMatchObject({
      version: '2.1.0',
      mode: 'direct',
      lastCaptureAt: null,
    })

    // Capture via claude updates lastCaptureAt
    const capTime = '2026-11-20T12:00:00.000Z'
    const addRes = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', capTime, '--stdin'], {
      stdin: JSON.stringify({ prompt: 'Test mise à jour registre', session_id: 's-reg', cwd: project }),
    })
    expect(addRes.code).toBe(0)
    expect(addRes.out).toBe('')

    const afterCap = readCaptureRegistry(process.env)
    expect(afterCap.clis['claude']?.lastCaptureAt).toBe(capTime)
    expect(afterCap.clis['vibe']?.lastCaptureAt).toBeNull()

    // Header displays registered CLIs with annex F state names and partial-capture scope motifs
    const rep = cli(project, ['report', '--owner-table', '--now', '2026-11-20T13:00:00.000Z'])
    expect(rep.code, rep.err).toBe(0)
    expect(rep.out).toContain('Captation : agy non couverte · claude directe · vibe différée')
    expect(rep.out).toContain('captation partielle')
    expect(rep.out).toContain('questions en texte libre non suivies')
    expect(rep.out).not.toContain('captation inactive')
    expect(rep.out).toContain('1 message non classé')
    expect(rep.out).toContain('journal ouvert')
  })
})
