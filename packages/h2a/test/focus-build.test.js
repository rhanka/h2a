import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDecisionDossierForPresentation } from '@sentropic/focus/validate'
import { evidenceFixture } from '../focus-kit/test/evidence-fixtures.mjs'

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

test('builds complete v2 evidence with distinct envelope and renderer fingerprints', () => isolated(root => {
  const doc = evidenceFixture(20_000, 31), input = join(root, 'evidence.json'), output = join(root, 'evidence.html')
  writeFileSync(input, JSON.stringify(doc))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.deepEqual(payload.document.sources, doc.sources)
  assert.equal(payload.document.hash, doc.hash)
  assert.equal(payload.build.increment, 'H1')
  assert.match(payload.build.envelopeSha256, /^[a-f0-9]{64}$/)
  assert.match(payload.build.rendererSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(payload.build.formats, [1, 2])
}))

test('keeps previous output byte-identical on evidence integrity and version refusals', async t => {
  for (const [name, change, code] of [
    ['digest', d => { d.sources[0].sha256 = '0'.repeat(64) }, 'source_digest'],
    ['range', d => { d.citations[0].locator.end = 999 }, 'citation_range'],
    ['id', d => { d.sources.push(d.sources[0]) }, 'duplicate_id'],
    ['version', d => { d.schemaVersion = 3 }, 'unsupported_version'],
  ]) await t.test(name, () => isolated(root => {
    const doc = evidenceFixture(), input = join(root, 'bad.json'), output = join(root, 'old.html')
    change(doc); writeFileSync(input, JSON.stringify(doc)); writeFileSync(output, 'previous complete revision')
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 1); assert.match(result.stderr, new RegExp(code))
    assert.equal(readFileSync(output, 'utf8'), 'previous complete revision')
  }))
})

