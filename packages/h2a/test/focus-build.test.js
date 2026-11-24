import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDecisionDossierForPresentation } from '@sentropic/focus/validate'
import { evidenceFixture } from '../focus-kit/test/evidence-fixtures.mjs'
import * as portableValidator from '../focus-kit/validator.mjs'

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

test('builds an explicit benchmark report and preserves output on report gate failures', () => isolated(root => {
  const doc = JSON.parse(readFileSync(new URL('../../focus/tests/fixtures/benchmark-report.json', import.meta.url), 'utf8'))
  const input = join(root, 'report.json'), output = join(root, 'report.html')
  writeFileSync(input, JSON.stringify(doc))
  const built = run(root, 'build', input, '-o', output)
  assert.equal(built.status, 0, built.stderr)
  const html = readFileSync(output, 'utf8')
  const payload = JSON.parse(html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.deepEqual(payload.document, doc)
  assert.ok(payload.build.capabilities.includes('report'))
  assert.equal(portableValidator.validateFocusForPresentation(doc).ok, true)
  assert.equal(portableValidator.validateDecisionDossierForPresentation(doc).ok, false, 'N3 decision-only profile still refuses reports')
  assert.equal(Buffer.compare(readFileSync(join(kit, 'report.schema.json')), readFileSync(join(kit, '../../focus/schemas/report-document.v1.schema.json'))), 0)
  for (const change of [d => { delete d.kind }, d => { d.sources[0].sha256 = '0'.repeat(64) }, d => { d.kind = 'unknown' }]) {
    const bad = structuredClone(doc); change(bad); writeFileSync(input, JSON.stringify(bad))
    assert.equal(run(root, 'build', input, '-o', output).status, 1)
    assert.equal(readFileSync(output, 'utf8'), html)
  }
  const oversized = structuredClone(doc)
  oversized.sections[1].markdown += `\n| Mesure | ${'Mesure stable. '.repeat(15)}\\| ${'Mesure stable. '.repeat(20)} |`
  const refused = portableValidator.validateFocusForPresentation(oversized)
  assert.equal(refused.ok, false)
  assert.ok(refused.issues.some(issue => issue.code === 'cell_max_60_words' && issue.message.includes('found 71 words')))
  writeFileSync(input, JSON.stringify(oversized))
  const rejected = run(root, 'build', input, '-o', output)
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /cell_max_60_words/)
  assert.equal(readFileSync(output, 'utf8'), html)
}))

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
  assert.match(html, /ds-diagram-svg/)
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
  doc.sections.find(s => s.kind === 'prose').markdown = 'En bref : </script><img src=x onerror=alert()> & é.'
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

test('A21: dossier.template.json and dossier.evidence.template.json pass validateDecisionDossierForPresentation with 0 issues', () => {
  const v1Template = JSON.parse(readFileSync(join(kit, 'dossier.template.json'), 'utf8'))
  const v2Template = JSON.parse(readFileSync(join(kit, 'dossier.evidence.template.json'), 'utf8'))
  const res1 = validateDecisionDossierForPresentation(v1Template)
  const res2 = validateDecisionDossierForPresentation(v2Template)
  assert.equal(res1.ok, true, JSON.stringify(res1))
  assert.equal(res2.ok, true, JSON.stringify(res2))
})

test('A22: buildFocusDossier refuses a reference diagram (sourceRef) with a clear error naming diagramResolver and preserves previous output', () => isolated((root) => {
  const doc = fixture()
  const idx = doc.sections.findIndex(s => s.kind === 'diagram')
  doc.sections[idx] = {
    kind: 'diagram',
    id: 'architecture',
    targetRef: 'decision:focus-presentation',
    alt: 'Architecture par référence.',
    sourceRef: 'engram:diag-lot-map',
    renderComponent: 'GanttChart',
  }
  const input = join(root, 'ref-diagram.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  writeFileSync(output, 'previous portable bundle')
  const result = run(root, 'build', input, '-o', output)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Reference diagram "architecture" \(GanttChart -> engram:diag-lot-map\) requires a host diagramResolver; offline portable bundles support inline diagrams only/)
  assert.equal(readFileSync(output, 'utf8'), 'previous portable bundle')
}))

