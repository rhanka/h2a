import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from './cli/index.js'
import { readHead } from './events/head.js'
import { EventStore } from './events/store.js'
import type { TrackEvent } from './events/types.js'
import { validate } from './events/validate.js'
import { fold } from './state/fold.js'
import { Track } from './track.js'

const TRACK_CLI_BIN = resolve(import.meta.dirname, '..', 'dist', 'cli', 'bin.js')

let scratch: string
let savedTrackDir: string | undefined

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: resolve(tmpdir()),
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

function initGitRepoWithTrack(dir: string): void {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'root')
  const rc = runCli(['init'], { cwd: dir, out: () => {}, err: () => {} })
  expect(rc).toBe(0)
}

function cli(cwd: string, args: string[], stdin?: string): { code: number; out: string; err: string } {
  let out = ''
  let err = ''
  const io = {
    cwd,
    out: (s: string) => {
      out += s
    },
    err: (s: string) => {
      err += s
    },
    ...(stdin !== undefined ? { stdin } : {}),
  }
  const code = runCli(args, io as Parameters<typeof runCli>[1])
  return { code: code as number, out, err }
}

function spawnCli(
  cwd: string,
  args: string[],
  stdinText?: string,
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = { ...process.env }
    delete env['TRACK_DIR']
    const child = spawn(process.execPath, [TRACK_CLI_BIN, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, out, err })
    })
    if (stdinText !== undefined) {
      child.stdin.write(stdinText)
    }
    child.stdin.end()
  })
}

function parseDemandRaiseLine(stdout: string): { demandId: string; number: number } {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  expect(lines, `expected one output line, got: ${JSON.stringify(stdout)}`).toHaveLength(1)
  const match = /^(\S+)\s+#(\d+)$/u.exec(lines[0]!)
  expect(match, `unexpected demand raise output: ${lines[0]}`).not.toBeNull()
  return { demandId: match![1]!, number: Number(match![2]!) }
}

function fingerprintTrackDir(trackDir: string): string {
  const hash = createHash('sha256')
  for (const name of ['events.jsonl', 'head.json']) {
    const p = join(trackDir, name)
    if (existsSync(p)) {
      hash.update(`${name}:`)
      hash.update(readFileSync(p))
      hash.update('\0')
    } else {
      hash.update(`${name}:ABSENT\0`)
    }
  }
  return hash.digest('hex')
}

/**
 * Stale-read EventStore wrapper: `readAll()` returns a frozen stale snapshot before the lock,
 * while `appendCommand` runs against the real underlying log under the file lock (for recheck tests).
 */
class StalePreLockStore extends EventStore {
  constructor(
    filePath: string,
    private readonly staleEvents: TrackEvent[],
  ) {
    super(filePath)
  }

  override readAll(): TrackEvent[] {
    return [...this.staleEvents]
  }
}

beforeEach(() => {
  savedTrackDir = process.env['TRACK_DIR']
  delete process.env['TRACK_DIR']
  scratch = mkdtempSync(join(tmpdir(), 'track-demand-write-'))
})

afterEach(() => {
  if (savedTrackDir === undefined) delete process.env['TRACK_DIR']
  else process.env['TRACK_DIR'] = savedTrackDir
  rmSync(scratch, { recursive: true, force: true })
})

