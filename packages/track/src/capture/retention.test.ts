import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { identityOf } from '../journal/identity.js'
import {
  captureDirForIdentity,
  DEFAULT_CAPTURE_RETENTION_HOURS,
  readCaptureEntry,
  sweepExpiredQueues,
} from './queue.js'

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(home: string): void {
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_WRITER_TOKEN: process.env['TRACK_WRITER_TOKEN'],
    TRACK_CAPTURE_RETENTION_HOURS: process.env['TRACK_CAPTURE_RETENTION_HOURS'],
  }
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_WRITER_TOKEN']
  delete process.env['TRACK_CAPTURE_RETENTION_HOURS']
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
  opts: { stdin?: string; env?: NodeJS.ProcessEnv } = {},
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
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  })
  return { code: code as number, out, err }
}

describe('capture retention, expiry sweep and acknowledgement (T3a-c, T3a-i, lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-retention-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-c: after retention delay unclassified text is purged, trace remains, and header counts it without read writing', () => {
    const project = join(scratch, 'proj-retention')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const t0 = '2026-11-10T10:00:00.000Z'
    const afterDelay = new Date(
      Date.parse(t0) + (DEFAULT_CAPTURE_RETENTION_HOURS + 1) * 3_600_000,
    ).toISOString()

    const sensitiveText = 'Message oublié qui doit être purgé après délai'
    const addRes = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', t0, '--stdin'], {
      stdin: JSON.stringify({
        prompt: sensitiveText,
        session_id: 'sess-ret-1',
        cwd: project,
        transcript_path: '/tmp-transcript/sess-ret-1.jsonl',
      }),
    })
    expect(addRes.code).toBe(0)
    expect(addRes.out).toBe('')

    const ident = identityOf(project)
    const entryDir = captureDirForIdentity(ident.id, process.env)
    const capId = readdirSync(entryDir).find((f) => f.endsWith('.json'))!.replace(/\.json$/u, '')
    const entryPath = join(entryDir, `${capId}.json`)
    const beforeReadRaw = readFileSync(entryPath, 'utf8')

    // 1. Reader at afterDelay treats over-age entry as expired WITHOUT mutating disk (V4)
    const reportBeforeSweep = cli(project, ['report', '--owner-table', '--now', afterDelay])
    expect(reportBeforeSweep.code, reportBeforeSweep.err).toBe(0)
    expect(reportBeforeSweep.out).toContain('1 expiré non classé')
    expect(reportBeforeSweep.out).not.toContain(sensitiveText)
    // Disk untouched by read!
    expect(readFileSync(entryPath, 'utf8')).toBe(beforeReadRaw)

    // 2. Sweep purges text on disk while keeping trace metadata
    const swept = sweepExpiredQueues({ env: process.env, now: afterDelay })
    expect(swept).toBe(1)

    const expiredEntry = readCaptureEntry(ident.id, capId, process.env)
    expect(expiredEntry).toBeDefined()
    expect(expiredEntry!.state).toBe('expired')
    expect(expiredEntry!.text).toBeNull()
    expect(expiredEntry!.at).toBe(t0)
    expect(expiredEntry!.session).toBe('sess-ret-1')
    expect(expiredEntry!.cli).toBe('claude')
    expect(expiredEntry!.size).toBe(Buffer.byteLength(sensitiveText, 'utf8'))
    expect(expiredEntry!.transcript).toBe('/tmp-transcript/sess-ret-1.jsonl')
    expect(readFileSync(entryPath, 'utf8')).not.toContain(sensitiveText)

    // Header still counts the expired trace after sweep
    const reportAfterSweep = cli(project, ['report', '--owner-table', '--now', afterDelay])
    expect(reportAfterSweep.code, reportAfterSweep.err).toBe(0)
    expect(reportAfterSweep.out).toContain('1 expiré non classé')
  })

  it('T3a-i: acknowledging an expired trace clears the header counter; late-demand inscribes via cli transport as (non capté)', () => {
    const project = join(scratch, 'proj-ack')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const t0 = '2026-11-10T10:00:00.000Z'
    const tExpired = '2026-11-15T10:00:00.000Z'

    // Capture 3 messages that all expire
    for (let i = 1; i <= 3; i++) {
      expect(
        cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', t0, '--stdin'], {
          stdin: JSON.stringify({ prompt: `Message expiré ${i}`, session_id: `s-${i}`, cwd: project }),
        }).code,
      ).toBe(0)
    }
    sweepExpiredQueues({ env: process.env, now: tExpired })

    const ident = identityOf(project)
    const entryDir = captureDirForIdentity(ident.id, process.env)
    const capIds = readdirSync(entryDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/u, ''))
      .sort()
    expect(capIds).toHaveLength(3)

    // Header counts 3 expired
    const r0 = cli(project, ['report', '--owner-table', '--now', tExpired])
    expect(r0.code, r0.err).toBe(0)
    expect(r0.out).toContain('3 expirés non classés')

    // 1. Acknowledge #1 as not-a-demand
    const ack1 = cli(project, ['capture', 'acknowledge', capIds[0]!, '--as', 'not-a-demand', '--now', tExpired])
    expect(ack1.code, ack1.err).toBe(0)

    // 2. Acknowledge #2 as recorded-elsewhere
    const ack2 = cli(project, ['capture', 'acknowledge', capIds[1]!, '--as', 'recorded-elsewhere', '--now', tExpired])
    expect(ack2.code, ack2.err).toBe(0)

    // 3. Acknowledge #3 as late-demand -> inscribes via ordinary `cli` transport => `(non capté)`
    const ack3 = cli(project, [
      'capture',
      'acknowledge',
      capIds[2]!,
      '--as',
      'late-demand',
      '--title',
      'Demande tardive',
      '--text',
      'Texte reconstitué après expiration',
      '--now',
      tExpired,
    ])
    expect(ack3.code, ack3.err).toBe(0)

    // Verify journal event uses `cli` transport (not `capture`)
    const events = new EventStore(join(project, '.track', 'events.jsonl')).readAll()
    const raised = events.filter((e) => e.type === 'demand.raised')
    expect(raised).toHaveLength(1)
    expect(raised[0]!.prov?.transport).toBe('cli')

    // Header counter is now cleared (0 expired) and demand is labelled `(non capté)`
    const rAfter = cli(project, ['report', '--owner-table', '--now', tExpired])
    expect(rAfter.code, rAfter.err).toBe(0)
    expect(rAfter.out).not.toContain('expiré non classé')
    expect(rAfter.out).not.toContain('expirés non classés')
    expect(rAfter.out).toContain('(non capté)')
  })
})