test('A24: focus-kit schema copies match packages/focus/schemas and renderer.html sha256 stays unchanged', () => {
  const v1Kit = readFileSync(join(kit, 'dossier.schema.json'))
  const v1Focus = readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v1.schema.json'))
  const v2Kit = readFileSync(join(kit, 'dossier.v2.schema.json'))
  const v2Focus = readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v2.schema.json'))
  assert.equal(Buffer.compare(v1Kit, v1Focus), 0)
  assert.equal(Buffer.compare(v2Kit, v2Focus), 0)
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/build-focus-dossier.mjs', import.meta.url)), '--check'], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
})

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

test('FA-H1: writeFocusArtifactFile replaces publishFocusArtifact and build embeds un-enriched canonical documentDigest', async () => {
  const mod = await import('../dist/focus-build.js')
  assert.equal(typeof mod.writeFocusArtifactFile, 'function', 'writeFocusArtifactFile must be exported')
  assert.equal(mod.publishFocusArtifact, undefined, 'publishFocusArtifact must be renamed and removed')

  const { baseDigest, canonicalJson } = await import('@sentropic/focus/editing')
  const { createHash } = await import('node:crypto')
  isolated(root => {
    const doc = fixture()
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
    const canonical = canonicalJson(doc)
    assert.equal(canonical.endsWith('\n'), false)
    writeFileSync(input, canonical, 'utf8')
    const expectedDigest = `sha256:${createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')}`
    assert.equal(expectedDigest, baseDigest(doc))

    const result = run(root, 'build', input, '-o', output)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
    assert.equal(payload.build.documentDigest, expectedDigest, 'build.documentDigest must hash un-enriched canonical source')
    assert.notEqual(payload.build.documentDigest, baseDigest(payload.document), 'enriched sections must not affect documentDigest')
    assert.match(payload.build.envelopeSha256, /^[a-f0-9]{64}$/)
    assert.match(payload.build.rendererSha256, /^[a-f0-9]{64}$/)
    assert.match(payload.build.validatorSha256, /^[a-f0-9]{64}$/)
  })
})

