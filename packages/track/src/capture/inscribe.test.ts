import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { EventStore } from '../events/store.js'
import { identityOf } from '../journal/identity.js'
import { fold } from '../state/fold.js'
import { Track } from '../track.js'
import { captureDirForIdentity, listCaptures, readCaptureEntry } from './queue.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILT_BIN = resolve(HERE, '../../dist/cli/bin.js')

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(home: string): void {
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_WRITER_TOKEN: process.env['TRACK_WRITER_TOKEN'],
    TRACK_OWNER_POLICY_FILE: process.env['TRACK_OWNER_POLICY_FILE'],
    TRACK_OWNER_REPORT_POLICY: process.env['TRACK_OWNER_REPORT_POLICY'],
  }
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_WRITER_TOKEN']
  delete process.env['TRACK_OWNER_POLICY_FILE']
  delete process.env['TRACK_OWNER_REPORT_POLICY']
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

function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test\n', 'utf8')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

describe('classification, inscription, masking, idempotency and attribution (T3a-d, T3a-e, T3a-f, T3a-j, T3a-o)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-inscribe-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-d: inscribed text is byte-identical to captured text for new-demand, follow-up, and decision-answer without settling decision', () => {
    const project = join(scratch, 'proj-verbatim')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const ident = identityOf(project)
    const verbatimDemand = 'Je veux un filtre par date — exact, avec « guillemets » et\nsaut de ligne!'
    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: verbatimDemand, session_id: 's1', cwd: project }),
      }).code,
    ).toBe(0)

    const cap1 = listCaptures(ident.id, { env: process.env })[0]!
    const cls1 = cli(project, [
      'capture',
      'classify',
      cap1.id,
      '--as',
      'new-demand',
      '--title',
      'Filtre par date',
    ])
    expect(cls1.code, cls1.err).toBe(0)

    const store = new EventStore(join(project, '.track', 'events.jsonl'))
    let events = store.readAll()
    let state = fold(events)
    const demand = [...state.demands.values()][0]!
    expect(demand.raw.text).toBe(verbatimDemand)
    expect(demand.ownerNumber).toBe(1)
    expect(demand.captured).toBe(true)
    expect(demand.captureOrigin).toBe('owner')

    // Queue text purged after inscription
    const cap1After = readCaptureEntry(ident.id, cap1.id, process.env)!
    expect(cap1After.state).toBe('inscribed')
    expect(cap1After.text).toBeNull()

    // Follow-up on demand #1
    const verbatimFollowUp = 'Précision : inclure aussi les dates UTC exactes.'
    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: verbatimFollowUp, session_id: 's1', cwd: project }),
      }).code,
    ).toBe(0)
    const cap2 = listCaptures(ident.id, { env: process.env }).find((e) => e.state === 'captured')!
    const cls2 = cli(project, ['capture', 'classify', cap2.id, '--as', 'follow-up', '--demand', '1'])
    expect(cls2.code, cls2.err).toBe(0)

    events = store.readAll()
    state = fold(events)
    const updatedDemand = state.demands.get(demand.id)!
    expect(updatedDemand.ownerMessages).toHaveLength(1)
    expect(updatedDemand.ownerMessages![0]!.text).toBe(verbatimFollowUp)
    expect(updatedDemand.ownerMessages![0]!.captureId).toBe(cap2.id)
    expect(readCaptureEntry(ident.id, cap2.id, process.env)!.text).toBeNull()

    // Decision answer: records owner message on decision, NEVER settles decision!
    const track = new Track(store, { by: 'human:tester' })
    const decId = track.createDecision({
      decisionKind: 'orientation',
      title: 'Choisir le format export',
      workspace: ident.id,
      targets: [demand.id],
      dossier: {
        context: 'Export du tableau',
        options: [
          { id: 'opt-a', title: 'CSV', summary: 'Simple' },
          { id: 'opt-b', title: 'JSON', summary: 'Structuré' },
        ],
        qa: [],
        recommendation: { optionId: 'opt-a', rationale: 'Plus rapide' },
      },
    })

    const verbatimAnswer = 'On part plutôt sur l option A, merci.'
    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: verbatimAnswer, session_id: 's1', cwd: project }),
      }).code,
    ).toBe(0)
    const cap3 = listCaptures(ident.id, { env: process.env }).find((e) => e.state === 'captured')!
    const cls3 = cli(project, [
      'capture',
      'classify',
      cap3.id,
      '--as',
      'decision-answer',
      '--decision',
      'D1',
    ])
    expect(cls3.code, cls3.err).toBe(0)

    events = store.readAll()
    state = fold(events)
    const dec = state.decisions.get(decId)!
    expect(dec.outcome).toBe('pending') // NEVER settled!
    expect(dec.ownerMessages).toHaveLength(1)
    expect(dec.ownerMessages![0]!.text).toBe(verbatimAnswer)
    expect(dec.ownerMessages![0]!.captureId).toBe(cap3.id)
    expect(readCaptureEntry(ident.id, cap3.id, process.env)!.text).toBeNull()
  })

  it('T3a-e: a private term is masked at inscription into a versioned journal and marked masqué', () => {
    const repo = join(scratch, 'versioned-repo')
    initGitRepo(repo)
    expect(cli(repo, ['init']).code).toBe(0)

    const secretClientTerm = 'zephyrcorp'
    const salt = 'lot3a-salt'
    const policyPath = join(stateHome, 'owner-report-policy.json')
    mkdirSync(stateHome, { recursive: true })
    writeFileSync(
      policyPath,
      JSON.stringify({
        salt,
        privateTermHashes: [sha256Hex(`${salt}:${secretClientTerm}`)],
      }),
      'utf8',
    )

    const rawMsg = `Préparer la démo pour ${secretClientTerm} avant vendredi`
    expect(
      cli(repo, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: rawMsg, session_id: 's-priv', cwd: repo }),
      }).code,
    ).toBe(0)

    const ident = identityOf(repo)
    const cap = listCaptures(ident.id, { env: process.env })[0]!
    const cls = cli(repo, [
      'capture',
      'classify',
      cap.id,
      '--as',
      'new-demand',
      '--title',
      'Démo vendredi',
    ])
    expect(cls.code, cls.err).toBe(0)

    // Raw private term must NEVER appear in the versioned events.jsonl!
    const eventsRaw = readFileSync(join(repo, '.track', 'events.jsonl'), 'utf8')
    expect(eventsRaw.toLowerCase()).not.toContain(secretClientTerm)
    expect(eventsRaw).toContain('[terme masqué]')

    // Folded demand is marked maskedAtInscription and rendered with `masqué`
    const state = fold(new EventStore(join(repo, '.track', 'events.jsonl')).readAll())
    const demand = [...state.demands.values()][0]!
    expect(demand.maskedAtInscription).toBe(true)

    const rep = cli(repo, ['report', '--owner-table'])
    expect(rep.code, rep.err).toBe(0)
    expect(rep.out.toLowerCase()).not.toContain(secretClientTerm)
    expect(rep.out).toContain('[terme masqué]')
    expect(rep.out).toContain('masqué')
  })

  it('T3a-f: on an open journal classification inscribes at once with no h2a package resolvable (off-repo created)', () => {
    const folder = join(scratch, 'standalone-folder')
    mkdirSync(folder, { recursive: true })

    // Loader hook that blocks any @sentropic/h2a* import to prove Track stands alone (V10)
    const blockH2aHook = join(scratch, 'block-h2a-loader.mjs')
    writeFileSync(
      blockH2aHook,
      [
        "import { register } from 'node:module';",
        'const hookSrc = `',
        '  export async function resolve(specifier, context, nextResolve) {',
        "    const isH2aPkg = specifier.startsWith('@sentropic/h2a') || specifier.includes('/packages/h2a/') || specifier.includes('/packages/h2a-');",
        "    if (isH2aPkg && !specifier.includes('native-isolation.js')) {",
        "      throw new Error('FORBIDDEN_H2A_IMPORT: ' + specifier);",
        '    }',
        '    return nextResolve(specifier, context);',
        '  }',
        '`;',
        "register('data:text/javascript,' + encodeURIComponent(hookSrc));",
      ].join('\n'),
      'utf8',
    )

    const env = { ...process.env, TRACK_STATE_HOME: stateHome }
    delete env['TRACK_DIR']
    delete env['TRACK_WRITER_TOKEN']

    // Capture via built CLI without h2a
    const addOut = execFileSync(
      process.execPath,
      ['--import', blockH2aHook, BUILT_BIN, 'capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'],
      {
        cwd: folder,
        env,
        input: JSON.stringify({ prompt: 'Fonctionne tout seul sans h2a', session_id: 's-solo', cwd: folder }),
        encoding: 'utf8',
      },
    )
    expect(addOut).toBe('')

    const ident = identityOf(folder)
    const cap = listCaptures(ident.id, { env })[0]!

    // Classify via built CLI without h2a -> creates off-repo journal and inscribes at once
    const clsOut = execFileSync(
      process.execPath,
      [
        '--import',
        blockH2aHook,
        BUILT_BIN,
        'capture',
        'classify',
        cap.id,
        '--as',
        'new-demand',
        '--title',
        'Autonomie complète',
      ],
      { cwd: folder, env, encoding: 'utf8' },
    )
    expect(clsOut).toContain('#1')

    // Nothing written inside the folder itself; off-repo journal created under stateHome
    expect(existsSync(join(folder, '.track'))).toBe(false)
    const repOut = execFileSync(
      process.execPath,
      ['--import', blockH2aHook, BUILT_BIN, 'report', '--owner-table'],
      { cwd: folder, env, encoding: 'utf8' },
    )
    expect(repOut).toContain('journal hors dépôt')
    expect(repOut).toContain('Fonctionne tout seul sans h2a')
  })

  it('T3a-j: inscribing the same capture twice after a simulated crash before queue ack writes nothing more', () => {
    const project = join(scratch, 'proj-idem')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const env = { ...process.env, TRACK_STATE_HOME: stateHome }
    delete env['TRACK_DIR']
    delete env['TRACK_WRITER_TOKEN']

    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Demande idempotente critique', session_id: 's-idem', cwd: project }),
      }).code,
    ).toBe(0)

    const ident = identityOf(project)
    const cap = listCaptures(ident.id, { env })[0]!
    expect(
      cli(project, ['capture', 'classify', cap.id, '--as', 'new-demand', '--title', 'Idempotence']).code,
    ).toBe(0)

    const eventsPath = join(project, '.track', 'events.jsonl')
    const eventsAfterFirst = new EventStore(eventsPath).readAll()
    const raisedFirst = eventsAfterFirst.filter((e) => e.type === 'demand.raised')
    expect(raisedFirst).toHaveLength(1)

    // Simulate interruption between committed journal batch and queue acknowledgement:
    // revert the queue entry back to `classified` with its text still present.
    const entryPath = join(captureDirForIdentity(ident.id, env), `${cap.id}.json`)
    const persistedEntry = JSON.parse(readFileSync(entryPath, 'utf8')) as Record<string, unknown>
    persistedEntry['state'] = 'classified'
    persistedEntry['text'] = 'Demande idempotente critique'
    delete persistedEntry['inscribed']
    writeFileSync(entryPath, `${JSON.stringify(persistedEntry, null, 2)}\n`, 'utf8')

    // Retry from a NEW built CLI process
    const retryOut = execFileSync(process.execPath, [BUILT_BIN, 'capture', 'inscribe', cap.id], {
      cwd: project,
      env,
      encoding: 'utf8',
    })
    expect(retryOut).toContain('#1')

    const eventsAfterRetry = new EventStore(eventsPath).readAll()
    expect(eventsAfterRetry.length).toBe(eventsAfterFirst.length)
    const demands = [...fold(eventsAfterRetry).demands.values()]
    expect(demands).toHaveLength(1)
    expect(demands[0]!.id).toBe(raisedFirst[0]!.aggregateId)
    expect(demands[0]!.ownerNumber).toBe(1)

    // Queue entry is now acknowledged as inscribed with text purged
    const finalEntry = readCaptureEntry(ident.id, cap.id, env)!
    expect(finalEntry.state).toBe('inscribed')
    expect(finalEntry.text).toBeNull()
  })

  it('T3a-o: injected/subagent/background entries are refused for demand/follow-up/answer; doubtful becomes a demand unquoted', () => {
    const project = join(scratch, 'proj-origin')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const ident = identityOf(project)

    // Forbidden origins: injected, subagent, background
    for (const origin of ['injected', 'subagent', 'background'] as const) {
      expect(
        cli(project, ['capture', 'add', '--cli', 'claude', '--origin', origin, '--stdin'], {
          stdin: JSON.stringify({ prompt: `Message ${origin}`, session_id: `s-${origin}`, cwd: project }),
        }).code,
      ).toBe(0)
      const cap = listCaptures(ident.id, { env: process.env }).find((e) => e.origin === origin)!

      const rNew = cli(project, ['capture', 'classify', cap.id, '--as', 'new-demand', '--title', 'Interdit'])
      expect(rNew.code).toBe(1)

      const rFollow = cli(project, ['capture', 'classify', cap.id, '--as', 'follow-up', '--demand', '1'])
      expect(rFollow.code).toBe(1)

      const rDec = cli(project, ['capture', 'classify', cap.id, '--as', 'decision-answer', '--decision', 'D1'])
      expect(rDec.code).toBe(1)

      // Dismissing as not-a-demand IS allowed
      const rDismiss = cli(project, ['capture', 'classify', cap.id, '--as', 'not-a-demand'])
      expect(rDismiss.code, rDismiss.err).toBe(0)
    }

    // Doubtful origin: allowed to become a demand, rendered UNQUOTED with `(capté, origine non prouvée)`
    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Texte origine douteuse', session_id: 's-doubt', cwd: project }),
      }).code,
    ).toBe(0)
    const doubtfulCap = listCaptures(ident.id, { env: process.env }).find((e) => e.origin === 'doubtful')!
    expect(
      cli(project, [
        'capture',
        'classify',
        doubtfulCap.id,
        '--as',
        'new-demand',
        '--title',
        'Demande douteuse',
      ]).code,
    ).toBe(0)

    // Owner origin: rendered QUOTED with « ... »
    expect(
      cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Texte prouvé owner', session_id: 's-owner', cwd: project }),
      }).code,
    ).toBe(0)
    const ownerCap = listCaptures(ident.id, { env: process.env }).find((e) => e.origin === 'owner')!
    expect(
      cli(project, [
        'capture',
        'classify',
        ownerCap.id,
        '--as',
        'new-demand',
        '--title',
        'Demande prouvée',
      ]).code,
    ).toBe(0)

    const rep = cli(project, ['report', '--owner-table'])
    expect(rep.code, rep.err).toBe(0)
    expect(rep.out).toContain('Demande douteuse — Texte origine douteuse (capté, origine non prouvée)')
    expect(rep.out).not.toContain('« Texte origine douteuse »')
    expect(rep.out).toContain('Demande prouvée — « Texte prouvé owner »')
  })
})
