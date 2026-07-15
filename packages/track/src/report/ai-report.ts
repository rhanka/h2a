import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { canonicalize } from '../events/canonical.js'
import type { TrackReader } from '../read/contract.js'
import { ordinalCompare, type SnapshotV1 } from './snapshot.js'

const CONTEXT_LIMIT = 512 * 1024
const SNAPSHOT_LIMIT = 256 * 1024
const GIT_LIMIT = 100 * 1024
const H2A_LIMIT = 128 * 1024
const DOCUMENT_LIMIT = 64 * 1024
const DOCUMENT_FILE_LIMIT = 32 * 1024
const RESULT_LIMIT = 128 * 1024
const ADAPTER_STDOUT_LIMIT = 256 * 1024

const SOURCE_STATUSES = ['ok', 'timeout', 'unavailable', 'invalid', 'truncated'] as const
type SourceStatus = (typeof SOURCE_STATUSES)[number]

export interface ContextReference {
  ref: string
  kind: string
  state: 'open' | 'closed' | 'fact' | 'degraded'
}

export interface Source<T> {
  status: SourceStatus
  entries: T[]
  omitted: number
  detail?: string
}

export interface GitContextEntry {
  ref: string
  kind: 'commit' | 'changed-path' | 'status' | 'diff-stat'
  sha?: string
  path?: string
  text: string
}

export interface H2aContextEntry {
  ref: string
  kind: 'loop' | 'session' | 'blockage' | 'inbox-metadata'
  workspace: string
  text: string
}

export interface DocumentContextEntry {
  ref: string
  kind: 'readme' | 'agents' | 'branch'
  path: string
  chunk: number
  text: string
  untrusted: true
}

export interface AiReportRequest {
  baselineInput: string
  baselineCommit: string
  format: 'text' | 'md' | 'html' | 'inline'
  emphasis: 'default' | 'workpackages' | 'flat'
  requireAccepted: boolean
  decisionEmphasis: 'open-only' | 'all'
  activeRoster: boolean
}

export interface ReportContextBodyV1 {
  schema: 'track.ai-report.context-body/v1'
  request: AiReportRequest
  workspace: { repoRoot: string; repoKey?: string }
  track: { snapshot: SnapshotV1 }
  git: Source<GitContextEntry>
  h2a: Source<H2aContextEntry>
  documents: Source<DocumentContextEntry>
  references: ContextReference[]
}

export interface ReportContextEnvelopeV1 {
  schema: 'track.ai-report.context-envelope/v1'
  context: ReportContextBodyV1
  contextDigest: string
}

export interface Citation { ref: string }
export interface AiEntry { id: string; text: string; citations: Citation[] }
export const AI_SECTION_NAMES = [
  'summary', 'facts', 'changes', 'activeWork', 'blockers', 'ownerDecisions', 'suggestions', 'uncertainty',
] as const
export type AiSectionName = (typeof AI_SECTION_NAMES)[number]

export interface AiReportResultV1 {
  schema: 'track.ai-report.result/v1'
  adapter: {
    provider: string
    model: string
    effort?: string
    resolvedModel?: string
    identity: 'adapter-reported'
  }
  sections: Record<AiSectionName, AiEntry[]>
}

export interface GenerateAiReportOptions {
  reader: TrackReader
  cwd: string
  request: AiReportRequest
  width?: number
  env?: NodeJS.ProcessEnv
}

type Spawn = typeof spawnSync

export interface AiReportDependencies {
  spawn?: Spawn
}

export class AiReportError extends Error {
  constructor(reason: string) {
    super(`AI report unavailable (${reason}) — use \`track snapshot\` or \`track report --raw\` for factual state`)
    this.name = 'AiReportError'
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function cleanOneLine(value: string): string {
  return normalizeAiText(value).replace(/\s+/gu, ' ').trim()
}

function truncateUtf8(value: string, max: number): { text: string; truncated: boolean } {
  if (byteLength(value) <= max) return { text: value, truncated: false }
  let out = ''
  for (const scalar of value) {
    if (byteLength(out + scalar) > max) break
    out += scalar
  }
  return { text: out, truncated: true }
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu, '[REDACTED_PRIVATE_KEY]'],
  [/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu, '[REDACTED_TOKEN]'],
  [/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/giu, 'Bearer [REDACTED]'],
]

export function redactText(value: string): string {
  let out = value
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = redactValue(child)
    return out as T
  }
  return value
}

