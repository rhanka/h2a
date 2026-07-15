import { createHash } from 'node:crypto'
import type { SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canonicalize } from '../events/canonical.js'
import { EventStore } from '../events/store.js'
import { TrackReader } from '../read/contract.js'
import { Track } from '../track.js'
import {
  AiReportError,
  buildReportContext,
  generateAiReport,
  normalizeAiText,
  renderAiReport,
  reporterEnvironment,
  REPORTER_TIMEOUT_DEFAULT_MS,
  REPORTER_TIMEOUT_MAX_MS,
  REPORTER_TIMEOUT_MIN_MS,
  resolveReporterConfig,
  resolveReporterArgv,
  type AiReportRequest,
  type AiReportResultV1,
  type ReportContextEnvelopeV1,
} from './ai-report.js'

let dir: string
let eventsPath: string
let reader: TrackReader
let openDecision: string
let closedDecision: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'track-ai-report-'))
  eventsPath = join(dir, '.track', 'events.jsonl')
  let n = 0
  const track = new Track(new EventStore(eventsPath), {
    by: 'tester', now: () => '2026-07-14T12:00:00.000Z', newId: () => `id-${++n}`,
  })
  const item = track.createItem({ kind: 'feature', title: 'Do work sk-secret-value-123456', workspace: 'ws' })
  openDecision = track.createDecision({
    decisionKind: 'orientation', title: 'Open choice', workspace: 'ws', targets: [item],
    dossier: { context: 'choose', options: [], qa: [] },
  })
  closedDecision = track.createDecision({
    decisionKind: 'orientation', title: 'Closed choice', workspace: 'ws', targets: [item],
    dossier: { context: 'chosen', options: [], qa: [] },
  })
  track.setOutcome(closedDecision, 'go')
  reader = new TrackReader(eventsPath)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const request = (): AiReportRequest => ({
  baselineInput: 'HEAD', baselineCommit: 'abc', format: 'text', emphasis: 'default',
  requireAccepted: false, decisionEmphasis: 'open-only', activeRoster: false,
})

function spawnResult(stdout: string, status = 0, stderr = ''): SpawnSyncReturns<string> {
  return { pid: 1, output: [null, stdout, stderr], stdout, stderr, status, signal: null }
}

function spawnError(code: string): SpawnSyncReturns<string> {
  const error = Object.assign(new Error(code), { code })
  return { ...spawnResult('', 0), error }
}

function adapterResult(ref: string, text = 'Useful <script>alert(1)</script>'): AiReportResultV1 {
  const sections = {
    summary: [{ id: 's1', text, citations: [{ ref }] }],
    facts: [], changes: [], activeWork: [], blockers: [], ownerDecisions: [], suggestions: [], uncertainty: [],
  }
  return {
    schema: 'track.ai-report.result/v1',
    adapter: { provider: 'fake', model: 'fake-model', identity: 'adapter-reported' },
    sections,
  }
}

function fakeSpawn(
  adapter: (input: ReportContextEnvelopeV1) => unknown = (input) => adapterResult(input.context.references[0]!.ref),
  h2aReply: { stdout: string; stderr?: string } = {
    stdout: JSON.stringify({ schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: dir, entries: [], omitted: 0 }),
  },
  adapterSuffix = '',
  adapterStderr = '',
  observeAdapter?: (options: { input?: string; timeout?: number }) => void,
  adapterErrorCode?: string,
) {
  return ((command: string, args: string[], options: { input?: string; timeout?: number }) => {
    if (command === 'git' && args.includes('--show-toplevel')) return spawnResult(`${dir}\n`)
    if (command === 'git' && args[0] === 'log') return spawnResult('abc123\tinitial commit')
    if (command === 'git') return spawnResult('')
    if (command === 'h2a') return spawnResult(h2aReply.stdout, 0, h2aReply.stderr ?? '')
    observeAdapter?.(options)
    if (adapterErrorCode !== undefined) return spawnError(adapterErrorCode)
    const input = JSON.parse(options.input ?? '{}') as ReportContextEnvelopeV1
    return spawnResult(`${JSON.stringify(adapter(input))}${adapterSuffix}`, 0, adapterStderr)
  }) as never
}