test('preserves the complete previous revision when a write fails after partial bytes', () => isolated(root => {
  const input = join(root, 'dossier.json'), output = join(root, 'previous.html'), hook = join(root, 'fail-write.mjs')
  writeFileSync(input, JSON.stringify(fixture())); writeFileSync(output, 'previous complete revision')
  writeFileSync(hook, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const write=fs.writeFileSync; fs.writeFileSync=(path,data,...args)=>{write(path,String(data).slice(0,80),...args);throw new Error('Injected partial write');}; syncBuiltinESMExports();`)
  const result = spawnSync(process.execPath, ['--import', hook, bin, 'focus', 'build', input, '-o', output], {
    cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'h2a') },
  })
  assert.equal(result.status, 1); assert.match(result.stderr, /Injected partial write/)
  assert.equal(readFileSync(output, 'utf8'), 'previous complete revision')
}))

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
  assert.equal(payload.document.sections.find(s => s.id === '__proto__').scene.profileRefs[0], 'generic@1')
}))

test('emits diagram-core generic@1 documents for every ecosystem diagram and preserves them on rebuild', () => isolated((root) => {
  const catalog = JSON.parse(readFileSync(join(kit, 'ecosystem.json'), 'utf8'))
  for (const name of Object.keys(catalog.scenes)) {
    const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').source = `ecosystem:${name}`
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
    writeFileSync(input, JSON.stringify(doc))
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
    const scene = payload.document.sections.find(s => s.kind === 'diagram').scene
    assert.ok(scene, name)
    assert.deepEqual(Object.keys(scene).sort(), ['documentId', 'schemaVersion', 'revision', 'profileRefs', 'typeDefinitions', 'entities', 'relations', 'ports', 'resources', 'extensions'].sort())
    assert.match(scene.documentId, /^document:/)
    assert.deepEqual(scene.schemaVersion, { major: 1, minor: 1 })
    assert.equal(scene.revision, 0)
    assert.deepEqual(scene.profileRefs, ['generic@1'])
    for (const key of ['typeDefinitions', 'ports', 'resources']) assert.deepEqual(scene[key], {})
    assert.deepEqual(scene.extensions, [])
    for (const [id, entity] of Object.entries(scene.entities)) {
      assert.match(id, /^entity:/)
      assert.deepEqual(entity, { id, profile: 'generic@1', type: 'node', attributes: { name: { kind: 'text', value: entity.attributes.name.value } } })
    }
    for (const [id, relation] of Object.entries(scene.relations)) {
      assert.match(id, /^relation:/)
      assert.deepEqual(Object.keys(relation).sort(), ['id', 'profile', 'type', 'endpoints', 'attributes'].sort())
      assert.equal(relation.id, id)
      assert.equal(relation.profile, 'generic@1')
      assert.equal(relation.type, 'link')
      assert.deepEqual(relation.endpoints.map(e => e.role), ['source', 'target'])
      for (const endpoint of relation.endpoints) assert.ok(Object.hasOwn(scene.entities, endpoint.target))
      assert.equal(relation.attributes.label.kind, 'text')
    }
    assert.equal(Object.hasOwn(payload, 'scenes'), false, 'no parallel Focus graph model')
    assert.doesNotMatch(JSON.stringify(scene), /"(?:view|views|geometry|position|layout|direction|width|height)"/)
    writeFileSync(input, JSON.stringify(payload.document))
    const rebuilt = run(root, 'build', input, '-o', output)
    assert.equal(rebuilt.status, 0, rebuilt.stderr)
    const again = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
    assert.deepEqual(again.document.sections.find(s => s.kind === 'diagram').scene, scene)
  }
}))

test('uses supplied diagram-core semantics instead of the Mermaid fallback or ecosystem macro', () => isolated((root) => {
  const scene = JSON.parse(readFileSync(join(kit, '../../focus/tests/diagram-core-generic.fixture.json'), 'utf8'))
  const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').scene = scene
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  const diagram = payload.document.sections.find(s => s.kind === 'diagram')
  assert.deepEqual(diagram.scene, scene)
  assert.equal(diagram.syntax, 'mermaid')
  assert.match(diagram.source, /^flowchart LR\n/)
  for (const entity of Object.values(scene.entities)) assert.ok(diagram.source.includes(entity.attributes.name.value))
  assert.doesNotMatch(diagram.source, /ecosystem:overview/)
  writeFileSync(input, JSON.stringify(payload.document))
  assert.equal(run(root, 'build', input, '-o', output).status, 0)
}))

test('refuses nested layout hints and malformed semantic records without replacing output', async t => {
  const changes = {
    'schema version hint': s => { s.schemaVersion.geometry = {} },
    'entity geometry': s => { s.entities['entity:coordinator'].attributes.geometry = {} },
    'name placement': s => { s.entities['entity:coordinator'].attributes.name.side = 'left' },
    'relation waypoints': s => { s.relations['relation:requests'].attributes.waypoints = [] },
    'relation attributes string': s => { s.relations['relation:requests'].attributes = 'invalid' },
    'relation attributes array': s => { s.relations['relation:requests'].attributes = [] },
    'relation attributes null': s => { s.relations['relation:requests'].attributes = null },
    'missing relation attributes': s => { delete s.relations['relation:requests'].attributes },
    'label placement': s => { s.relations['relation:requests'].attributes.label.side = 'left' },
    'endpoint side': s => { s.relations['relation:requests'].endpoints[0].side = 'left' },
    'null endpoint': s => { s.relations['relation:requests'].endpoints[0] = null },
    'containment attributes': s => { Object.values(s.relations).find(r => r.type === 'contains').attributes.label = { kind: 'text', value: 'Hidden' } },
  }
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, () => isolated(root => {
      const doc = fixture(), scene = JSON.parse(readFileSync(join(kit, '../../focus/tests/diagram-core-generic.fixture.json'), 'utf8'))
      change(scene); doc.sections.find(s => s.kind === 'diagram').scene = scene
      const input = join(root, 'bad.json'), output = join(root, 'decision.html')
      writeFileSync(input, JSON.stringify(doc)); writeFileSync(output, 'previous dossier')
      const result = run(root, 'build', input, '-o', output)
      assert.equal(result.status, 1, `${name}: ${result.stderr}`)
      assert.match(result.stderr, /Unsupported diagram-core document/, name)
      assert.equal(readFileSync(output, 'utf8'), 'previous dossier', name)
    }))
  }
})

test('budgets two ecosystem diagrams by their displayed labels instead of Mermaid syntax and comments', () => isolated((root) => {
  const doc = fixture()
  doc.readability.stakesLevel = 'low'; doc.readability.readingBudgetMinutes = 2
  doc.sections = doc.sections.filter(s => s.kind !== 'prose')
  doc.sections.find(s => s.kind === 'question').readingTimeMinutes = 0.8
  doc.sections.push({ ...doc.sections.find(s => s.kind === 'diagram'), id: 'second-diagram', targetRef: 'second-diagram' })
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 0, result.stderr)
}))

test('checks diagram-core visible text through the readability gate before replacing output', () => isolated((root) => {
  const scene = JSON.parse(readFileSync(join(kit, '../../focus/tests/diagram-core-generic.fixture.json'), 'utf8'))
  const doc = fixture(); doc.sections.find(s => s.kind === 'diagram').scene = scene
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  for (const text of [scene.entities['entity:coordinator'].attributes.name, scene.relations['relation:requests'].attributes.label]) {
    const previous = text.value; text.value = 'Apply L06b under MH-L3'
    writeFileSync(input, JSON.stringify(doc)); writeFileSync(output, 'previous dossier')
    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /undefined_code/)
    assert.equal(readFileSync(output, 'utf8'), 'previous dossier')
    text.value = previous
  }
}))

test('ships only runtime assets and builds from an extracted npm tarball', () => isolated((root) => {
  const packageDir = fileURLToPath(new URL('../', import.meta.url))
  // Round-3 (reviews pr382-r3): the running node's directory leads PATH —
  // nested spawns on CI runners otherwise resolve npm through a PATH that
  // no longer carries the toolchain pin (ENOENT with status null), which
  // would read as a packaging failure. npm ships beside node everywhere.
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root, packageDir], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` },
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