const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR', 'LANG', 'LC_ALL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'H2A_ROOT',
] as const

export function reporterEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TRACK_REPORT_AI_DEPTH: '1' }
  for (const key of ENV_ALLOWLIST) if (source[key] !== undefined) env[key] = source[key]
  return env
}

function privateCwd<T>(run: (cwd: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'track-report-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function spawnText(
  spawn: Spawn,
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; input?: string },
): SpawnSyncReturns<string> {
  return spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    ...(options.input !== undefined ? { input: options.input } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function sourceFailure<T>(status: Exclude<SourceStatus, 'ok'>, detail: string): Source<T> {
  return { status, entries: [], omitted: 0, detail }
}

function gitRun(spawn: Spawn, cwd: string, env: NodeJS.ProcessEnv, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnText(spawn, 'git', args, { cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5_000, maxBuffer: 1024 * 1024 })
}

function repositoryRoot(spawn: Spawn, cwd: string, env: NodeJS.ProcessEnv): string {
  const result = gitRun(spawn, cwd, env, ['rev-parse', '--show-toplevel'])
  if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim() !== '') {
    return realpathSync(result.stdout.trim())
  }
  return realpathSync(cwd)
}

function pathRef(path: string): string {
  return `git:path:${path.replaceAll('\\', '/')}`
}

function collectGit(spawn: Spawn, root: string, env: NodeJS.ProcessEnv): Source<GitContextEntry> {
  const entries: GitContextEntry[] = []
  let omitted = 0
  let used = 0
  let truncated = false
  const add = (entry: GitContextEntry): void => {
    if (entries.length >= 550) { omitted++; truncated = true; return }
    const clean = redactValue(entry)
    const bytes = byteLength(canonicalize(clean))
    if (used + bytes > GIT_LIMIT) { omitted++; truncated = true; return }
    entries.push(clean)
    used += bytes
  }
  const log = gitRun(spawn, root, env, ['log', '-n', '50', '--pretty=format:%H%x09%s'])
  if (log.status !== 0) return sourceFailure('unavailable', 'git-log-unavailable')
  for (const line of log.stdout.split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t')
    const sha = tab >= 0 ? line.slice(0, tab) : line
    const text = tab >= 0 ? line.slice(tab + 1) : ''
    add({ ref: `git:commit:${sha}`, kind: 'commit', sha, text })
  }
  const status = gitRun(spawn, root, env, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  if (status.status !== 0) return sourceFailure('unavailable', 'git-status-unavailable')
  for (const record of status.stdout.split('\0').filter(Boolean).slice(0, 500)) {
    const path = record.length > 3 ? record.slice(3) : record
    add({ ref: pathRef(path), kind: 'status', path, text: record.slice(0, 2) })
  }
  const changed = gitRun(spawn, root, env, ['diff', '--name-only', '-z', '--no-ext-diff', 'HEAD'])
  if (changed.status === 0) {
    for (const path of changed.stdout.split('\0').filter(Boolean).slice(0, 500)) {
      add({ ref: pathRef(path), kind: 'changed-path', path, text: 'worktree-change' })
    }
  }
  const stat = gitRun(spawn, root, env, ['diff', '--stat', '--no-ext-diff', 'HEAD'])
  if (stat.status === 0 && stat.stdout.trim() !== '') {
    add({ ref: 'git:diff-stat:worktree', kind: 'diff-stat', text: stat.stdout.trim() })
  }
  return { status: truncated ? 'truncated' : 'ok', entries, omitted, ...(truncated ? { detail: 'git-cap' } : {}) }
}

function readPrefix(path: string, limit: number): { text: string; truncated: boolean } {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(limit + 1)
    const count = readSync(fd, buffer, 0, buffer.length, 0)
    return { text: buffer.subarray(0, Math.min(count, limit)).toString('utf8'), truncated: count > limit }
  } finally {
    closeSync(fd)
  }
}

function collectDocuments(root: string): Source<DocumentContextEntry> {
  const candidates: readonly [string, DocumentContextEntry['kind']][] = [
    ['README.md', 'readme'], ['README', 'readme'], ['AGENTS.md', 'agents'], ['BRANCH.md', 'branch'],
  ]
  const entries: DocumentContextEntry[] = []
  let used = 0
  let omitted = 0
  let truncated = false
  for (const [name, kind] of candidates) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return sourceFailure('invalid', 'document-not-regular')
    const real = realpathSync(path)
    if (!within(root, real)) return sourceFailure('invalid', 'document-outside-repository')
    const read = readPrefix(real, DOCUMENT_FILE_LIMIT)
    const clipped = truncateUtf8(redactText(read.text), Math.max(0, DOCUMENT_LIMIT - used))
    if (clipped.text === '' && read.text !== '') { omitted++; truncated = true; continue }
    const entry: DocumentContextEntry = {
      ref: `doc:${name}:chunk:1`, kind, path: name, chunk: 1, text: clipped.text, untrusted: true,
    }
    entries.push(entry)
    used += byteLength(clipped.text)
    if (read.truncated || clipped.truncated) truncated = true
  }
  return { status: truncated ? 'truncated' : 'ok', entries, omitted, ...(truncated ? { detail: 'document-cap' } : {}) }
}