describe('track demand raise (lot 2)', () => {
  it('one command creates a numbered demand and a replay with the same key creates nothing (T2-a)', async () => {
    const repo = join(scratch, 'repo-t2a')
    initGitRepoWithTrack(repo)
    const trackDir = join(repo, '.track')
    const eventsPath = join(trackDir, 'events.jsonl')

    // 1. First creation via built CLI with --key and --title
    const first = await spawnCli(repo, [
      'demand',
      'raise',
      '--text',
      'Rendre le tableau autonome',
      '--title',
      'Tableau autonome',
      '--key',
      'cap-key-001',
    ])
    expect(first.code, first.err).toBe(0)
    const parsed1 = parseDemandRaiseLine(first.out)
    expect(parsed1.number).toBe(1)

    const fpAfterFirst = fingerprintTrackDir(trackDir)
    const eventsAfterFirst = new EventStore(eventsPath).readAll()
    expect(eventsAfterFirst.filter((e) => e.type === 'demand.raised')).toHaveLength(1)
    expect(eventsAfterFirst.filter((e) => e.type === 'demand.owner-numbered')).toHaveLength(1)
    expect(eventsAfterFirst.filter((e) => e.type === 'demand.owner-summary-updated')).toHaveLength(1)
    const cmdIds = new Set(eventsAfterFirst.map((e) => e.cmdId))
    expect(cmdIds.size).toBe(1)
    expect([...cmdIds][0]).toBeDefined()

    // 2. Sequential replay with the same --key from a fresh CLI process
    const replay = await spawnCli(repo, [
      'demand',
      'raise',
      '--text',
      'Rendre le tableau autonome',
      '--title',
      'Tableau autonome',
      '--key',
      'cap-key-001',
    ])
    expect(replay.code, replay.err).toBe(0)
    const parsedReplay = parseDemandRaiseLine(replay.out)
    expect(parsedReplay).toEqual(parsed1)
    expect(fingerprintTrackDir(trackDir)).toBe(fpAfterFirst)

    // 3. Concurrent replays with a fresh shared --key from two fresh CLI processes
    const [concA, concB] = await Promise.all([
      spawnCli(repo, ['demand', 'raise', '--text', 'Demande concurrente idempotente', '--key', 'cap-key-concurrent']),
      spawnCli(repo, ['demand', 'raise', '--text', 'Demande concurrente idempotente', '--key', 'cap-key-concurrent']),
    ])
    expect(concA.code, concA.err).toBe(0)
    expect(concB.code, concB.err).toBe(0)
    const parsedA = parseDemandRaiseLine(concA.out)
    const parsedB = parseDemandRaiseLine(concB.out)
    expect(parsedA).toEqual(parsedB)
    expect(parsedA.number).toBe(2)

    const eventsAfterConc = new EventStore(eventsPath).readAll()
    expect(eventsAfterConc.filter((e) => e.type === 'demand.raised')).toHaveLength(2)
    expect(eventsAfterConc.filter((e) => e.type === 'demand.owner-numbered')).toHaveLength(2)
    expect(validate(eventsAfterConc, readHead(eventsPath)).ok).toBe(true)

    // 4. Subsequent replay after concurrent creation leaves journal byte-identical
    const fpAfterConc = fingerprintTrackDir(trackDir)
    const replayConc = await spawnCli(repo, [
      'demand',
      'raise',
      '--text',
      'Demande concurrente idempotente',
      '--key',
      'cap-key-concurrent',
    ])
    expect(replayConc.code, replayConc.err).toBe(0)
    expect(parseDemandRaiseLine(replayConc.out)).toEqual(parsedA)
    expect(fingerprintTrackDir(trackDir)).toBe(fpAfterConc)

    // 5. --stdin works and outside git requires --workspace
    const stdinRes = await spawnCli(repo, ['demand', 'raise', '--stdin', '--type', 'defect', '--source', 'agent'], 'Corriger la pagination\n')
    expect(stdinRes.code, stdinRes.err).toBe(0)
    const parsedStdin = parseDemandRaiseLine(stdinRes.out)
    expect(parsedStdin.number).toBe(3)
    const state = fold(new EventStore(eventsPath).readAll())
    const d3 = state.demands.get(parsedStdin.demandId)!
    expect(d3.raw.text).toBe('Corriger la pagination')
    expect(d3.type).toBe('defect')
    expect(d3.source.kind).toBe('agent')

    const nonGit = join(scratch, 'plain-dir')
    mkdirSync(nonGit, { recursive: true })
    expect(cli(nonGit, ['init']).code).toBe(0)
    const missingWs = cli(nonGit, ['demand', 'raise', '--text', 'Hors git sans workspace'])
    expect(missingWs.code).toBe(1)
    expect(missingWs.err).toMatch(/workspace/i)
    const withWs = cli(nonGit, ['demand', 'raise', '--text', 'Hors git avec workspace', '--workspace', 'ws:manual'])
    expect(withWs.code, withWs.err).toBe(0)
    expect(parseDemandRaiseLine(withWs.out).number).toBe(1)
  })

  it('two concurrent creations receive two distinct consecutive numbers (T2-b)', async () => {
    const repo = join(scratch, 'repo-t2b')
    initGitRepoWithTrack(repo)
    const eventsPath = join(repo, '.track', 'events.jsonl')

    // Seed an existing legacy numbered item (#1) to prove next numbers are 2 and 3 across the whole journal
    const seedTrack = new Track(new EventStore(eventsPath), { by: 'seed' })
    const legacyItem = seedTrack.createItem({ kind: 'feature', title: 'Legacy', workspace: 'ws:other' })
    seedTrack.setReportStatus(legacyItem, { ownerNumber: 1, ownerRequest: 'Ancienne demande' })

    const [p1, p2] = await Promise.all([
      spawnCli(repo, ['demand', 'raise', '--text', 'Demande parallele A']),
      spawnCli(repo, ['demand', 'raise', '--text', 'Demande parallele B']),
    ])
    expect(p1.code, p1.err).toBe(0)
    expect(p2.code, p2.err).toBe(0)

    const r1 = parseDemandRaiseLine(p1.out)
    const r2 = parseDemandRaiseLine(p2.out)
    expect(r1.demandId).not.toBe(r2.demandId)
    expect([r1.number, r2.number].sort((a, b) => a - b)).toEqual([2, 3])

    const events = new EventStore(eventsPath).readAll()
    const check = validate(events, readHead(eventsPath))
    expect(check.ok, JSON.stringify(check.findings)).toBe(true)
  })

  it('a demand and its number are one batch and no interruption leaves a hole (T2-d)', () => {
    const repo = join(scratch, 'repo-t2d')
    initGitRepoWithTrack(repo)
    const eventsPath = join(repo, '.track', 'events.jsonl')

    const res = cli(repo, ['demand', 'raise', '--text', 'Demande atomique'])
    expect(res.code, res.err).toBe(0)
    const { demandId, number } = parseDemandRaiseLine(res.out)
    expect(number).toBe(1)

    const events = new EventStore(eventsPath).readAll()
    const raised = events.find((e) => e.type === 'demand.raised' && e.aggregateId === demandId)
    const numbered = events.find((e) => e.type === 'demand.owner-numbered' && e.aggregateId === demandId)
    expect(raised).toBeDefined()
    expect(numbered).toBeDefined()
    expect(raised!.cmdId).toBeDefined()
    expect(numbered!.cmdId).toBe(raised!.cmdId)
    expect(raised!.cmd).toEqual({ i: 0, n: 2 })
    expect(numbered!.cmd).toEqual({ i: 1, n: 2 })
    expect(validate(events, readHead(eventsPath)).ok).toBe(true)

    // Recheck failure appends neither event: pre-lock read sees empty log (candidate #1),
    // under-lock real log already holds #1, and maxRetries: 0 fails loud without appending anything.
    const countBefore = events.length
    const staleStore = new StalePreLockStore(eventsPath, [])
    const staleTrack = new Track(staleStore, { by: 'race-tester' }) as Track & {
      raiseNumberedDemand: (input: Record<string, unknown>) => { demandId: string; number: number }
    }
    expect(() =>
      staleTrack.raiseNumberedDemand({
        type: 'feature',
        workspace: 'ws:race',
        raw: { text: 'Ne doit pas passer' },
        source: { kind: 'human' },
        maxRetries: 0,
      }),
    ).toThrow()

    const eventsAfterFail = new EventStore(eventsPath).readAll()
    expect(eventsAfterFail).toHaveLength(countBefore)
    expect(validate(eventsAfterFail, readHead(eventsPath)).ok).toBe(true)
  })

  it('from a linked worktree both commands write to the main checkout journal and leave the worktree copy untouched (T2-h)', async () => {
    const mainRepo = join(scratch, 'main-checkout')
    initGitRepoWithTrack(mainRepo)
    const mainTrackDir = join(mainRepo, '.track')
    const mainEventsPath = join(mainTrackDir, 'events.jsonl')

    // Seed an unnumbered legacy structured decision in main checkout journal so `decision number` can number it
    const mainStore = new EventStore(mainEventsPath)
    const seedTrack = new Track(mainStore, { by: 'seed', now: () => '2026-11-10T10:00:00.000Z' })
    const itemId = seedTrack.createItem({ kind: 'feature', title: 'Cible', workspace: 'ws:main' })
    const legacyDecId = '01K0T2HLEGACYDECISION00001'
    mainStore.appendCommand([
      {
        id: '01K0T2HLEGACYDECISIONEVT01',
        type: 'decision.created',
        aggregate: 'decision',
        aggregateId: legacyDecId,
        at: '2026-11-10T10:00:00.000Z',
        by: 'seed',
        payload: {
          decisionKind: 'commitment',
          title: 'Arbitrage à numéroter depuis un worktree ?',
          workspace: 'ws:main',
          targets: [itemId],
          dossier: {
            context: 'Choix structuré non numéroté.',
            qa: [],
            options: [
              { id: 'a', title: 'Option A', summary: 'Choix A' },
              { id: 'b', title: 'Option B', summary: 'Choix B' },
            ],
            recommendation: { optionId: 'a', rationale: 'Direct' },
            artifacts: [{ kind: 'rendered-view', viewRef: 'docs/dossiers/t2h.md' }],
          },
        },
      },
    ])

    // Commit .track so the linked worktree gets its own copy of .track
    writeFileSync(join(mainRepo, 'README.md'), 'main\n', 'utf8')
    git(mainRepo, 'add', 'README.md', '.track/events.jsonl', '.track/head.json')
    git(mainRepo, 'commit', '-q', '-m', 'seed journal')

    const wtDir = join(scratch, 'linked-wt')
    git(mainRepo, 'worktree', 'add', '-q', '-b', 'feat-wt', wtDir)
    const wtTrackDir = join(wtDir, '.track')
    expect(existsSync(join(wtTrackDir, 'events.jsonl'))).toBe(true)

    const mainFpBeforeRaise = fingerprintTrackDir(mainTrackDir)
    const wtFpBefore = fingerprintTrackDir(wtTrackDir)

    // 1. Run `track demand raise` from the linked worktree
    const raiseRes = await spawnCli(wtDir, ['demand', 'raise', '--text', 'Demande depuis worktree lié'])
    expect(raiseRes.code, raiseRes.err).toBe(0)
    const raised = parseDemandRaiseLine(raiseRes.out)
    expect(raised.number).toBe(1)

    expect(fingerprintTrackDir(wtTrackDir)).toBe(wtFpBefore)
    const mainFpAfterRaise = fingerprintTrackDir(mainTrackDir)
    expect(mainFpAfterRaise).not.toBe(mainFpBeforeRaise)
    expect(fold(new EventStore(mainEventsPath).readAll()).demands.get(raised.demandId)?.ownerNumber).toBe(1)

    // 2. Run `track decision number --all-unnumbered` from the linked worktree
    const numRes = await spawnCli(wtDir, ['decision', 'number', '--all-unnumbered'])
    expect(numRes.code, numRes.err).toBe(0)

    expect(fingerprintTrackDir(wtTrackDir)).toBe(wtFpBefore)
    expect(fingerprintTrackDir(mainTrackDir)).not.toBe(mainFpAfterRaise)
    const mainStateAfter = fold(new EventStore(mainEventsPath).readAll())
    expect(mainStateAfter.decisions.get(legacyDecId)?.ownerNumber).toBe(1)
    expect(fold(new EventStore(join(wtTrackDir, 'events.jsonl')).readAll()).decisions.get(legacyDecId)?.ownerNumber).toBeUndefined()
  })
})
