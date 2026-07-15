import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

function spawnResult(stdout: string, status = 0, stderr = '') {
  return { pid: 1, output: [null, stdout, stderr], stdout, stderr, status, signal: null } as never
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
) {
  return ((command: string, args: string[], options: { input?: string }) => {
    if (command === 'git' && args.includes('--show-toplevel')) return spawnResult(`${dir}\n`)
    if (command === 'git' && args[0] === 'log') return spawnResult('abc123\tinitial commit')
    if (command === 'git') return spawnResult('')
    if (command === 'h2a') return spawnResult(h2aReply.stdout, 0, h2aReply.stderr ?? '')
    const input = JSON.parse(options.input ?? '{}') as ReportContextEnvelopeV1
    return spawnResult(`${JSON.stringify(adapter(input))}${adapterSuffix}`)
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

  it('should forward only the explicit environment allowlist', () => {
    const env = reporterEnvironment({ PATH: '/bin', HOME: '/home/test', ANTHROPIC_API_KEY: 'secret', RANDOM_SECRET: 'x' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/test', TRACK_REPORT_AI_DEPTH: '1' })
  })
})