function collectH2a(spawn: Spawn, root: string, env: NodeJS.ProcessEnv): Source<H2aContextEntry> {
  return privateCwd((cwd) => {
    const result = spawnText(spawn, 'h2a', ['report-context', '--workspace-root', root], {
      cwd, env, timeout: 5_000, maxBuffer: H2A_LIMIT,
    })
    if (result.error !== undefined) {
      const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      return sourceFailure(timedOut ? 'timeout' : 'unavailable', timedOut ? 'h2a-timeout' : 'h2a-unavailable')
    }
    if (byteLength(result.stderr) > 16 * 1024) return sourceFailure('invalid', 'h2a-stderr-cap')
    if (result.status !== 0) return sourceFailure('unavailable', 'h2a-nonzero')
    try {
      const decoded = JSON.parse(result.stdout) as unknown
      if (!isRecord(decoded) || Object.keys(decoded).sort(ordinalCompare).join(',') !== 'entries,omitted,schema,storeRoot,workspaceRoot' ||
          decoded['schema'] !== 'h2a.report-context/v1' || typeof decoded['storeRoot'] !== 'string' ||
          typeof decoded['workspaceRoot'] !== 'string' || !Array.isArray(decoded['entries']) ||
          !Number.isInteger(decoded['omitted']) || Number(decoded['omitted']) < 0) {
        return sourceFailure('invalid', 'h2a-invalid-envelope')
      }
      if (!isAbsolute(decoded['storeRoot']) || !isAbsolute(decoded['workspaceRoot'])) {
        return sourceFailure('invalid', 'h2a-root-not-absolute')
      }
      let storeRoot: string
      let envelopeRoot: string
      try {
        storeRoot = realpathSync(decoded['storeRoot'])
        envelopeRoot = realpathSync(decoded['workspaceRoot'])
      } catch {
        return sourceFailure('invalid', 'h2a-root-invalid')
      }
      if (envelopeRoot !== root) return sourceFailure('invalid', 'h2a-workspace-root-mismatch')
      const expectedStorePath = env['H2A_ROOT'] ?? join(env['HOME'] ?? homedir(), 'h2a-workspace', '.h2a')
      let expectedStoreRoot: string
      try { expectedStoreRoot = realpathSync(expectedStorePath) } catch { return sourceFailure('invalid', 'h2a-expected-store-root-invalid') }
      if (storeRoot !== expectedStoreRoot) return sourceFailure('invalid', 'h2a-store-root-mismatch')
      const raw = decoded['entries']
      const entries: H2aContextEntry[] = []
      let used = 0
      let omitted = Number(decoded['omitted'])
      const refs = new Set<string>()
      for (const value of raw) {
        if (!isRecord(value) || Object.keys(value).sort(ordinalCompare).join(',') !== 'kind,ref,text,workspace') {
          return sourceFailure('invalid', 'h2a-invalid-entry')
        }
        const ref = value['ref']; const kind = value['kind']; const workspace = value['workspace']; const text = value['text']
        if (typeof ref !== 'string' || !ref.startsWith('h2a:') || typeof workspace !== 'string' || typeof text !== 'string' ||
            !['loop', 'session', 'blockage', 'inbox-metadata'].includes(String(kind))) {
          return sourceFailure('invalid', 'h2a-invalid-entry')
        }
        if (refs.has(ref)) return sourceFailure('invalid', 'h2a-duplicate-ref')
        refs.add(ref)
        if (!isAbsolute(workspace)) return sourceFailure('invalid', 'h2a-workspace-not-absolute')
        let workspaceReal: string
        try { workspaceReal = realpathSync(workspace) } catch { return sourceFailure('invalid', 'h2a-workspace-invalid') }
        if (!within(root, workspaceReal)) return sourceFailure('invalid', 'h2a-cross-workspace')
        const entry: H2aContextEntry = { ref, kind: kind as H2aContextEntry['kind'], workspace: workspaceReal, text: redactText(text) }
        const bytes = byteLength(canonicalize(entry))
        if (entries.length >= 100 || used + bytes > H2A_LIMIT) { omitted++; continue }
        entries.push(entry); used += bytes
      }
      entries.sort((a, b) => ordinalCompare(a.ref, b.ref))
      return { status: omitted > 0 ? 'truncated' : 'ok', entries, omitted, ...(omitted > 0 ? { detail: 'h2a-cap' } : {}) }
    } catch {
      return sourceFailure('invalid', 'h2a-invalid-json')
    }
  })
}

