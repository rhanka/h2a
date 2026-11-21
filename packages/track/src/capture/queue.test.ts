import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { identityOf } from '../journal/identity.js'
import {
  captureDirForIdentity,
  captureRootDir,
  listCaptures,
  readCaptureEntry,
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

describe('capture queue, permissions, dismissal and hook-safety (lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-queue-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    try {
      chmodSync(stateHome, 0o700)
    } catch {
      // ignore
    }
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-a: queue folders are mode 0700 and queue files are mode 0600 (user only)', () => {
    const project = join(scratch, 'project-a')
    const workDir = join(project, 'sub')
    mkdirSync(workDir, { recursive: true })

    const payload = JSON.stringify({
      prompt: 'Ajouter le tri par date dans le tableau',
      session_id: 'sess-alpha-1',
      cwd: workDir,
      transcript_path: '/var/log/cli/sess-alpha-1.jsonl',
    })
    const res = cli(workDir, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
      stdin: payload,
    })
    expect(res.code).toBe(0)
    expect(res.out).toBe('')

    const ident = identityOf(workDir)
    const rootDir = captureRootDir(process.env)
    const idDir = captureDirForIdentity(ident.id, process.env)

    expect(statSync(stateHome).mode & 0o777).toBe(0o700)
    expect(statSync(rootDir).mode & 0o777).toBe(0o700)
    expect(statSync(idDir).mode & 0o777).toBe(0o700)

    const files = readdirSync(idDir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBe(1)
    const entryPath = join(idDir, files[0]!)
    expect(statSync(entryPath).mode & 0o777).toBe(0o600)

    const entry = readCaptureEntry(ident.id, files[0]!.replace(/\.json$/u, ''), process.env)
    expect(entry).toBeDefined()
    expect(entry!.cli).toBe('claude')
    expect(entry!.session).toBe('sess-alpha-1')
    expect(entry!.origin).toBe('owner')
    expect(entry!.text).toBe('Ajouter le tri par date dans le tableau')
    expect(entry!.transcript).toBe('/var/log/cli/sess-alpha-1.jsonl')
    expect(entry!.state).toBe('captured')
    expect(entry!.announced).toBe(false)
  })

  it('T3a-k: classifying a message as not-a-demand deletes its text immediately and inscribes nothing', () => {
    const project = join(scratch, 'project-k')
    mkdirSync(project, { recursive: true })

    const rawText = 'Merci, c est juste un bonjour sans suite'
    const addRes = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
      stdin: JSON.stringify({ prompt: rawText, session_id: 'sess-k', cwd: project }),
    })
    expect(addRes.code).toBe(0)
    expect(addRes.out).toBe('')

    const ident = identityOf(project)
    const entries = listCaptures(ident.id, { env: process.env })
    expect(entries).toHaveLength(1)
    const capId = entries[0]!.id

    const clsRes = cli(project, ['capture', 'classify', capId, '--as', 'not-a-demand'])
    expect(clsRes.code, clsRes.err).toBe(0)

    const updated = readCaptureEntry(ident.id, capId, process.env)
    expect(updated).toBeDefined()
    expect(updated!.state).toBe('dismissed')
    expect(updated!.text).toBeNull()

    const rawFile = readFileSync(join(captureDirForIdentity(ident.id, process.env), `${capId}.json`), 'utf8')
    expect(rawFile).not.toContain(rawText)
    // No journal created for a dismissed entry
    expect(existsSync(join(project, '.track'))).toBe(false)
    expect(existsSync(join(stateHome, 'journals'))).toBe(false)
  })

  it('T3a-l: track capture add prints nothing on stdout and exits 0 on every failure path', () => {
    const project = join(scratch, 'project-l')
    mkdirSync(project, { recursive: true })

    // 1. Missing --cli
    const r1 = cli(project, ['capture', 'add', '--stdin'], { stdin: 'hello' })
    expect(r1.code).toBe(0)
    expect(r1.out).toBe('')
    expect(r1.err.length).toBeGreaterThan(0)

    // 2. Empty stdin
    const r2 = cli(project, ['capture', 'add', '--cli', 'claude', '--stdin'], { stdin: '   \n' })
    expect(r2.code).toBe(0)
    expect(r2.out).toBe('')
    expect(r2.err.length).toBeGreaterThan(0)

    // 3. Invalid --origin
    const r3 = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'bogus', '--stdin'], {
      stdin: 'test message',
    })
    expect(r3.code).toBe(0)
    expect(r3.out).toBe('')
    expect(r3.err.length).toBeGreaterThan(0)

    // 4. Unwritable state home (file where directory is expected)
    const blockedHome = join(scratch, 'blocked-home-file')
    writeFileSync(blockedHome, 'not-a-dir', 'utf8')
    const r4 = cli(
      project,
      ['capture', 'add', '--cli', 'claude', '--stdin'],
      { stdin: 'test message', env: { ...process.env, TRACK_STATE_HOME: blockedHome } },
    )
    expect(r4.code).toBe(0)
    expect(r4.out).toBe('')
    expect(r4.err.length).toBeGreaterThan(0)
  })

  it('extracts payload fields in h2a order, infers injected/doubtful origin, and supports list/status/remind', () => {
    const project = join(scratch, 'project-meta')
    mkdirSync(project, { recursive: true })

    // Nested params payload without --origin -> doubtful (Track alone never concludes owner)
    const r1 = cli(project, ['capture', 'add', '--cli', 'codex', '--stdin'], {
      stdin: JSON.stringify({
        conversationId: 'conv-42',
        cwd: project,
        params: { input: 'Créer le rapport mensuel' },
      }),
    })
    expect(r1.code).toBe(0)
    expect(r1.out).toBe('')

    // Injected marker without --origin -> injected
    const r2 = cli(project, ['capture', 'add', '--cli', 'codex', '--stdin'], {
      stdin: JSON.stringify({
        thread_id: 'conv-42',
        cwd: project,
        text: '[h2a drive] continue la tâche',
      }),
    })
    expect(r2.code).toBe(0)
    expect(r2.out).toBe('')

    // Custom --text-key
    const r3 = cli(project, ['capture', 'add', '--cli', 'codex', '--text-key', 'body', '--stdin'], {
      stdin: JSON.stringify({
        sessionId: 'conv-42',
        cwd: project,
        body: 'Message via clé personnalisée',
      }),
    })
    expect(r3.code).toBe(0)
    expect(r3.out).toBe('')

    const listRes = cli(project, ['capture', 'list', '--session', 'conv-42', '--format', 'json'])
    expect(listRes.code, listRes.err).toBe(0)
    const listed = JSON.parse(listRes.out) as Array<{ id: string; origin: string; text: string; announced: boolean }>
    expect(listed).toHaveLength(3)
    expect(listed.map((e) => e.origin)).toEqual(['doubtful', 'injected', 'doubtful'])

    // End-of-turn remind returns unannounced unclassified entries for that session and marks them announced
    const rem1 = cli(project, ['capture', 'remind', '--cli', 'codex', '--stdin', '--format', 'json'], {
      stdin: JSON.stringify({ session_id: 'conv-42', cwd: project }),
    })
    expect(rem1.code, rem1.err).toBe(0)
    const remList1 = JSON.parse(rem1.out) as Array<{ id: string }>
    expect(remList1).toHaveLength(3)

    // Second remind for same session returns 0 entries (already announced)
    const rem2 = cli(project, ['capture', 'remind', '--cli', 'codex', '--stdin', '--format', 'json'], {
      stdin: JSON.stringify({ session_id: 'conv-42', cwd: project }),
    })
    expect(rem2.code, rem2.err).toBe(0)
    const remList2 = JSON.parse(rem2.out) as Array<{ id: string }>
    expect(remList2).toHaveLength(0)

    // capture status returns registry + per-identity counts
    const statusRes = cli(project, ['capture', 'status', '--format', 'json'])
    expect(statusRes.code, statusRes.err).toBe(0)
    const statusJson = JSON.parse(statusRes.out) as {
      registry: { version: number; clis: Record<string, unknown> }
      identities: Record<string, Record<string, number>>
    }
    const ident = identityOf(project)
    expect(statusJson.identities[ident.id]?.['captured']).toBe(3)
  })
})
