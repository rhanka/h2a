import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { identityOf } from '../journal/identity.js'
import { listCaptures } from './queue.js'
import { maskSecrets, SECRET_PATTERNS } from './secrets.js'

let scratch: string
let stateHome: string
let savedEnv: Record<string, string | undefined>

function isolateEnv(home: string): void {
  savedEnv = {
    TRACK_STATE_HOME: process.env['TRACK_STATE_HOME'],
    TRACK_DIR: process.env['TRACK_DIR'],
    TRACK_WRITER_TOKEN: process.env['TRACK_WRITER_TOKEN'],
  }
  delete process.env['TRACK_DIR']
  delete process.env['TRACK_WRITER_TOKEN']
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
  opts: { stdin?: string } = {},
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
  })
  return { code: code as number, out, err }
}

function collectAllFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(rootDir)
  return out
}

function makeFixture(
  kind: string,
  parts: readonly string[],
  sep: string,
  wrap: (secret: string) => string,
): { kind: string; rawSecret: string; sample: string } {
  const rawSecret = parts.join(sep)
  return { kind, rawSecret, sample: wrap(rawSecret) }
}

// Synthetic, clearly non-real fixtures assembled at runtime (no static token literals in git) —
// one per token format in SECRET_PATTERNS.
const SECRET_FIXTURES: ReadonlyArray<{ kind: string; rawSecret: string; sample: string }> = [
  makeFixture(
    'pem-private-key',
    ['MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC', 'testfixture01'],
    '',
    (s) =>
      `Deploy avec -----${'BEGIN PRIVATE'} KEY-----\n${s}\n-----${'END PRIVATE'} KEY-----`,
  ),
  makeFixture(
    'jwt',
    [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3RVc2VyIn0',
      'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ],
    '.',
    (s) => `Utiliser ${s} pour tester`,
  ),
  makeFixture(
    'anthropic-key',
    ['sk', 'ant', 'api03', 'SyntheticTestKeyValue0123456789ABCDEF'],
    '-',
    (s) => `Ma clé ${s} ne passe pas`,
  ),
  makeFixture(
    'openai-key',
    ['sk', 'proj', 'SyntheticOpenAiKeyValue0123456789ABCDEFGH'],
    '-',
    (s) => `Clé OpenAI ${s} expirée`,
  ),
  makeFixture(
    'github-token',
    ['ghp', 'SyntheticGitHubTokenValue0123456789ABCD'],
    '_',
    (s) => `Token GitHub ${s} en erreur`,
  ),
  makeFixture(
    'gitlab-token',
    ['glpat', 'SyntheticGitLabToken0123456789'],
    '-',
    (s) => `Token GitLab ${s} révoqué`,
  ),
  makeFixture(
    'aws-access-key',
    ['AKIA', 'IOSFODNN7EXAMPLE'],
    '',
    (s) => `Compte AWS ${s} à vérifier`,
  ),
  makeFixture(
    'google-api-key',
    ['AIza', 'SySyntheticGoogleApiKey0123456789ABCD'],
    '',
    (s) => `Clé Google ${s} bloquée`,
  ),
  makeFixture(
    'google-oauth-token',
    ['ya29', 'SyntheticGoogleOauthAccessToken0123456789'],
    '.',
    (s) => `Jeton OAuth ${s} expiré`,
  ),
  makeFixture(
    'slack-token',
    ['xoxb', '123456789012', '123456789012', 'SyntheticSlackToken99'],
    '-',
    (s) => `Bot Slack ${s} muet`,
  ),
  makeFixture(
    'huggingface-token',
    ['hf', 'SyntheticHuggingFaceToken0123456789'],
    '_',
    (s) => `Hub ${s} refusé`,
  ),
  makeFixture(
    'npm-token',
    ['npm', 'SyntheticNpmPublishToken0123456789'],
    '_',
    (s) => `Registre ${s} expiré`,
  ),
  makeFixture(
    'stripe-key',
    ['sk', 'live', 'SyntheticStripeSecretKey0123456789'],
    '_',
    (s) => `Paiement ${s} en échec`,
  ),
  makeFixture(
    'auth-header',
    ['SyntheticBearerCredential', '9876543210'],
    '',
    (s) => `En-tête Authorization: Bearer ${s} rejeté`,
  ),
  makeFixture(
    'cookie-header',
    ['second_session_cookie_secret', '9876543210'],
    '_',
    (s) => `Requête avec\nCookie: sid=first_cookie_val; auth=${s}\nfin`,
  ),
  makeFixture(
    'url-credentials',
    ['dbuser', 'SuperSecretDbPass99'],
    ':',
    (s) => `Connexion postgres://${s}@db.example.test:5432/app cassée`,
  ),
  makeFixture(
    'url-query-secret',
    ['SyntheticOAuthCodeValue', '998877'],
    '',
    (s) => `Callback https://app.example.test/cb?code=${s}&state=ok échoue`,
  ),
  makeFixture(
    'secret-assignment',
    ['SuperSecretAssignedPassword', '42'],
    '',
    (s) => `Configurer client_secret=${s} dans le service`,
  ),
]

describe('secret masking at capture (T3a-b, lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-secrets-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-b (unit): masks every registered secret pattern format with [secret masqué : <kind>] and is idempotent', () => {
    // Every pattern in SECRET_PATTERNS has a dedicated fixture
    const fixtureKinds = new Set(SECRET_FIXTURES.map((f) => f.kind))
    for (const spec of SECRET_PATTERNS) {
      expect(fixtureKinds.has(spec.kind), `missing fixture for secret pattern kind "${spec.kind}"`).toBe(true)
    }

    for (const fx of SECRET_FIXTURES) {
      const res = maskSecrets(fx.sample)
      expect(res.maskedCount, `expected match for ${fx.kind}`).toBeGreaterThanOrEqual(1)
      expect(res.text).not.toContain(fx.rawSecret)
      expect(res.text).toContain(`[secret masqué : ${fx.kind}]`)

      // Idempotent: re-running maskSecrets changes nothing
      const res2 = maskSecrets(res.text)
      expect(res2.text).toBe(res.text)
      expect(res2.maskedCount).toBe(0)
    }
  })

  it('T3a-b (sweep): raw secret bytes appear in NO file across state home and journal after capture, classify, and inscribe', () => {
    const project = join(scratch, 'repo-secrets')
    mkdirSync(project, { recursive: true })
    expect(cli(project, ['init']).code).toBe(0)

    const ident = identityOf(project)
    for (let i = 0; i < SECRET_FIXTURES.length; i++) {
      const fx = SECRET_FIXTURES[i]!
      const addRes = cli(project, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--stdin'], {
        stdin: JSON.stringify({ prompt: fx.sample, session_id: `sess-sec-${i}`, cwd: project }),
      })
      expect(addRes.code).toBe(0)
      expect(addRes.out).toBe('')

      const entries = listCaptures(ident.id, { env: process.env }).filter((e) => e.state === 'captured')
      expect(entries.length).toBe(1)
      const cap = entries[0]!
      expect(cap.maskedSecretCount).toBeGreaterThanOrEqual(1)

      const clsRes = cli(project, [
        'capture',
        'classify',
        cap.id,
        '--as',
        'new-demand',
        '--title',
        `Demande secrète ${i + 1}`,
      ])
      expect(clsRes.code, clsRes.err).toBe(0)
    }

    // Sweep EVERY file in stateHome AND project/.track for EVERY raw secret byte sequence
    const allFiles = [
      ...collectAllFiles(stateHome),
      ...collectAllFiles(join(project, '.track')),
    ]
    expect(allFiles.length).toBeGreaterThan(0)

    for (const filePath of allFiles) {
      const content = readFileSync(filePath)
      for (const fx of SECRET_FIXTURES) {
        expect(
          content.includes(Buffer.from(fx.rawSecret, 'utf8')),
          `raw secret (${fx.kind}) leaked in ${filePath}`,
        ).toBe(false)
      }
    }
  })
})