function wpRefs(nodes: Readonly<NonNullable<SnapshotV1['report']['wpTree']>>, out: ContextReference[]): void {
  for (const node of nodes) {
    out.push({ ref: `track:wp:${node.id}`, kind: 'workpackage', state: 'fact' })
    wpRefs(node.children, out)
  }
}

function referencesOf(
  snapshot: SnapshotV1,
  git: Source<GitContextEntry>,
  h2a: Source<H2aContextEntry>,
  documents: Source<DocumentContextEntry>,
): ContextReference[] {
  const refs: ContextReference[] = []
  for (const bucket of Object.values(snapshot.report.buckets)) {
    for (const row of bucket) refs.push({ ref: `track:item:${row.id}`, kind: 'item', state: 'fact' })
  }
  for (const decision of snapshot.report.decisions ?? []) {
    refs.push({
      ref: `track:decision:${decision.id}`,
      kind: 'decision',
      state: decision.outcome === 'pending' ? 'open' : 'closed',
    })
  }
  wpRefs(snapshot.report.wpTree ?? [], refs)
  for (const event of snapshot.recentEvents) {
    refs.push({ ref: `track:event:${event.position}`, kind: 'event', state: 'fact' })
    // SnapshotV1 intentionally carries no separate blocker table. The allowlisted recent-event projection
    // still exposes stable blocker refs for blocker events inside its 200-event window; older blockers remain
    // citeable through their affected item/decision, never through a fabricated blocker ref.
    if (event.kind === 'blocker.opened' || event.kind === 'blocker.resolved') {
      refs.push({ ref: `track:blocker:${event.aggregateId}`, kind: 'blocker', state: 'fact' })
    }
  }
  for (const entry of git.entries) refs.push({ ref: entry.ref, kind: entry.kind, state: 'fact' })
  for (const entry of h2a.entries) refs.push({ ref: entry.ref, kind: entry.kind, state: 'fact' })
  for (const entry of documents.entries) refs.push({ ref: entry.ref, kind: entry.kind, state: 'fact' })
  for (const [name, source] of [['git', git], ['h2a', h2a], ['documents', documents]] as const) {
    refs.push({ ref: `source:${name}`, kind: 'source-status', state: source.status === 'ok' ? 'fact' : 'degraded' })
  }
  const unique = new Map<string, ContextReference>()
  for (const ref of refs) if (!unique.has(ref.ref)) unique.set(ref.ref, ref)
  return [...unique.values()].sort((a, b) => ordinalCompare(a.ref, b.ref))
}

