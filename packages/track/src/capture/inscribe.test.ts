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
import { appendCapture, captureDirForIdentity, listCaptures, readCaptureEntry, sweepExpiredQueues } from './queue.js'

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

    const env: NodeJS.ProcessEnv = { ...process.env, TRACK_STATE_HOME: stateHome }
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

    const env: NodeJS.ProcessEnv = { ...process.env, TRACK_STATE_HOME: stateHome }
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

  it('C1: masks secrets and private terms in acknowledge --as late-demand, masks --title in classify/inscribe, and purges classification.title after inscription', () => {
    const repo = join(scratch, 'repo-c1-inscribe')
    initGitRepo(repo)
    expect(cli(repo, ['init']).code).toBe(0)

    const secretClientTerm = 'orioncorp'
    const salt = 'c1-salt'
    mkdirSync(stateHome, { recursive: true })
    writeFileSync(
      join(stateHome, 'owner-report-policy.json'),
      JSON.stringify({ salt, privateTermHashes: [sha256Hex(`${salt}:${secretClientTerm}`)] }),
      'utf8',
    )

    const syntheticKey = ['sk', 'ant', 'api03', 'SyntheticTitleAndAckSecret0123456789'].join('-')
    const ident = identityOf(repo)

    // 1. classify --title containing a secret must mask before queue AND journal, and purge title after inscription
    expect(
      cli(repo, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Demande normale', session_id: 's-c1', cwd: repo }),
      }).code,
    ).toBe(0)
    const cap1 = listCaptures(ident.id, { env: process.env })[0]!
    const titleSecret = `Titre avec ${syntheticKey}`
    const cls = cli(repo, ['capture', 'classify', cap1.id, '--as', 'new-demand', '--title', titleSecret])
    expect(cls.code, cls.err).toBe(0)

    const eventsRaw1 = readFileSync(join(repo, '.track', 'events.jsonl'), 'utf8')
    expect(eventsRaw1).not.toContain(syntheticKey)
    expect(eventsRaw1).toContain('[secret masqué : anthropic-key]')

    const cap1Disk = readFileSync(join(captureDirForIdentity(ident.id, process.env), `${cap1.id}.json`), 'utf8')
    expect(cap1Disk).not.toContain(syntheticKey)
    const cap1Parsed = readCaptureEntry(ident.id, cap1.id, process.env)!
    expect(cap1Parsed.state).toBe('inscribed')
    expect(cap1Parsed.classification?.title).toBeUndefined()

    // 2. acknowledge --as late-demand must mask secrets AND private terms in versioned journal
    const t0 = '2026-11-10T10:00:00.000Z'
    const tExp = '2026-11-15T10:00:00.000Z'
    expect(
      cli(repo, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', t0, '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Expirera', session_id: 's-c1-exp', cwd: repo }),
      }).code,
    ).toBe(0)
    sweepExpiredQueues({ env: process.env, now: tExp })
    const expCap = listCaptures(ident.id, { env: process.env, now: tExp }).find((e) => e.state === 'expired')!

    const ackRes = cli(repo, [
      'capture',
      'acknowledge',
      expCap.id,
      '--as',
      'late-demand',
      '--title',
      `Relance ${secretClientTerm} ${syntheticKey}`,
      '--text',
      `Pour ${secretClientTerm} avec DB_PASSWORD=SyntheticLatePassword99`,
      '--now',
      tExp,
    ])
    expect(ackRes.code, ackRes.err).toBe(0)

    const eventsRaw2 = readFileSync(join(repo, '.track', 'events.jsonl'), 'utf8')
    expect(eventsRaw2.toLowerCase()).not.toContain(secretClientTerm)
    expect(eventsRaw2).not.toContain(syntheticKey)
    expect(eventsRaw2).not.toContain('SyntheticLatePassword99')
    expect(eventsRaw2).toContain('[terme masqué]')
    expect(eventsRaw2).toContain('[secret masqué : secret-assignment]')

    const state = fold(new EventStore(join(repo, '.track', 'events.jsonl')).readAll())
    const lateDemand = [...state.demands.values()].find((d) => d.ownerNumber === 2)!
    expect(lateDemand.maskedAtInscription).toBe(true)
  })

  it('C2: injection markers (including [h2a-wake ...]) ALWAYS override --origin owner, and Track facade rejects forbidden capture origins', () => {
    const project = join(scratch, 'proj-c2-injection')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const ident = identityOf(project)
    const injectedPayloads = [
      '[h2a drive] continuer la tâche',
      '[h2a-wake reason=inbox pending=2] réveil automatique',
      '[H2A-WAKE reason=cron] tâche planifiée',
      '<SYSTEM_MESSAGE>consigne interne</SYSTEM_MESSAGE>',
      '<system-reminder>rappel automatique</system-reminder>',
    ]

    for (let i = 0; i < injectedPayloads.length; i++) {
      const addRes = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: injectedPayloads[i], session_id: `s-inj-${i}`, cwd: project }),
      })
      expect(addRes.code).toBe(0)
      expect(addRes.out).toBe('')
    }

    const entries = listCaptures(ident.id, { env: process.env })
    expect(entries).toHaveLength(injectedPayloads.length)
    for (const e of entries) {
      expect(e.origin, `expected injected for "${e.text}"`).toBe('injected')
      const cls = cli(project, ['capture', 'classify', e.id, '--as', 'new-demand', '--title', 'Tentative'])
      expect(cls.code).toBe(1)
    }

    // Defense in depth: direct appendCapture with origin 'owner' on [h2a-wake ...] forces 'injected'
    const direct = appendCapture(
      {
        cli: 'claude',
        session: 's-direct',
        folder: project,
        identity: ident.id,
        origin: 'owner',
        rawText: '[h2a-wake reason=test] ping',
        transcript: null,
      },
      { env: process.env },
    )
    expect(direct.origin).toBe('injected')

    // Track public facade rejects forbidden origins for capture transport & owner messages
    const store = new EventStore(join(project, '.track', 'events.jsonl'))
    const okTrack = new Track(store, { by: 'human:tester' })
    const { demandId } = okTrack.raiseNumberedDemand({
      type: 'feature',
      raw: { text: 'Demande légitime' },
      source: { kind: 'human' },
      workspace: ident.id,
    })
    const decId = okTrack.createDecision({
      decisionKind: 'orientation',
      title: 'Choix',
      workspace: ident.id,
      targets: [demandId],
      dossier: {
        context: 'ctx',
        options: [
          { id: 'a', title: 'A', summary: 'A' },
          { id: 'b', title: 'B', summary: 'B' },
        ],
        qa: [],
        recommendation: { optionId: 'a', rationale: 'r' },
      },
    })

    for (const badOrigin of ['injected', 'subagent', 'background'] as const) {
      const badTrack = new Track(store, {
        by: 'human:tester',
        prov: { transport: 'capture', proposed: false, auth: 'local-user', origin: badOrigin },
      })
      expect(() =>
        badTrack.raiseNumberedDemand({
          type: 'feature',
          raw: { text: 'Injecté' },
          source: { kind: 'human' },
          workspace: ident.id,
        }),
      ).toThrow(/origin/iu)
      expect(() =>
        okTrack.addDemandOwnerMessage(demandId, {
          captureId: `cap-${badOrigin}`,
          at: '2026-11-20T10:00:00.000Z',
          origin: badOrigin,
          text: 'Injecté',
        }),
      ).toThrow(/origin/iu)
      expect(() =>
        okTrack.addDecisionOwnerMessage(decId, {
          captureId: `cap-dec-${badOrigin}`,
          at: '2026-11-20T10:00:00.000Z',
          origin: badOrigin,
          text: 'Injecté',
        }),
      ).toThrow(/origin/iu)
    }
  })
})
