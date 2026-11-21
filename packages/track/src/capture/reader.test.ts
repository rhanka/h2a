import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runCli } from '../cli/index.js'
import { resolveJournalOfReference } from '../cli/journal-reference.js'
import { identityOf } from '../journal/identity.js'
import { listCaptures } from './queue.js'

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

function fingerprintTree(rootDir: string): string {
  const hash = createHash('sha256')
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const relPath = rel === '' ? name : `${rel}/${name}`
      const st = statSync(full)
      if (st.isDirectory()) {
        hash.update(`dir:${relPath}\0`)
        walk(full, relPath)
      } else {
        hash.update(`file:${relPath}:${st.size}\0`)
        hash.update(readFileSync(full))
        hash.update('\0')
      }
    }
  }
  walk(rootDir, '')
  return hash.digest('hex')
}

describe('reader with active capture and no journal (T3a-h, DS-2, lot 3a)', () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'track-lot3a-reader-'))
    stateHome = join(scratch, 'state-home')
    isolateEnv(stateHome)
  })

  afterEach(() => {
    restoreEnv()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('T3a-h: with active capture and no journal, renders no-journal header, captured section, partial-scope sentence, exits 0 and writes nothing', () => {
    const folder = join(scratch, 'dossier-sans-journal')
    mkdirSync(folder, { recursive: true })

    // Without active capture and without journal: G4 refusal stands (exit 1)
    const refused = cli(folder, ['report', '--owner-table'])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('non couvert')

    // Register a direct CLI -> capture becomes active for the folder
    expect(
      cli(folder, ['capture', 'register', '--cli', 'claude', '--version', '2.1.0', '--mode', 'direct']).code,
    ).toBe(0)

    // Add one unclassified message (text must NOT be displayed in table)
    const unclassifiedText = 'Texte non classé confidentiel de la file'
    expect(
      cli(folder, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', '2026-11-20T10:00:00.000Z', '--stdin'], {
        stdin: JSON.stringify({ prompt: unclassifiedText, session_id: 's-r1', cwd: folder }),
      }).code,
    ).toBe(0)

    const ref = resolveJournalOfReference({ cwd: folder, processEnv: process.env })
    expect(ref.trackDir).toBeNull()
    expect(ref.captureActive).toBe(true)

    const fpFolderBefore = fingerprintTree(folder)
    const fpStateBefore = fingerprintTree(stateHome)

    const rendered = cli(folder, ['report', '--owner-table', '--now', '2026-11-20T12:00:00.000Z'])
    expect(rendered.code, rendered.err).toBe(0)
    expect(rendered.out).toContain('Journal : aucun · dossier dossier-sans-journal · créé à la première inscription')
    expect(rendered.out).toContain('Captation : claude directe')
    expect(rendered.out).toContain('Périmètre partiel :')
    expect(rendered.out).toContain('questions en texte libre non suivies')
    expect(rendered.out).toContain('1 message non classé')
    expect(rendered.out).not.toContain(unclassifiedText)
    expect(rendered.out).toContain('Aucune décision enregistrée au journal (périmètre partiel :')
    expect(rendered.out).not.toContain('Aucune décision en attente')

    // V4: read created NO journal and wrote NOTHING
    expect(existsSync(join(folder, '.track'))).toBe(false)
    expect(existsSync(join(stateHome, 'journals'))).toBe(false)
    expect(fingerprintTree(folder)).toBe(fpFolderBefore)
    expect(fingerprintTree(stateHome)).toBe(fpStateBefore)
  })

  it('lists classified-not-yet-inscribed items under « Captées, pas encore inscrites » on an exclusive journal', () => {
    const repo = join(scratch, 'repo-waiting')
    mkdirSync(repo, { recursive: true })
    expect(cli(repo, ['init']).code).toBe(0)
    expect(cli(repo, ['journal', 'declare-writer', '--holder', 'cond-repo']).code).toBe(0)

    expect(
      cli(repo, ['capture', 'add', '--cli', 'claude', '--origin', 'owner', '--now', '2026-11-20T09:00:00.000Z', '--stdin'], {
        stdin: JSON.stringify({ prompt: 'Ajouter export PDF', session_id: 's-w1', cwd: repo }),
      }).code,
    ).toBe(0)
    const ident = identityOf(repo)
    const cap = listCaptures(ident.id, { env: process.env })[0]!

    // Classify without holder token -> stays classified in queue
    expect(
      cli(repo, ['capture', 'classify', cap.id, '--as', 'new-demand', '--title', 'Export PDF', '--now', '2026-11-20T09:05:00.000Z']).code,
    ).toBe(0)

    const rep = cli(repo, ['report', '--owner-table', '--now', '2026-11-20T12:00:00.000Z'])
    expect(rep.code, rep.err).toBe(0)
    expect(rep.out).toContain('rédacteur exclusif : cond-repo')
    expect(rep.out).toContain('1 capté non inscrit')
    expect(rep.out).toContain('Captées, pas encore inscrites — 1')
    expect(rep.out).toContain('- 20/11 · nouvelle demande · Export PDF')
  })
})
