import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { computePlanHash } from './cli/restructure-apply.js'
import { readHead } from './events/head.js'
import { EventStore } from './events/store.js'
import { identityOf } from './journal/identity.js'
import { listCaptures } from './capture/queue.js'
import { Track } from './track.js'
import {
  declareExclusiveWriter,
  readWritePolicy,
  takeoverExclusiveWriter,
  WritePolicyError,
} from './write-policy.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILT_BIN = resolve(HERE, '../dist/cli/bin.js')

let scratch: string
let stateHome: string

function spawnTrack(
  cwd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string } = {},
): { code: number; out: string; err: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TRACK_STATE_HOME: stateHome,
    ...opts.env,
  }
  if (!('TRACK_DIR' in (opts.env ?? {}))) delete env['TRACK_DIR']
  if (!('TRACK_WRITER_TOKEN' in (opts.env ?? {}))) delete env['TRACK_WRITER_TOKEN']

  const res = spawnSync(process.execPath, [BUILT_BIN, ...args], {
    cwd,
    env,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    encoding: 'utf8',
  })
  return {
    code: res.status ?? 1,
    out: res.stdout ?? '',
    err: res.stderr ?? '',
  }
}

describe('journal write policy: exclusive writer, takeover, release (T3a-g, T3a-m, lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-policy-'))
    stateHome = join(scratch, 'state-home')
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-g: exclusive journal refuses writes without current token across verbs/restructure/reseal, queues captures, and invalidates former holder after takeover', () => {
    const repo = join(scratch, 'repo-excl')
    mkdirSync(repo, { recursive: true })
    expect(spawnTrack(repo, ['init']).code).toBe(0)

    const eventsPath = join(repo, '.track', 'events.jsonl')
    const store = new EventStore(eventsPath)
    const track = new Track(store, { by: 'human:setup' })
    const wpId = track.createItem({ kind: 'feature', title: 'WP Base', workspace: 'ws1', role: 'workpackage' })
    const childId = track.createItem({ kind: 'feature', title: 'Child Item', workspace: 'ws1' })

    // Default journal status is open, epoch 0
    const st0 = spawnTrack(repo, ['journal', 'status', '--format', 'json'])
    expect(st0.code, st0.err).toBe(0)
    expect(JSON.parse(st0.out)).toMatchObject({ mode: 'open', holder: null, epoch: 0 })

    // Declare exclusive writer with --token-file (mode 0600) and verify write-policy.json is mode 0600
    const tokenFile1 = join(scratch, 'holder-1.token')
    const decl = spawnTrack(repo, ['journal', 'declare-writer', '--holder', 'cond-alpha', '--token-file', tokenFile1])
    expect(decl.code, decl.err).toBe(0)
    expect(statSync(tokenFile1).mode & 0o777).toBe(0o600)
    expect(statSync(join(repo, '.track', 'write-policy.json')).mode & 0o777).toBe(0o600)
    const token1 = readFileSync(tokenFile1, 'utf8').trim()
    expect(token1.length).toBeGreaterThanOrEqual(32)
    // Token is not printed to stdout when --token-file is used
    expect(decl.out).not.toContain(token1)

    const st1 = spawnTrack(repo, ['journal', 'status', '--format', 'json'])
    expect(st1.code, st1.err).toBe(0)
    expect(JSON.parse(st1.out)).toMatchObject({ mode: 'exclusive', holder: 'cond-alpha', epoch: 1 })

    const rawBefore = readFileSync(eventsPath, 'utf8')

    // Process WITHOUT token: ordinary write verb refused (names holder & epoch), journal unchanged
    const badItem = spawnTrack(repo, ['item', 'new', '--kind', 'chore', '--title', 'Intruder', '--workspace', 'ws1'])
    expect(badItem.code).toBe(1)
    expect(badItem.err).toContain('cond-alpha')
    expect(badItem.err).toContain('1')
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)

    // Process WITHOUT token: reseal refused, journal unchanged
    const badReseal = spawnTrack(repo, ['reseal'])
    expect(badReseal.code).toBe(1)
    expect(badReseal.err).toContain('cond-alpha')
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)

    // Process WITHOUT token: restructure apply refused, journal unchanged
    const edges = [{ itemId: childId, parentId: wpId }]
    const head = readHead(eventsPath)
    const planFile = join(scratch, 'restructure-plan.json')
    writeFileSync(
      planFile,
      JSON.stringify({
        edges,
        planHash: computePlanHash(edges),
        baseline: { streamLength: store.readAll().length, lastContentHash: head?.lastContentHash ?? null },
      }),
      'utf8',
    )
    const badRestructure = spawnTrack(repo, ['restructure', 'apply', '--plan', planFile])
    expect(badRestructure.code).toBe(1)
    expect(badRestructure.err).toContain('cond-alpha')
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)

    // Non-holder session captures and classifies -> stays queued (`classified`), journal unchanged
    const addRes = spawnTrack(repo, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
      input: JSON.stringify({ prompt: 'Demande en attente du détenteur', session_id: 's-q', cwd: repo }),
    })
    expect(addRes.code).toBe(0)
    expect(addRes.out).toBe('')
    const ident = identityOf(repo)
    const cap = listCaptures(ident.id, { env: { ...process.env, TRACK_STATE_HOME: stateHome } })[0]!
    const clsNoToken = spawnTrack(repo, [
      'capture',
      'classify',
      cap.id,
      '--as',
      'new-demand',
      '--title',
      'En file',
    ])
    expect(clsNoToken.code, clsNoToken.err).toBe(0)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawBefore)
    const queued = listCaptures(ident.id, { env: { ...process.env, TRACK_STATE_HOME: stateHome } })[0]!
    expect(queued.state).toBe('classified')

    // Process WITH --writer-token-file (NO TRACK_WRITER_TOKEN env var): restructure apply succeeds!
    const okRestructure = spawnTrack(repo, [
      '--writer-token-file',
      tokenFile1,
      'restructure',
      'apply',
      '--plan',
      planFile,
    ])
    expect(okRestructure.code, okRestructure.err).toBe(0)

    // Process WITH --writer-token-file (trailing position): reseal succeeds!
    const okReseal = spawnTrack(repo, ['reseal', '--writer-token-file', tokenFile1])
    expect(okReseal.code, okReseal.err).toBe(0)

    // Process WITH TRACK_WRITER_TOKEN: holder inscribes queued entry!
    const okInscribe = spawnTrack(repo, ['capture', 'inscribe', '--all'], {
      env: { TRACK_WRITER_TOKEN: token1 },
    })
    expect(okInscribe.code, okInscribe.err).toBe(0)
    const afterInscribe = listCaptures(ident.id, { env: { ...process.env, TRACK_STATE_HOME: stateHome } })[0]!
    expect(afterInscribe.state).toBe('inscribed')
    expect(afterInscribe.text).toBeNull()

    // Explicit takeover raises epoch and invalidates former holder's token
    const tokenFile2 = join(scratch, 'holder-2.token')
    const takeover = spawnTrack(repo, [
      'journal',
      'takeover',
      '--holder',
      'cond-beta',
      '--reason',
      'reprise manuelle validée',
      '--token-file',
      tokenFile2,
    ])
    expect(takeover.code, takeover.err).toBe(0)
    const token2 = readFileSync(tokenFile2, 'utf8').trim()
    expect(token2).not.toBe(token1)

    const policyAfterTakeover = readWritePolicy(eventsPath)
    expect(policyAfterTakeover.mode).toBe('exclusive')
    expect(policyAfterTakeover.holder).toBe('cond-beta')
    expect(policyAfterTakeover.epoch).toBe(2)

    const rawAtEpoch2 = readFileSync(eventsPath, 'utf8')

    // Former holder (token1 via env AND via --writer-token-file) is now REFUSED
    const staleEnvWrite = spawnTrack(
      repo,
      ['item', 'new', '--kind', 'chore', '--title', 'Stale', '--workspace', 'ws1'],
      { env: { TRACK_WRITER_TOKEN: token1 } },
    )
    expect(staleEnvWrite.code).toBe(1)
    expect(staleEnvWrite.err).toContain('cond-beta')
    expect(staleEnvWrite.err).toContain('2')
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawAtEpoch2)

    const staleFileWrite = spawnTrack(repo, [
      'item',
      'new',
      '--kind',
      'chore',
      '--title',
      'StaleFile',
      '--workspace',
      'ws1',
      '--writer-token-file',
      tokenFile1,
    ])
    expect(staleFileWrite.code).toBe(1)
    expect(readFileSync(eventsPath, 'utf8')).toBe(rawAtEpoch2)

    // New holder succeeds
    const newHolderWrite = spawnTrack(repo, [
      'item',
      'new',
      '--kind',
      'chore',
      '--title',
      'Authorized',
      '--workspace',
      'ws1',
      '--writer-token-file',
      tokenFile2,
    ])
    expect(newHolderWrite.code, newHolderWrite.err).toBe(0)

    // Non-holder cannot release; holder can release -> back to open, epoch raised to 3
    expect(spawnTrack(repo, ['journal', 'release'], { env: { TRACK_WRITER_TOKEN: token1 } }).code).toBe(1)
    const rel = spawnTrack(repo, ['journal', 'release', '--writer-token-file', tokenFile2])
    expect(rel.code, rel.err).toBe(0)
    const policyOpen = readWritePolicy(eventsPath)
    expect(policyOpen.mode).toBe('open')
    expect(policyOpen.epoch).toBe(3)
  })

  it('T3a-m: a silent or long-idle holder is never replaced without an explicit takeover', () => {
    const repo = join(scratch, 'repo-silent')
    mkdirSync(repo, { recursive: true })
    expect(spawnTrack(repo, ['init']).code).toBe(0)

    const eventsPath = join(repo, '.track', 'events.jsonl')
    const decl = spawnTrack(repo, ['journal', 'declare-writer', '--holder', 'silent-holder'])
    expect(decl.code, decl.err).toBe(0)
    const token = decl.out.trim()
    expect(token.length).toBeGreaterThanOrEqual(32)

    // Backdate policy updatedAt by 365 days to simulate a dead/silent holder
    const policyPath = join(repo, '.track', 'write-policy.json')
    const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<string, unknown>
    policy['updatedAt'] = '2025-01-01T00:00:00.000Z'
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8')

    // Re-declaring without explicit takeover is refused
    const redecl = spawnTrack(repo, ['journal', 'declare-writer', '--holder', 'usurper'])
    expect(redecl.code).toBe(1)

    // Writing without token is still refused; holder stays silent-holder at epoch 1
    const writeAttempt = spawnTrack(repo, [
      'item',
      'new',
      '--kind',
      'chore',
      '--title',
      'NoAutoTakeover',
      '--workspace',
      'ws1',
    ])
    expect(writeAttempt.code).toBe(1)
    expect(writeAttempt.err).toContain('silent-holder')

    const current = readWritePolicy(eventsPath)
    expect(current.mode).toBe('exclusive')
    expect(current.holder).toBe('silent-holder')
    expect(current.epoch).toBe(1)
  })

  it('C3/C5/C6: write-policy fails closed on symlink/EACCES, creates --token-file parent in 0700, validates --holder, and masks --reason', () => {
    const repo = join(scratch, 'repo-sec-policy')
    mkdirSync(repo, { recursive: true })
    expect(spawnTrack(repo, ['init']).code).toBe(0)

    const eventsPath = join(repo, '.track', 'events.jsonl')
    const policyPath = join(repo, '.track', 'write-policy.json')

    // 1. Rejects multiline, control chars, middle-dot, or >64-char --holder
    expect(() => declareExclusiveWriter(eventsPath, 'holder\ninjected')).toThrow(/holder/iu)
    expect(() => declareExclusiveWriter(eventsPath, 'holder · fake')).toThrow(/holder/iu)
    expect(() => declareExclusiveWriter(eventsPath, 'h'.repeat(65))).toThrow(/holder/iu)

    // 2. Creates missing parent directory of --token-file with mode 0700 and write-policy.json with 0600
    const nestedTokenParent = join(scratch, 'new-token-parent', 'sub')
    const nestedTokenFile = join(nestedTokenParent, 'writer.token')
    declareExclusiveWriter(eventsPath, 'cond-sec', { tokenFile: nestedTokenFile })
    expect(statSync(nestedTokenParent).mode & 0o777).toBe(0o700)
    expect(statSync(nestedTokenFile).mode & 0o777).toBe(0o600)
    expect(statSync(policyPath).mode & 0o777).toBe(0o600)

    // 3. Takeover masks secrets in --reason before persisting to write-policy.json
    const secretInReason = ['sk', 'ant', 'api03', 'SyntheticTakeoverReasonSecret012345'].join('-')
    takeoverExclusiveWriter(eventsPath, 'cond-sec-2', `Reprise suite incident ${secretInReason}`)
    const rawPolicy = readFileSync(policyPath, 'utf8')
    expect(rawPolicy).not.toContain(secretInReason)
    expect(rawPolicy).toContain('[secret masqué : anthropic-key]')

    // 4. Fail-closed on EACCES (unreadable write-policy.json MUST NOT fall back to open)
    if (process.getuid?.() !== 0) {
      chmodSync(policyPath, 0o000)
      try {
        expect(() => readWritePolicy(eventsPath)).toThrow(WritePolicyError)
        const store = new EventStore(eventsPath)
        const track = new Track(store, { by: 'human:intruder' })
        expect(() => track.createItem({ kind: 'chore', title: 'ShouldFail', workspace: 'ws1' })).toThrow(
          WritePolicyError,
        )
      } finally {
        chmodSync(policyPath, 0o600)
      }
    }

    // 5. Fail-closed on broken symlink at write-policy.json (MUST NOT fall back to open!)
    rmSync(policyPath)
    symlinkSync(join(scratch, 'does-not-exist.json'), policyPath)
    expect(() => readWritePolicy(eventsPath)).toThrow(WritePolicyError)
    const storeSym = new EventStore(eventsPath)
    const trackSym = new Track(storeSym, { by: 'human:intruder' })
    expect(() => trackSym.createItem({ kind: 'chore', title: 'ShouldFailSym', workspace: 'ws1' })).toThrow(
      WritePolicyError,
    )
  })
})