export function buildReportContext(
  options: GenerateAiReportOptions,
  deps: AiReportDependencies = {},
): ReportContextEnvelopeV1 {
  const spawn = deps.spawn ?? spawnSync
  const sourceEnv = options.env ?? process.env
  const childEnv = reporterEnvironment(sourceEnv)
  const root = repositoryRoot(spawn, options.cwd, childEnv)
  const snapshot = redactValue(options.reader.snapshot({
    baselineInput: options.request.baselineInput,
    resolvedCommit: options.request.baselineCommit,
    requireAccepted: options.request.requireAccepted,
  }))
  if (byteLength(canonicalize(snapshot)) > SNAPSHOT_LIMIT) throw new AiReportError('snapshot-cap')
  const git = collectGit(spawn, root, childEnv)
  const h2a = collectH2a(spawn, root, childEnv)
  const documents = collectDocuments(root)
  const body: ReportContextBodyV1 = {
    schema: 'track.ai-report.context-body/v1',
    request: options.request,
    workspace: { repoRoot: root },
    track: { snapshot },
    git,
    h2a,
    documents,
    references: referencesOf(snapshot, git, h2a, documents),
  }
  const contextBytes = canonicalize(body)
  if (byteLength(contextBytes) > CONTEXT_LIMIT) throw new AiReportError('context-cap')
  const contextDigest = createHash('sha256').update(contextBytes, 'utf8').digest('hex')
  return { schema: 'track.ai-report.context-envelope/v1', context: body, contextDigest }
}

function configPath(env: NodeJS.ProcessEnv): string {
  const base = env['XDG_CONFIG_HOME'] ?? join(env['HOME'] ?? homedir(), '.config')
  return join(base, 'track', 'report-ai.json')
}

export function resolveReporterArgv(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env['TRACK_REPORT_AI_DEPTH'] !== undefined && env['TRACK_REPORT_AI_DEPTH'] !== '0') {
    throw new AiReportError('recursive-adapter')
  }
  const envRaw = env['TRACK_REPORT_AI_ARGV']
  const path = configPath(env)
  let raw: string | undefined
  let fromEnvironment = false
  if (envRaw !== undefined) {
    raw = envRaw
    fromEnvironment = true
  } else if (existsSync(path)) {
    try { raw = readFileSync(path, 'utf8') } catch { throw new AiReportError('unreadable-configuration') }
  }
  if (raw === undefined) throw new AiReportError('missing-configuration')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new AiReportError('invalid-configuration-json') }
  if (fromEnvironment && !Array.isArray(value)) throw new AiReportError('invalid-configuration-env-shape')
  if (!fromEnvironment && (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'argv'))) {
    throw new AiReportError('invalid-configuration-file-shape')
  }
  const argv = fromEnvironment ? value : (value as Record<string, unknown>)['argv']
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new AiReportError('invalid-configuration-argv')
  }
  return argv as string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...allowed].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AiReportError(`invalid-${label}-shape`)
  }
}

function assertMaxDepth(value: unknown, depth = 0): void {
  if (depth > 16) throw new AiReportError('result-depth-cap')
  if (Array.isArray(value)) {
    for (const child of value) assertMaxDepth(child, depth + 1)
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) assertMaxDepth(child, depth + 1)
  }
}

function stringField(value: unknown, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.includes('\uFFFD')) throw new AiReportError(`invalid-${label}`)
  return value
}

function adapterMetadataField(value: unknown, label: string, optional = false): string | undefined {
  const raw = stringField(value, label, optional)
  if (raw === undefined) return undefined
  if ([...raw].length > 128) throw new AiReportError(`invalid-${label}-cap`)
  const normalized = cleanOneLine(raw)
  if (normalized.length === 0) throw new AiReportError(`invalid-${label}-normalized`)
  return normalized
}