test('FA-H1: CLI focus check validates without mutation, enforces R2-R6/bounds, and matches build on local corpus', async () => {
  const { createHash } = await import('node:crypto')
  const { readdirSync } = await import('node:fs')
  const { buildFocusArtifactManifest } = await import('@sentropic/focus/artifact')

  isolated(root => {
    const doc = fixture()
    const input = join(root, 'dossier.json')
    const output = join(root, 'decision.html')
    const raw = JSON.stringify(doc, null, 2)
    writeFileSync(input, raw, 'utf8')
    const beforeFiles = readdirSync(root).sort()

    // Valid check without previous manifest: zero mutation.
    const okCheck = run(root, 'check', input)
    assert.equal(okCheck.status, 0, okCheck.stderr)
    const checked = JSON.parse(okCheck.stdout)
    assert.equal(checked.ok, true)
    assert.match(checked.documentDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(checked.bindingName, `focus:${doc.ref}`)
    assert.equal(checked.revisionSeq, 1)
    assert.deepEqual(readdirSync(root).sort(), beforeFiles, 'check must not create files')
    assert.equal(readFileSync(input, 'utf8'), raw, 'check must not mutate input')

    // Local corpus parity between check and build (R5, R6, bindingName, shared targetRef).
    const sharedTarget = structuredClone(doc)
    sharedTarget.sections.filter(s => s.kind === 'prose').forEach(s => { s.targetRef = 'shared:ref' })
    writeFileSync(input, JSON.stringify(sharedTarget), 'utf8')
    assert.equal(run(root, 'check', input).status, 0)
    assert.equal(run(root, 'build', input, '-o', output).status, 0)
    const intactHtml = readFileSync(output, 'utf8')

    const localRefusals = [
      ['R5 space in id', d => { d.sections[0].id = 'bad id' }, 'focus-anchor-not-anchorable', '$.sections[0].id'],
      ['R5 space in ref', d => { d.ref = 'decision:bad ref' }, 'focus-anchor-not-anchorable', '$.ref'],
      ['R6 id equals ref', d => { d.sections[0].id = d.ref }, 'focus-anchor-equals-document-ref', '$.sections[0].id'],
      ['bindingName > 128', d => { d.ref = 'r'.repeat(123) }, 'focus-binding-name-too-long', '$.ref'],
      ['R2 duplicate_id', d => { d.sections.at(-1).id = d.sections[0].id }, 'duplicate_id', '$.sections'],
    ]
    for (const [label, mutate, code, pathPrefix] of localRefusals) {
      const bad = structuredClone(doc)
      mutate(bad)
      writeFileSync(input, JSON.stringify(bad), 'utf8')

      const cRes = run(root, 'check', input)
      assert.equal(cRes.status, 1, `check must refuse ${label}`)
      const cPayload = JSON.parse(cRes.stdout)
      assert.equal(cPayload.ok, false)
      assert.ok(cPayload.refusals.some(r => r.code === code && r.path?.startsWith(pathPrefix)), `${label}: ${JSON.stringify(cPayload.refusals)}`)

      const bRes = run(root, 'build', input, '-o', output)
      assert.equal(bRes.status, 1, `build must refuse ${label}`)
      assert.match(bRes.stderr, new RegExp(code), label)
      assert.equal(readFileSync(output, 'utf8'), intactHtml, `build must preserve prior output on ${label}`)
    }

    // Oversized canonical dossier (> 1 048 576 bytes) refused by check.
    const huge = evidenceFixture()
    const payload = Buffer.alloc(790_000, 0x61)
    huge.sources.push({
      id: 'huge-blob',
      title: 'Volume excessif',
      origin: { uri: 'urn:fixture:huge' },
      mediaType: 'text/plain',
      encoding: 'base64',
      data: payload.toString('base64'),
      sha256: createHash('sha256').update(payload).digest('hex'),
      size: payload.byteLength,
    })
    const hugeInput = join(root, 'huge.json')
    writeFileSync(hugeInput, JSON.stringify(huge), 'utf8')
    const hugeRes = run(root, 'check', hugeInput)
    assert.equal(hugeRes.status, 1)
    const hugePayload = JSON.parse(hugeRes.stdout)
    assert.ok(hugePayload.refusals.some(r => r.code === 'focus-document-too-large' && r.path === '$'))

    // R3 & R4 with --previous-manifest.
    const manifest1 = buildFocusArtifactManifest({
      document: doc,
      renderer: { name: '@sentropic/design-system-elements', version: '0.3.0', entry: 'renderer/dossier.js', digest: `sha256:${'a'.repeat(64)}`, files: [], capabilities: [] },
      validator: { name: '@sentropic/focus', version: '0.6.0', digest: `sha256:${'b'.repeat(64)}` },
      generator: { name: '@sentropic/h2a', version: '0.98.11' },
      createdAt: '2026-11-20T00:00:00Z',
    })
    const manifestPath = join(root, 'prev.manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest1), 'utf8')

    const kindChanged = structuredClone(doc)
    const idx = kindChanged.sections.findIndex(s => s.id === 'rationale')
    kindChanged.sections[idx] = { kind: 'outcome', id: 'rationale', targetRef: 'rationale', modality: 'decision', statement: 'En bref : garder le portable.', questionId: 'format' }
    writeFileSync(input, JSON.stringify(kindChanged), 'utf8')
    const r3Res = run(root, 'check', input, '--previous-manifest', manifestPath)
    assert.equal(r3Res.status, 1)
    assert.ok(JSON.parse(r3Res.stdout).refusals.some(r => r.code === 'focus-anchor-kind-changed' && r.path === `$.sections[${idx}].id`))

    // Retire rationale in rev 2, then reuse rationale against manifest2 -> R4.
    const rev2 = structuredClone(doc)
    rev2.sections = rev2.sections.filter(s => s.id !== 'rationale')
    const manifest2 = buildFocusArtifactManifest({
      document: rev2,
      renderer: manifest1.renderer,
      validator: manifest1.validator,
      generator: manifest1.generator,
      previousManifest: manifest1,
      createdAt: '2026-11-20T01:00:00Z',
    })
    writeFileSync(manifestPath, JSON.stringify(manifest2), 'utf8')
    writeFileSync(input, JSON.stringify(doc), 'utf8')
    const r4Res = run(root, 'check', input, '--previous-manifest', manifestPath)
    assert.equal(r4Res.status, 1)
    assert.ok(JSON.parse(r4Res.stdout).refusals.some(r => r.code === 'focus-anchor-reused' && r.path === `$.sections[${idx}].id`))
  })
})

test('artifact target emits a shell-safe fragment without document shell or CSP meta', () => isolated((root) => {
  const doc = fixture()
  const input = join(root, 'dossier.json'), full = join(root, 'full.html'), frag = join(root, 'fragment.html')
  writeFileSync(input, JSON.stringify(doc))
  // Default output stays a full standalone document for file:// use.
  assert.equal(run(root, 'build', input, '-o', full).status, 0)
  const html = readFileSync(full, 'utf8')
  assert.match(html, /^<!doctype html>/i)
  assert.match(html, /<html[\s>]/i)
  assert.match(html, /<body[\s>]/i)
  assert.match(html, /Content-Security-Policy/)
  const documentPayload = JSON.parse(html.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.equal(documentPayload.target, 'document')
  // Artifact publishing gets a fragment: title + style + body content only.
  const built = run(root, 'build', input, '-o', frag, '--target', 'artifact')
  assert.equal(built.status, 0, built.stderr)
  const fragment = readFileSync(frag, 'utf8')
  assert.doesNotMatch(fragment, /<!doctype/i)
  assert.doesNotMatch(fragment, /<html[\s>]/i)
  assert.doesNotMatch(fragment, /<head[\s>]/i)
  assert.doesNotMatch(fragment, /<\/head>/i)
  assert.doesNotMatch(fragment, /<body[\s>]/i)
  assert.doesNotMatch(fragment, /<\/body>/i)
  assert.doesNotMatch(fragment, /<\/html>/i)
  assert.doesNotMatch(fragment, /Content-Security-Policy/)
  assert.match(fragment, /<title>[^<]+<\/title>/)
  assert.match(fragment, /<style>[\s\S]+<\/style>/)
  assert.match(fragment, /data-focus-document/)
  assert.match(fragment, /id="app"/)
  const payload = JSON.parse(fragment.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.equal(payload.target, 'artifact')
  assert.deepEqual(payload.document.title, doc.title)
  assert.equal(run(root, 'build', input, '-o', frag, '--target', 'popup').status, 2)
}))

test('artifact fragment offers an open-in-new-tab alternative where download is blocked', () => isolated((root) => {
  const doc = evidenceFixture(2_000, 7)
  const input = join(root, 'evidence.json'), frag = join(root, 'fragment.html')
  writeFileSync(input, JSON.stringify(doc))
  const built = run(root, 'build', input, '-o', frag, '--target', 'artifact')
  assert.equal(built.status, 0, built.stderr)
  const fragment = readFileSync(frag, 'utf8')
  assert.doesNotMatch(fragment, /<!doctype/i)
  assert.doesNotMatch(fragment, /Content-Security-Policy/)
  assert.match(fragment, /nouvel onglet/)
  assert.match(fragment, /target="_blank"/)
  const payload = JSON.parse(fragment.match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
  assert.equal(payload.target, 'artifact')
  assert.ok(payload.document.sources.length > 0)
}))

test('kit CSS keeps diagrams at natural size, DS container width, measured per-diagram variant and semantic fallbacks', () => {
  const css = readFileSync(join(kit, 'src/style.css'), 'utf8')
  const diagramRule = css.match(/\.ds-diagram-svg\s*\{([\s\S]*?)\}/)
  assert.ok(diagramRule, 'ds-diagram-svg rule must exist')
  assert.match(diagramRule[1], /width\s*:\s*auto/)
  assert.match(diagramRule[1], /max-width\s*:\s*100%/)
  assert.match(diagramRule[1], /margin\s*:\s*0\s+auto/)
  assert.doesNotMatch(diagramRule[1], /(?:^|[{;\s])width\s*:\s*100%/)
  const mainRule = css.match(/(^|\n)main\s*\{([\s\S]*?)\}/)
  assert.ok(mainRule, 'main rule must exist')
  assert.match(mainRule[2], /var\(--st-container-lg,\s*64rem\)/)
  assert.match(mainRule[2], /var\(--st-spacing-4,\s*1rem\)/)
  assert.doesNotMatch(mainRule[2], /72rem/)
  assert.match(css, /\.ds-diagram-stage\[data-active="wide"\]/)
  assert.match(css, /\.ds-diagram-stage\[data-active="narrow"\]/)
  assert.doesNotMatch(css, /1199px/)
  assert.doesNotMatch(css, /599px/)
  const bare = [...css.matchAll(/var\(--st-semantic-[a-z-]+\)/g)].map(m => m[0])
  assert.deepEqual(bare, [], `semantic vars without fallback: ${[...new Set(bare)].join(', ')}`)
  // The built portable bundle carries the same fixes.
  const bundle = readFileSync(join(kit, 'renderer.html'), 'utf8')
  const style = bundle.match(/<style>([\s\S]*?)<\/style>/)[1]
  assert.match(style, /\.ds-diagram-svg\{[^}]*width:auto[^}]*max-width:100%/)
  assert.ok(!/\.ds-diagram-svg\{[^}]*(?:^|[;{])width:100%/.test(style))
  assert.ok(style.includes('data-active'))
  assert.ok(!style.includes('599px'))
  assert.ok(!style.includes('1199px'))
})
