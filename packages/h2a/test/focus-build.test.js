import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDecisionDossierForPresentation } from '@sentropic/focus/validate'

const kit = fileURLToPath(new URL('../focus-kit/', import.meta.url))
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const fixture = () => JSON.parse(readFileSync(join(kit, 'dossier.template.json'), 'utf8'))
const isolated = (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'focus-build-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const run = (root, ...args) => spawnSync(process.execPath, [bin, 'focus', ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'store') },
})

test('builds the shipped template into one portable validated HTML file', () => isolated((root) => {
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(fixture()))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
  const html = readFileSync(output, 'utf8')
  assert.match(result.stdout, /validated/)
  assert.match(html, /<title>Décision dossiers — format de présentation<\/title>/)
  assert.match(html, /data-focus-document/)
  const embedded = JSON.parse(html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.equal(validateDecisionDossierForPresentation(embedded.document).ok, true)
  assert.match(embedded.document.sections.find(s => s.kind === 'diagram').source, /^flowchart LR/)
  writeFileSync(input, JSON.stringify(embedded.document))
  assert.equal(run(root, 'build', input, '-o', output).status, 0, 'the embedded canonical document can be rebuilt')
  assert.match(html, /xyflow/)
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]+(?:src|href)=["'](?:https?:|\/|\.\/)/i)
  assert.doesNotMatch(html, /@import\s|url\(["']?https?:/i)
}))

test('refuses technocratic dossiers before creating or replacing output', () => isolated((root) => {
  const doc = fixture()
  delete doc.readability
  doc.title = 'Apply L06b under MH-L3'
  const input = join(root, 'bad.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  writeFileSync(output, 'previous dossier')
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /missing_owner_request/)
  assert.match(result.stderr, /undefined_code/)
  assert.equal(readFileSync(output, 'utf8'), 'previous dossier')
}))

test('refuses unknown document fields and invalid recommendations', () => isolated((root) => {
  for (const change of [d => { d.extra = true }, d => { d.sections.find(s => s.kind === 'question').recommendedOptionId = 'missing' }]) {
    const doc = fixture(); change(doc)
    const input = join(root, 'bad.json'), output = join(root, 'decision.html')
    writeFileSync(input, JSON.stringify(doc))
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 1, result.stderr)
    assert.equal(existsSync(output), false)
  }
}))

test('escapes hostile dossier text without executing markup', () => isolated((root) => {
  const doc = fixture()
  doc.sections.find(s => s.kind === 'prose').markdown = '</script><img src=x onerror=alert(1)> & é'
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
  const html = readFileSync(output, 'utf8')
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /\\u003c\/script>/)
}))

test('exports a reusable template and refuses invalid CLI arguments', () => isolated((root) => {
  const output = join(root, 'template.json')
  assert.equal(run(root, 'template', '-o', output).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), fixture())
  for (const args of [['build'], ['build', output], ['build', output, '-o'], ['build', output, '-o', 'x', '--typo']]) {
    assert.equal(run(root, ...args).status, 2, args.join(' '))
  }
  assert.equal(run(root, 'build', output, '-o', output).status, 1)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), fixture())
}))

test('resolves ecosystem references and refuses unknown scenes and unsupported diagrams', () => isolated((root) => {
  const catalog = JSON.parse(readFileSync(join(kit, 'ecosystem.json'), 'utf8'))
  const all = JSON.stringify(catalog)
  for (const name of ['h2a', 'cluster-mesh', 'llm-gateway', 'llm-mesh', 'track', 'engram', 'design-system', 'codex', 'claude', 'sentropic']) assert.ok(all.includes(name), name)
  for (const source of ['ecosystem:unknown', 'sequenceDiagram\nA->>B: hello']) {
    const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').source = source
    const input = join(root, 'bad.json'), output = join(root, 'decision.html')
    writeFileSync(input, JSON.stringify(doc))
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 1, result.stderr)
    assert.equal(existsSync(output), false)
  }
}))

test('validates every catalog scene and a custom flowchart through the canonical gate', () => isolated((root) => {
  const catalog = JSON.parse(readFileSync(join(kit, 'ecosystem.json'), 'utf8'))
  const profile = 'flowchart LR\nhub["h2a"]\nwork["track"]\nhub -->|travail| work'
  for (const source of [...Object.keys(catalog.scenes).map(n => `ecosystem:${n}`), profile]) {
    const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').source = source
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
    writeFileSync(input, JSON.stringify(doc))
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 0, result.stderr)
    const html = readFileSync(output, 'utf8')
    const payload = JSON.parse(html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
    assert.equal(validateDecisionDossierForPresentation(payload.document).ok, true)
  }
}))

test('accepts schema-valid diagram IDs that match object prototype keys', () => isolated((root) => {
  const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').id = '__proto__'
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.ok(Object.hasOwn(payload.scenes, '__proto__'))
}))

test('ships only runtime assets and builds from an extracted npm tarball', () => isolated((root) => {
  const packageDir = fileURLToPath(new URL('../', import.meta.url))
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root, packageDir], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root },
  })
  assert.equal(packed.status, 0, packed.stderr)
  const [pkg] = JSON.parse(packed.stdout)
  const assets = pkg.files.filter(f => f.path.startsWith('focus-kit/')).map(f => f.path)
  assert.ok(assets.includes('focus-kit/renderer.html'))
  assert.ok(assets.includes('focus-kit/dossier.schema.json'))
  assert.equal(assets.some(p => p.includes('node_modules') || p.includes('/test/') || p.includes('/src/')), false, 'frontend toolchain must not ship')
  const installed = join(root, 'install/node_modules/@sentropic/h2a')
  mkdirSync(installed, { recursive: true })
  const extracted = spawnSync('tar', ['-xzf', join(root, pkg.filename), '-C', installed, '--strip-components=1'], { encoding: 'utf8' })
  assert.equal(extracted.status, 0, extracted.stderr)
  const metadata = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  const modules = join(root, 'install/node_modules')
  for (const dependency of Object.keys(metadata.dependencies)) {
    const dest = join(modules, dependency)
    mkdirSync(join(dest, '..'), { recursive: true })
    symlinkSync(fileURLToPath(new URL(`../../../node_modules/${dependency}`, import.meta.url)), dest, 'junction')
  }
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(fixture()))
  const result = spawnSync(process.execPath, [join(installed, 'dist/bin.js'), 'focus', 'build', input, '-o', output], {
    encoding: 'utf8', cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'store') },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(output, 'utf8'), /data-focus-document/)
}))