describe('AI report context and adapter boundary', () => {
  it('should hash the exact canonical redacted context and omit secret values', () => {
    const envelope = buildReportContext({ reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } }, { spawn: fakeSpawn() })
    const bytes = canonicalize(envelope.context)
    expect(envelope.contextDigest).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(bytes).not.toContain('sk-secret-value-123456')
    expect(bytes).toContain('[REDACTED_TOKEN]')
    expect(envelope.context.references.map((ref) => ref.ref)).toContain('source:h2a')
    expect(envelope.context.references.some((ref) => ref.ref.startsWith('track:blocker:'))).toBe(true)
  })

  it('should validate citations and render model strings as escaped data', () => {
    const generated = generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake-adapter"]' } },
      { spawn: fakeSpawn() },
    )
    expect(generated.output).toContain('AI-prepared interpretation')
    const html = renderAiReport(generated.result, generated.envelope, 'html')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    const md = renderAiReport(generated.result, generated.envelope, 'md')
    expect(md).toContain('\\<script\\>')
  })

  it('should fail honestly on a forged citation', () => {
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(() => adapterResult('track:item:forged')) },
    )).toThrow(/forged-citation.*track snapshot/s)
  })

  it('should reject mixed open/closed owner-decision citations and normalized-empty text', () => {
    const ownerResult = adapterResult(`track:decision:${openDecision}`)
    ownerResult.sections.summary = []
    ownerResult.sections.ownerDecisions = [{
      id: 'owner-1', text: 'Owner choice',
      citations: [{ ref: `track:decision:${openDecision}` }, { ref: `track:decision:${closedDecision}` }],
    }]
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(() => ownerResult) },
    )).toThrow(/closed-owner-decision-citation/)

    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn((input) => adapterResult(input.context.references[0]!.ref, '\u0000\u202e')) },
    )).toThrow(/empty-normalized-entry-text/)
  })

  it('should reject excessive result depth and extra adapter stdout', () => {
    let nested: unknown = 'leaf'
    for (let index = 0; index < 20; index++) nested = { nested }
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(() => ({ ...adapterResult('source:git'), extra: nested })) },
    )).toThrow(/result-depth-cap/)
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(undefined, undefined, 'unexpected stdout') },
    )).toThrow(/invalid-result-json/)
  })

  it('should fail closed when adapter stderr exceeds 16 KiB', () => {
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(undefined, undefined, '', 'x'.repeat(16 * 1024 + 1)) },
    )).toThrow(/adapter-stderr-cap/)
  })

  it('should cap git at 50 commits and 500 total paths with honest partial failures', () => {
    const commits = Array.from({ length: 51 }, (_, index) => `sha${index}\tcommit ${index}`).join('\n')
    const statuses = Array.from({ length: 300 }, (_, index) => ` M status-${index}.txt`).join('\0') + '\0'
    const changed = Array.from({ length: 300 }, (_, index) => `changed-${index}.txt`).join('\0') + '\0'
    const spawn = ((command: string, args: string[]) => {
      if (command === 'git' && args.includes('--show-toplevel')) return spawnResult(`${dir}\n`)
      if (command === 'git' && args[0] === 'log') return spawnResult(commits)
      if (command === 'git' && args[0] === 'rev-list') return spawnResult('51\n')
      if (command === 'git' && args[0] === 'status') {
        expect(args).toContain('--no-renames')
        return spawnResult(statuses)
      }
      if (command === 'git' && args.includes('--name-only')) return spawnResult(changed)
      if (command === 'git' && args.includes('--stat')) return spawnResult('', 1, 'not replayed')
      if (command === 'h2a') return spawnResult(JSON.stringify({
        schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: dir, entries: [], omitted: 0,
      }))
      return spawnResult('')
    }) as never
    const envelope = buildReportContext(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } },
      { spawn },
    )
    const git = envelope.context.git
    expect(git.entries.filter((entry) => entry.kind === 'commit')).toHaveLength(50)
    expect(git.entries.filter((entry) => entry.path !== undefined)).toHaveLength(500)
    expect(git).toMatchObject({ status: 'unavailable', detail: 'git-diff-stat-unavailable', omitted: 101 })
    expect(canonicalize(git)).not.toContain('not replayed')
  })

  it('should expose a failed name diff as degraded instead of silently successful', () => {
    const spawn = ((command: string, args: string[]) => {
      if (command === 'git' && args.includes('--show-toplevel')) return spawnResult(`${dir}\n`)
      if (command === 'git' && args[0] === 'log') return spawnResult('sha\tone')
      if (command === 'git' && args[0] === 'rev-list') return spawnResult('1\n')
      if (command === 'git' && args[0] === 'status') return spawnResult('')
      if (command === 'git' && args.includes('--name-only')) return spawnResult('', 1, 'secret diff error')
      if (command === 'git' && args.includes('--stat')) return spawnResult('')
      if (command === 'h2a') return spawnResult(JSON.stringify({
        schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: dir, entries: [], omitted: 0,
      }))
      return spawnResult('')
    }) as never
    const git = buildReportContext(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } },
      { spawn },
    ).context.git
    expect(git).toMatchObject({ status: 'unavailable', detail: 'git-diff-unavailable', omitted: 0 })
    expect(canonicalize(git)).not.toContain('secret diff error')
  })

  it('should validate h2a tenant/workspace roots and propagate producer omission', () => {
    const badRoot = join(dir, 'other')
    mkdirSync(badRoot)
    const invalid = buildReportContext(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } },
      { spawn: fakeSpawn(undefined, { stdout: JSON.stringify({
        schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: badRoot, entries: [], omitted: 0,
      }) }) },
    )
    expect(invalid.context.h2a).toMatchObject({ status: 'invalid', detail: 'h2a-workspace-root-mismatch' })

    const truncated = buildReportContext(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } },
      { spawn: fakeSpawn(undefined, { stdout: JSON.stringify({
        schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: dir, entries: [], omitted: 3,
      }) }) },
    )
    expect(truncated.context.h2a).toMatchObject({ status: 'truncated', omitted: 3 })

    const noisy = buildReportContext(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir } },
      { spawn: fakeSpawn(undefined, {
        stdout: JSON.stringify({ schema: 'h2a.report-context/v1', storeRoot: dir, workspaceRoot: dir, entries: [], omitted: 0 }),
        stderr: 'x'.repeat(16 * 1024 + 1),
      }) },
    )
    expect(noisy.context.h2a).toMatchObject({ status: 'invalid', detail: 'h2a-stderr-cap' })
  })

  it('should normalize ANSI, controls, and bidi text', () => {
    expect(normalizeAiText('\u001b[31mred\u001b[0m\u0000\u202e')).toBe('red')
  })

  it('should normalize and cap adapter-reported identity metadata before every renderer', () => {
    const dirty = adapterResult('source:git')
    dirty.adapter = {
      provider: '\u001b[31mfa\nke\u202e', model: 'model\r\nname', effort: '\u2066high\u2069',
      resolvedModel: 'resolved\u0000name', identity: 'adapter-reported',
    }
    const generated = generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(() => dirty) },
    )
    expect(generated.result.adapter).toMatchObject({
      provider: 'fa ke', model: 'model name', effort: 'high', resolvedModel: 'resolvedname',
    })
    expect(generated.output).not.toMatch(/[\u001b\u202e\u2066\u2069]/u)

    const oversized = adapterResult('source:git')
    oversized.adapter.provider = 'x'.repeat(129)
    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(() => oversized) },
    )).toThrow(/adapter-provider-cap/)
  })

  it('should load env argv before the XDG user config and reject recursion', () => {
    const xdg = join(dir, 'xdg')
    mkdirSync(join(xdg, 'track'), { recursive: true })
    writeFileSync(join(xdg, 'track', 'report-ai.json'), JSON.stringify({ argv: ['from-config'] }))
    expect(resolveReporterArgv({ XDG_CONFIG_HOME: xdg })).toEqual(['from-config'])
    expect(resolveReporterArgv({ XDG_CONFIG_HOME: xdg, TRACK_REPORT_AI_ARGV: '["from-env"]' })).toEqual(['from-env'])
    expect(() => resolveReporterArgv({ TRACK_REPORT_AI_ARGV: '{"argv":["not-allowed"]}' })).toThrow(/env-shape/)
    expect(() => resolveReporterArgv({ TRACK_REPORT_AI_DEPTH: '1' })).toThrow(AiReportError)
  })

  it('should parse an exact bounded file timeout and preserve the legacy 90 s fallback', () => {
    const xdg = join(dir, 'xdg-timeout')
    mkdirSync(join(xdg, 'track'), { recursive: true })
    const path = join(xdg, 'track', 'report-ai.json')

    writeFileSync(path, JSON.stringify({ argv: ['legacy-adapter'] }))
    expect(resolveReporterConfig({ XDG_CONFIG_HOME: xdg })).toEqual({
      argv: ['legacy-adapter'], timeoutMs: REPORTER_TIMEOUT_DEFAULT_MS,
    })

    writeFileSync(path, JSON.stringify({ argv: ['slow-adapter'], timeoutMs: 600_000 }))
    expect(resolveReporterConfig({ XDG_CONFIG_HOME: xdg })).toEqual({ argv: ['slow-adapter'], timeoutMs: 600_000 })
    for (const timeoutMs of [REPORTER_TIMEOUT_MIN_MS, REPORTER_TIMEOUT_MAX_MS]) {
      writeFileSync(path, JSON.stringify({ argv: ['bounded-adapter'], timeoutMs }))
      expect(resolveReporterConfig({ XDG_CONFIG_HOME: xdg })).toEqual({ argv: ['bounded-adapter'], timeoutMs })
    }
    expect(resolveReporterConfig({ XDG_CONFIG_HOME: xdg, TRACK_REPORT_AI_ARGV: '["env-adapter"]' })).toEqual({
      argv: ['env-adapter'], timeoutMs: REPORTER_TIMEOUT_DEFAULT_MS,
    })

    for (const timeoutMs of [REPORTER_TIMEOUT_MIN_MS - 1, 1.5, REPORTER_TIMEOUT_MAX_MS + 1, '600000']) {
      writeFileSync(path, JSON.stringify({ argv: ['bad-adapter'], timeoutMs }))
      expect(() => resolveReporterConfig({ XDG_CONFIG_HOME: xdg })).toThrow(/invalid-configuration-timeout/)
    }
    writeFileSync(path, JSON.stringify({ argv: ['bad-adapter'], timeoutMs: 600_000, extra: true }))
    expect(() => resolveReporterConfig({ XDG_CONFIG_HOME: xdg })).toThrow(/invalid-configuration-file-shape/)
  })

  it('should pass the configured deadline to spawn and diagnose ETIMEDOUT without waiting', () => {
    const xdg = join(dir, 'xdg-spawn-timeout')
    mkdirSync(join(xdg, 'track'), { recursive: true })
    writeFileSync(join(xdg, 'track', 'report-ai.json'), JSON.stringify({ argv: ['fake'], timeoutMs: 600_000 }))
    let timeout: number | undefined
    generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, XDG_CONFIG_HOME: xdg } },
      { spawn: fakeSpawn(undefined, undefined, '', '', (options) => { timeout = options.timeout }) },
    )
    expect(timeout).toBe(600_000)

    expect(() => generateAiReport(
      { reader, cwd: dir, request: request(), env: { PATH: '/bin', H2A_ROOT: dir, TRACK_REPORT_AI_ARGV: '["fake"]' } },
      { spawn: fakeSpawn(undefined, undefined, '', '', undefined, 'ETIMEDOUT') },
    )).toThrow(/adapter-timeout/)
  })

  it('should never resolve an empty or relative XDG config path against the repository', () => {
    const home = join(dir, 'home')
    const homeConfig = join(home, '.config', 'track')
    const repoLocalXdg = join(dir, 'repo-local-xdg')
    mkdirSync(homeConfig, { recursive: true })
    mkdirSync(join(repoLocalXdg, 'track'), { recursive: true })
    writeFileSync(join(homeConfig, 'report-ai.json'), JSON.stringify({ argv: ['from-home'] }))
    writeFileSync(join(repoLocalXdg, 'track', 'report-ai.json'), JSON.stringify({ argv: ['repo-local-must-not-win'] }))
    const relativeXdg = relative(process.cwd(), repoLocalXdg)
    expect(relativeXdg.startsWith('/')).toBe(false)
    expect(resolveReporterArgv({ XDG_CONFIG_HOME: '', HOME: home })).toEqual(['from-home'])
    expect(resolveReporterArgv({ XDG_CONFIG_HOME: relativeXdg, HOME: home })).toEqual(['from-home'])
  })

  it('should forward only the explicit environment allowlist', () => {
    const env = reporterEnvironment({ PATH: '/bin', HOME: '/home/test', ANTHROPIC_API_KEY: 'secret', RANDOM_SECRET: 'x' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/test', TRACK_REPORT_AI_DEPTH: '1' })
  })
})
