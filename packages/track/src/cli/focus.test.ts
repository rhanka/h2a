// `track focus <decision-id> --workspace <w> [--format terminal|md|html] [--baseline-commit <sha>]` —
// a READ-ONLY render verb that projects a track decision into a focus DecisionDossierDocument and renders
// it via the VENDORED render-core snapshot in `../focus-vendor/` (a compiled `@sentropic/focus@0.5.0` copy,
// consumed by `cmdFocus` through dynamic `import('../focus-vendor/index.js')` + `.../track/index.js` — there
// is NO `@sentropic/focus` devDep). track resolves the store THE TRACK WAY (ctx.eventsPath, no `--events-path`),
// then calls the vendored `readDecisionDossier` + dispatches renderTerminal/Md/Html. v1 is read-only: no write,
// no `.track` creation. These tests exercise the vendored copy against a fixture log built by the local Track
// facade; its `/read` binding gates on the major-compatible `reader.contractVersion`.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { EventStore } from '../events/store.js'
import { Track } from '../track.js'
import { runCli, type CliIO } from './index.js'

// Load the renderer fixture during collection. These tests assert rendered
// content and read-only behavior; a cold vendored-module import under suite
// load must not consume the first render's default test deadline.
import '../focus-vendor/index.js'
import '../focus-vendor/track/index.js'
import { validateDecisionDossierForPresentation } from '../focus-vendor/validation/index.js'

let root: string
let trackDir: string
let eventsPath: string
let out: string[]
let err: string[]

function io(cwd: string): CliIO {
  return { cwd, out: (s) => out.push(s), err: (s) => err.push(s) }
}

const DECISION_TITLE = 'Ship track focus CLI'