export function normalizeAiText(value: string): string {
  const ansi = value.replace(/\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '')
  return ansi
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function validateResult(raw: string, envelope: ReportContextEnvelopeV1): AiReportResultV1 {
  if (byteLength(raw) > RESULT_LIMIT) throw new AiReportError('result-cap')
  if (raw.includes('\uFFFD')) throw new AiReportError('invalid-result-utf8')
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new AiReportError('invalid-result-json') }
  assertMaxDepth(decoded)
  if (!isRecord(decoded)) throw new AiReportError('invalid-result-object')
  exactKeys(decoded, ['schema', 'adapter', 'sections'], 'result')
  if (decoded['schema'] !== 'track.ai-report.result/v1') throw new AiReportError('invalid-result-schema')
  if (!isRecord(decoded['adapter'])) throw new AiReportError('invalid-adapter')
  const adapterRaw = decoded['adapter']
  const adapterKeys = Object.keys(adapterRaw)
  if (!adapterKeys.every((key) => ['provider', 'model', 'effort', 'resolvedModel', 'identity'].includes(key)) ||
      !['provider', 'model', 'identity'].every((key) => adapterKeys.includes(key))) {
    throw new AiReportError('invalid-adapter-shape')
  }
  if (adapterRaw['identity'] !== 'adapter-reported') throw new AiReportError('invalid-adapter-identity')
  const provider = adapterMetadataField(adapterRaw['provider'], 'adapter-provider')!
  const model = adapterMetadataField(adapterRaw['model'], 'adapter-model')!
  const effort = adapterMetadataField(adapterRaw['effort'], 'adapter-effort', true)
  const resolvedModel = adapterMetadataField(adapterRaw['resolvedModel'], 'adapter-resolved-model', true)
  if (!isRecord(decoded['sections'])) throw new AiReportError('invalid-sections')
  exactKeys(decoded['sections'], AI_SECTION_NAMES, 'sections')
  const refs = new Map(envelope.context.references.map((ref) => [ref.ref, ref]))
  const seenIds = new Set<string>()
  const sections = {} as Record<AiSectionName, AiEntry[]>
  for (const name of AI_SECTION_NAMES) {
    const values = decoded['sections'][name]
    if (!Array.isArray(values) || values.length > 20) throw new AiReportError(`invalid-section-${name}`)
    sections[name] = values.map((value): AiEntry => {
      if (!isRecord(value)) throw new AiReportError(`invalid-entry-${name}`)
      exactKeys(value, ['id', 'text', 'citations'], `entry-${name}`)
      const id = stringField(value['id'], 'entry-id')!
      if (seenIds.has(id)) throw new AiReportError('duplicate-entry-id')
      seenIds.add(id)
      const rawText = stringField(value['text'], 'entry-text')!
      if ([...rawText].length > 1_000) throw new AiReportError('entry-text-cap')
      if (!Array.isArray(value['citations']) || value['citations'].length < 1 || value['citations'].length > 8) {
        throw new AiReportError('invalid-entry-citations')
      }
      const citations = value['citations'].map((citation): Citation => {
        if (!isRecord(citation)) throw new AiReportError('invalid-citation')
        exactKeys(citation, ['ref'], 'citation')
        const ref = stringField(citation['ref'], 'citation-ref')!
        if (!refs.has(ref)) throw new AiReportError('forged-citation')
        return { ref }
      })
      if (name === 'ownerDecisions') {
        const decisionCitations = citations.filter((citation) => refs.get(citation.ref)?.kind === 'decision')
        if (decisionCitations.length === 0 || decisionCitations.some((citation) => refs.get(citation.ref)?.state !== 'open')) {
          throw new AiReportError('closed-owner-decision-citation')
        }
      }
      const text = normalizeAiText(rawText)
      if (text.length === 0) throw new AiReportError('empty-normalized-entry-text')
      return { id, text, citations }
    })
  }
  return {
    schema: 'track.ai-report.result/v1',
    adapter: {
      provider,
      model,
      ...(effort !== undefined ? { effort } : {}),
      ...(resolvedModel !== undefined ? { resolvedModel } : {}),
      identity: 'adapter-reported',
    },
    sections,
  }
}

const SECTION_LABELS: Record<AiSectionName, string> = {
  summary: 'SUMMARY', facts: 'FACTS', changes: 'RECENT CHANGES', activeWork: 'ACTIVE WORK', blockers: 'BLOCKERS',
  ownerDecisions: 'OWNER DECISIONS', suggestions: 'AI SUGGESTIONS', uncertainty: 'UNCERTAINTY',
}

