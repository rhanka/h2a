import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from './cli/index.js'
import { EventStore } from './events/store.js'
import { trackStateHome } from './state-home.js'
import { Track } from './track.js'

let scratch: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'track-state-home-'))
  savedEnv = {
    TRACK_OWNER_POLICY_FILE: process.env['TRACK_OWNER_POLICY_FILE'],
    TRACK_OWNER_REPORT_POLICY: process.env['TRACK_OWNER_REPORT_POLICY'],
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    XDG_STATE_HOME: process.env['XDG_STATE_HOME'],
    HOME: process.env['HOME'],
  }
  delete process.env['TRACK_OWNER_POLICY_FILE']
  delete process.env['TRACK_OWNER_REPORT_POLICY']
  delete process.env['TRACK_STATE_HOME']
  delete process.env['XDG_STATE_HOME']
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(scratch, { recursive: true, force: true })
})

describe('state home and private-term policy lookup (lot 1)', () => {
  it('the private-term policy is found beside the journal, then in the user state directory (T1-l)', () => {
    // Pure path resolution, creates nothing
    const customState = join(scratch, 'custom-state-not-created')
    expect(trackStateHome({ TRACK_STATE_HOME: customState })).toBe(customState)
    expect(existsSync(customState)).toBe(false)

    const xdgState = join(scratch, 'xdg-state')
    expect(trackStateHome({ XDG_STATE_HOME: xdgState })).toBe(join(xdgState, 'sentropic', 'track'))
    expect(existsSync(xdgState)).toBe(false)

    const fakeHome = join(scratch, 'fake-home')
    expect(trackStateHome({ HOME: fakeHome })).toBe(join(fakeHome, '.local', 'state', 'sentropic', 'track'))
    expect(existsSync(fakeHome)).toBe(false)

    // Policy lookup order for owner-table: beside journal wins over state home; state home is used when absent beside journal
    const repo = join(scratch, 'policy-repo')
    const stateDir = join(scratch, 'user-state')
    mkdirSync(repo, { recursive: true })
    mkdirSync(stateDir, { recursive: true })
    process.env['TRACK_STATE_HOME'] = stateDir

    const track = new Track(new EventStore(join(repo, '.track', 'events.jsonl')), {
      by: 'test',
      now: () => '2026-11-18T10:00:00.000Z',
    })
    const d1 = track.raiseDemand({
      type: 'feature',
      workspace: 'ws',
      raw: { text: 'Projet alphaomega et betadelta' },
      source: { kind: 'human' },
    })
    track.numberDemand(d1, 1)

    const runTable = (): { code: number; out: string; err: string } => {
      let out = ''
      let err = ''
      const code = runCli(
        ['report', '--owner-table', '--format', 'md', '--now', '2026-11-20T12:00:00.000Z', '--commit', 'c1'],
        {
          cwd: repo,
          out: (s) => {
            out += s
          },
          err: (s) => {
            err += s
          },
        },
      )
      return { code: code as number, out, err }
    }

    // (1) No policy anywhere → motif `politique de termes privés absente`
    const noPol = runTable()
    expect(noPol.code, noPol.err).toBe(0)
    expect(noPol.out).toContain('politique de termes privés absente')

    // (2) Policy in state home only → masks `alphaomega` and drops absent-policy motif
    const stateHash = createHash('sha256').update('s1:alphaomega', 'utf8').digest('hex')
    writeFileSync(
      join(stateDir, 'owner-report-policy.json'),
      JSON.stringify({ salt: 's1', privateTermHashes: [stateHash] }),
      'utf8',
    )
    const statePol = runTable()
    expect(statePol.code, statePol.err).toBe(0)
    expect(statePol.out).not.toContain('politique de termes privés absente')
    expect(statePol.out).toContain('texte masqué (terme réservé), à réécrire')
    expect(statePol.out).not.toContain('alphaomega')

    // (3) Policy beside journal wins over state home (masks only `gammasigma`, so `alphaomega` is no longer masked)
    const journalHash = createHash('sha256').update('s2:gammasigma', 'utf8').digest('hex')
    writeFileSync(
      join(repo, '.track', 'owner-report-policy.json'),
      JSON.stringify({ salt: 's2', privateTermHashes: [journalHash] }),
      'utf8',
    )
    const journalPol = runTable()
    expect(journalPol.code, journalPol.err).toBe(0)
    expect(journalPol.out).not.toContain('politique de termes privés absente')
    expect(journalPol.out).toContain('alphaomega')
  })
})