/** Seed a `.track` log with ONE decision (kind=commitment, outcome=go) over a fixture target item. */
function seed(readable = false): { decisionId: string } {
  const track = new Track(new EventStore(eventsPath), { by: 'human:t@t' })
  const targetId = track.createItem({ kind: 'feature', title: 'Adopt focus', workspace: 'ws-1' })
  const decisionId = track.createDecision({
    decisionKind: 'commitment',
    title: DECISION_TITLE,
    workspace: 'ws-1',
    targets: [targetId],
    dossier: readable ? JSON.parse(readFileSync(new URL('../../../focus/tests/readable-track.fixture.json', import.meta.url), 'utf8')) : { context: 'We need a render path', options: [{ id: 'a', title: 'Option A', summary: 'first option' }, { id: 'b', title: 'Option B', summary: 'second option' }], qa: [], recommendation: { optionId: 'a', rationale: 'Option A is recommended' } },
  })
  track.selectDecisionOption(decisionId, 'a')
  return { decisionId }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'track-focus-'))
  trackDir = join(root, '.track')
  mkdirSync(trackDir, { recursive: true })
  eventsPath = join(trackDir, 'events.jsonl')
  out = []
  err = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('track focus', () => {
  it.each(['terminal', 'md', 'html'])('renders readable %s decisions without writing the log', async (format) => {
    const { decisionId } = seed(true)
    const before = readFileSync(eventsPath, 'utf8')
    expect(await runCli(['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1', '--format', format], io(root))).toBe(0)
    const text = out.join('')
    expect(err).toEqual([])
    expect(text).toContain(DECISION_TITLE)
    expect(text).toContain('Keep the shed handy without spoiling the terrace view.')
    expect(text).toContain('A short walk and a clear terrace view.')
    expect(text).toContain('préco: Along the side wall, because')
    if (format === 'html') {
      expect(text).toContain('&lt;script&gt;alert(&quot;shed&quot;)&lt;/script&gt; &amp; comfort')
      expect(text).not.toContain('<script>')
    }
    expect(readFileSync(eventsPath, 'utf8')).toBe(before)
  })

  it.each(['terminal', 'md', 'html'])('blocks %s presentation when the stored dossier lacks readability information', async (format) => {
    const { decisionId } = seed()
    const before = readFileSync(eventsPath, 'utf8')
    const code = await runCli(
      ['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1', '--format', format], io(root),
    )
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err.join('')).toContain('$.readability.ownerRequestQuote')
    expect(err.join('')).toContain('owner request')
    expect(readFileSync(eventsPath, 'utf8')).toBe(before)
  })

  it('renders readable json decisions as a presentation-validated v1 document without writing the log', async () => {
    const { decisionId } = seed(true)
    const before = readFileSync(eventsPath, 'utf8')
    expect(await runCli(['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1', '--format', 'json'], io(root))).toBe(0)
    expect(err).toEqual([])
    const text = out.join('')
    expect(text.endsWith('}\n')).toBe(true)
    const doc = JSON.parse(text) as Record<string, unknown>
    // v1 is selected by the ABSENCE of schemaVersion (U-19: track's dossier model carries no embedded evidence).
    expect('schemaVersion' in doc).toBe(false)
    expect(doc['title']).toBe(DECISION_TITLE)
    expect(validateDecisionDossierForPresentation(doc).ok).toBe(true)
    expect(readFileSync(eventsPath, 'utf8')).toBe(before)
  })

  it('blocks json presentation when the stored dossier lacks readability information (same gate as terminal|md|html)', async () => {
    const { decisionId } = seed()
    const before = readFileSync(eventsPath, 'utf8')
    const code = await runCli(
      ['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1', '--format', 'json'], io(root),
    )
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err.join('')).toContain('$.readability.ownerRequestQuote')
    expect(err.join('')).toContain('owner request')
    expect(readFileSync(eventsPath, 'utf8')).toBe(before)
  })

  it('missing --workspace → rc=2 + usage (workspace is REQUIRED, like the decision-id positional)', async () => {
    const { decisionId } = seed()
    const code = await runCli(['focus', decisionId, '--baseline-commit', 'c1'], io(root))
    expect(code).toBe(2)
    expect(err.join('')).toMatch(/focus/)
    expect(err.join('')).toMatch(/--workspace/)
  })

  it('missing decision-id → rc=2 + usage', async () => {
    seed()
    const code = await runCli(['focus', '--workspace', 'ws-1', '--baseline-commit', 'c1'], io(root))
    expect(code).toBe(2)
    expect(err.join('')).toMatch(/focus/)
  })

  it('a decision in another workspace fails loudly instead of rendering under the supplied workspace', async () => {
    const { decisionId } = seed()
    const code = await runCli(
      ['focus', decisionId, '--workspace', 'ws-wrong', '--baseline-commit', 'c1'],
      io(root),
    )
    expect(code).toBe(3)
    expect(out.join('')).toBe('')
    expect(err.join('')).toContain(`decision ${decisionId} belongs to workspace ws-1, not ws-wrong`)
  })

  it('an unknown decision → rc=3 (DecisionNotFoundError, focus exit-code parity)', async () => {
    seed()
    const code = await runCli(
      ['focus', 'no-such-decision', '--workspace', 'ws-1', '--baseline-commit', 'c1'],
      io(root),
    )
    expect(code).toBe(3)
  })

  it('runCli returns a Promise that resolves to the rc for the async focus path', async () => {
    const { decisionId } = seed(true)
    const result = runCli(['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1'], io(root))
    expect(typeof (result as Promise<number>).then).toBe('function') // it's a thenable
    await expect(Promise.resolve(result)).resolves.toBe(0)
  })

  it('serve-empty: no .track resolves → an unadopted-repo focus serves not-found (rc=3), never crashes', async () => {
    // A fresh dir with NO `.track` ancestor: the read group binds a nonexistent log, focus reads empty,
    // and an unknown decision over an empty log is DecisionNotFoundError → rc=3 (not a boot crash).
    const unadopted = mkdtempSync(join(tmpdir(), 'track-focus-unadopted-'))
    try {
      const code = await runCli(
        ['focus', 'any-decision', '--workspace', 'ws-1', '--baseline-commit', 'c1'],
        io(unadopted),
      )
      expect(code).toBe(3)
      expect(err.join('')).toMatch(/track init/) // the serve-empty stderr hint still fires
      expect(existsSync(join(unadopted, '.track'))).toBe(false) // reads never materialize a store
    } finally {
      rmSync(unadopted, { recursive: true, force: true })
    }
  })

  it('vendored registry helper loads the publisher manifest (rev352-F4)', async () => {
    // The vendored snapshot ships the pinned manifest alongside the helper,
    // so it resolves without the publisher package instead of throwing
    // MODULE_NOT_FOUND from a relocated relative path.
    const definitions = (await import('../focus-vendor/registry/definitions.js')) as unknown as {
      loadFocusSkillDescriptor: () => { entries: Array<{ id: string }> };
    };
    const manifest = definitions.loadFocusSkillDescriptor();
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]!.id).toBe('sentropic.focus');
  });

  it('vendored helper loads without @sentropic/focus installed (rev352r2-F3)', async () => {
    // Isolated copy with no workspace symlink and no focus package: the
    // pinned 1.0.0 manifest travels with the vendor, never a foreign copy.
    const { mkdtempSync: mkTmp, mkdirSync: mkDir, copyFileSync: cp, rmSync: rm } = await import('node:fs');
    const { tmpdir: osTmp } = await import('node:os');
    const { join: joinPath } = await import('node:path');
    const { pathToFileURL: toFileUrl } = await import('node:url');
    const iso = mkTmp(joinPath(osTmp(), 'track-focus-isolated-'));
    try {
      mkDir(joinPath(iso, 'registry'), { recursive: true });
      const hereUrl = new URL(import.meta.url);
      const vendorDir = new URL('../focus-vendor/registry/', hereUrl);
      const focusManifest = new URL('../../../focus/registry/entries.v1.json', hereUrl);
      cp(new URL('definitions.js', vendorDir), joinPath(iso, 'registry', 'definitions.js'));
      cp(focusManifest, joinPath(iso, 'registry', 'entries.v1.json'));
      const definitions = (await import(toFileUrl(joinPath(iso, 'registry', 'definitions.js')).href)) as unknown as {
        loadFocusSkillDescriptor: () => { entries: Array<{ id: string }> };
      };
      const manifest = definitions.loadFocusSkillDescriptor();
      expect(manifest.entries).toHaveLength(1);
      expect(manifest.entries[0]!.id).toBe('sentropic.focus');
    } finally {
      rm(iso, { recursive: true, force: true });
    }
  });

  it('performs NO append — the event log is byte-identical after a render', async () => {
    const { decisionId } = seed()
    const before = readFileSync(eventsPath, 'utf8')
    await runCli(['focus', decisionId, '--workspace', 'ws-1', '--baseline-commit', 'c1'], io(root))
    const after = readFileSync(eventsPath, 'utf8')
    expect(after).toBe(before)
  })
})