function markdownEscape(value: string): string {
  return cleanOneLine(value).replace(/([\\`*_{}\[\]()#+\-.!|<>~])/gu, '\\$1')
}

function htmlEscape(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}

function citations(entry: AiEntry, escape: (value: string) => string): string {
  return entry.citations.map((citation) => escape(citation.ref)).join(', ')
}

function metadata(result: AiReportResultV1, envelope: ReportContextEnvelopeV1): string[] {
  const adapter = result.adapter
  const degraded = (['git', 'h2a', 'documents'] as const)
    .filter((key) => envelope.context[key].status !== 'ok')
    .map((key) => `${key}:${envelope.context[key].status}`)
  return [
    `adapter-reported: ${adapter.provider}/${adapter.model}${adapter.resolvedModel !== undefined ? ` -> ${adapter.resolvedModel}` : ''}${adapter.effort !== undefined ? ` (${adapter.effort})` : ''}`,
    `contextDigest: ${envelope.contextDigest}`,
    `degraded sources: ${degraded.length > 0 ? degraded.join(', ') : 'none'}`,
  ]
}

export function renderAiReport(
  result: AiReportResultV1,
  envelope: ReportContextEnvelopeV1,
  format: AiReportRequest['format'],
  width = 100,
): string {
  if (format === 'html') {
    const sections = AI_SECTION_NAMES.map((name) => {
      const items = result.sections[name].map((entry) =>
        `<li><span class="track-ai-text">${htmlEscape(cleanOneLine(entry.text))}</span> ` +
        `<cite>[${htmlEscape(citations(entry, cleanOneLine))}]</cite></li>`).join('')
      return `<section class="track-ai-section" data-section="${htmlEscape(name)}"><h2>${htmlEscape(SECTION_LABELS[name])}</h2><ul>${items}</ul></section>`
    }).join('')
    const meta = metadata(result, envelope).map((line) => `<li>${htmlEscape(line)}</li>`).join('')
    return `<article class="track-ai-report" data-kind="ai-report"><header><h1>Track AI report</h1><p>AI-prepared interpretation</p><ul>${meta}</ul></header>${sections}</article>\n`
  }
  if (format === 'inline') {
    const cap = Math.min(240, Math.max(40, width))
    const truncate = (line: string): string => line.length <= cap ? line : `${line.slice(0, Math.max(0, cap - 1))}…`
    const lines = ['TRACK AI REPORT', ...metadata(result, envelope).map(truncate)]
    for (const name of AI_SECTION_NAMES) {
      const entries = result.sections[name]
      if (entries.length === 0) continue
      lines.push(truncate(`${SECTION_LABELS[name]}:`))
      for (const entry of entries.slice(0, 2)) lines.push(truncate(`- ${cleanOneLine(entry.text)} [${citations(entry, cleanOneLine)}]`))
      if (entries.length > 2) lines.push(truncate(`- +${entries.length - 2} omitted`))
    }
    return `${lines.join('\n')}\n`
  }
  const md = format === 'md'
  const escape = md ? markdownEscape : cleanOneLine
  const lines = [md ? '# Track AI report' : 'TRACK AI REPORT', 'AI-prepared interpretation', ...metadata(result, envelope).map(escape), '']
  for (const name of AI_SECTION_NAMES) {
    lines.push(md ? `## ${SECTION_LABELS[name]}` : SECTION_LABELS[name])
    const entries = result.sections[name]
    if (entries.length === 0) lines.push('- none')
    for (const entry of entries) lines.push(`- ${escape(entry.text)} [${citations(entry, escape)}]`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function generateAiReport(
  options: GenerateAiReportOptions,
  deps: AiReportDependencies = {},
): { output: string; envelope: ReportContextEnvelopeV1; result: AiReportResultV1 } {
  const spawn = deps.spawn ?? spawnSync
  const sourceEnv = options.env ?? process.env
  const argv = resolveReporterArgv(sourceEnv)
  const envelope = buildReportContext(options, { spawn })
  const input = canonicalize(envelope)
  const childEnv = reporterEnvironment(sourceEnv)
  const result = privateCwd((cwd) => spawnText(spawn, argv[0]!, argv.slice(1), {
    cwd,
    env: childEnv,
    timeout: 90_000,
    maxBuffer: ADAPTER_STDOUT_LIMIT,
    input,
  }))
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    throw new AiReportError(code === 'ETIMEDOUT' ? 'adapter-timeout' : code === 'ENOBUFS' ? 'adapter-output-cap' : 'adapter-spawn')
  }
  if (result.status !== 0) throw new AiReportError('adapter-nonzero')
  const validated = validateResult(result.stdout, envelope)
  return {
    output: renderAiReport(validated, envelope, options.request.format, options.width),
    envelope,
    result: validated,
  }
}
