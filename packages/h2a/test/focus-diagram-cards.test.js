import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = fileURLToPath(new URL('../focus-kit/', import.meta.url))
const viewsModule = new URL('../focus-kit/diagram-views.mjs', import.meta.url)
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const fixture = () => JSON.parse(readFileSync(join(kit, 'dossier.template.json'), 'utf8'))
const isolated = (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'focus-cards-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
const run = (root, ...args) => spawnSync(process.execPath, [bin, 'focus', ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'store') },
})
const buildDoc = (root, doc) => {
  const input = join(root, 'dossier.json'), output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  return { result: run(root, 'build', input, '-o', output), output, input }
}
const payloadOf = (output) => JSON.parse(readFileSync(output, 'utf8')
  .match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1])
const sceneWith = (entities, relations = {}) => ({
  documentId: 'document:cards', schemaVersion: { major: 1, minor: 1 }, revision: 0,
  profileRefs: ['generic@1'], typeDefinitions: {}, entities, relations, ports: {}, resources: {}, extensions: [],
})
const node = (id, name) => ({ id: `entity:${id}`, profile: 'generic@1', type: 'node', attributes: { name: { kind: 'text', value: name } } })
const container = (id, name) => ({ id: `entity:${id}`, profile: 'generic@1', type: 'container', attributes: { name: { kind: 'text', value: name } } })
const contains = (parent, child) => ({ id: `relation:${parent}-${child}`, profile: 'generic@1', type: 'contains',
  endpoints: [{ role: 'parent', target: `entity:${parent}` }, { role: 'child', target: `entity:${child}` }], attributes: {} })
const mermaidDoc = (names, extra = {}) => {
  const doc = fixture()
  Object.assign(doc.sections.find(s => s.kind === 'diagram'), {
    source: `flowchart LR\n${names.map((n, i) => `n${i}["${n}"]`).join('\n')}`,
    ...extra,
  })
  return doc
}
const builtDiagrams = (root, doc) => {
  const { result, output } = buildDoc(root, doc)
  assert.equal(result.status, 0, result.stderr)
  const payload = payloadOf(output)
  const diagram = payload.document.sections.find(s => s.kind === 'diagram')
  return { payload, diagram, r7: payload.diagrams[diagram.id], html: readFileSync(output, 'utf8'), stderr: result.stderr }
}

test('renders untyped Mermaid flowcharts as process@1 boxes and retains generic@1 cards on architecture opt-out', async () => isolated(root => {
  const wf = builtDiagrams(root, mermaidDoc(['Coordinateur', 'Relais de modèles']))
  assert.ok(wf.r7 && wf.r7.renderer === 'r7', 'payload carries static DS diagram keyed by the diagram section id')
  assert.equal(wf.diagram.scene.profileRefs[0], 'process@1')
  assert.deepEqual([...wf.r7.wide.steps].sort(), Object.keys(wf.diagram.scene.entities).sort())
  assert.deepEqual(wf.r7.wide.cards, [])
  assert.match(wf.r7.wide.svg, /class="st-diagramProcessBox"/)
  assert.doesNotMatch(wf.r7.wide.svg, /data-toggle|st-diagramCard-icon/)
  assert.match(wf.r7.processTable ?? '', /class="st-diagramProcessTable"/)

  const { diagram, r7 } = builtDiagrams(root, mermaidDoc(['Coordinateur', 'Relais de modèles'], { diagramType: 'architecture' }))
  assert.ok(r7 && r7.renderer === 'r7', 'architecture opt-out renders generic@1 DS cards')
  assert.equal(diagram.scene.profileRefs[0], 'generic@1')
  assert.deepEqual([...r7.wide.cards].sort(), Object.keys(diagram.scene.entities).sort())
  assert.deepEqual([...r7.narrow.cards].sort(), Object.keys(diagram.scene.entities).sort())
  assert.deepEqual(r7.wide.problems, [])
  assert.deepEqual(r7.narrow.problems, [])
  assert.doesNotMatch(JSON.stringify(diagram.scene), /"(?:views?|geometry|layout)"/, 'the scene stays a pure diagram-core document')
  for (const [entityId, entity] of Object.entries(diagram.scene.entities)) {
    const name = entity.attributes.name.value
    assert.ok(r7.wide.svg.includes(`data-entity="${entityId}"`), 'DS card carries entity id')
    assert.ok(r7.wide.svg.includes(`<title>${name}</title>`), 'title is the entity name')
  }
  assert.doesNotMatch(r7.wide.svg, /class="st-diagramCard-kicker"[^>]*>node<\/text>/i, 'default renderer never leaks literal "node" kicker')
  assert.equal(r7.wide.svg.length > 500, true, 'inlined svg, not a reference')
}))

test('renders containers with children as DS DiagramZone frames in r7 and preserves legacy DC-1 renderDiagramViews', async () => {
  const { renderDiagramViews } = await import(viewsModule)
  const semantic = sceneWith({
    'entity:root': container('root', 'Services'),
    'entity:models': container('models', 'Modèles'),
    'entity:gateway': node('gateway', 'Relais de modèles'),
    'entity:coordinator': node('coordinator', 'Coordinateur'),
    'entity:flat': container('flat', 'Composants'),
  }, {
    'relation:root-models': contains('root', 'models'), 'relation:root-coordinator': contains('root', 'coordinator'),
    'relation:models-gateway': contains('models', 'gateway'),
  })
  // Default r7 build renders nested zones and treats childless containers as cards.
  isolated(root => {
    const doc = fixture()
    doc.sections.find(s => s.kind === 'diagram').scene = semantic
    const { r7 } = builtDiagrams(root, doc)
    assert.deepEqual([...r7.wide.zones].sort(), ['entity:models', 'entity:root'])
    assert.deepEqual([...r7.wide.cards].sort(), ['entity:coordinator', 'entity:flat', 'entity:gateway'])
    assert.deepEqual(r7.wide.problems, [])
    assert.deepEqual(r7.narrow.problems, [])
    assert.doesNotMatch(r7.wide.svg, /class="st-diagramZone-kicker"[^>]*>container<\/text>/i)
  })
  // Legacy DC-1 renderDiagramViews export remains intact for existing unit-level callers.
  const legacy = renderDiagramViews(semantic)
  assert.equal(legacy.kind, 'rendered')
  const { views } = legacy
  assert.equal(views['entity:coordinator'].kind, 'card')
  assert.equal(views['entity:gateway'].kind, 'card')
  assert.equal(views['entity:flat'].kind, 'card', 'a container without children is never a foldable zone')
  assert.equal(views['entity:flat'].foldedSvg, undefined)
  for (const zid of ['entity:models', 'entity:root']) {
    const view = views[zid]
    assert.equal(view.kind, 'zone')
    assert.match(view.svg, /class="st-diagramZoneSvg"/)
    assert.match(view.svg, new RegExp(`class="st-diagramZone st-diagramZone--expanded" data-entity="${zid}" data-collapsed="false"`))
    assert.match(view.svg, /class="st-diagramZone-rule"[^>]*stroke-width="1" vector-effect="non-scaling-stroke"/, 'header rule 1px')
    assert.ok(!view.svg.includes('st-diagramCard-toggle'), 'no inert fold toggle on the expanded display form')
    assert.match(view.foldedSvg, new RegExp(`class="st-diagramZone st-diagramZone--collapsed" data-entity="${zid}" data-collapsed="true"`), 'the folded form is the 460x200 card face')
    assert.match(view.foldedSvg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="st-diagramZoneSvg" width="460" height="200" viewBox="0 0 460 200"/)
    assert.match(view.foldedSvg, /class="st-diagramCard-toggle" data-toggle="true" data-collapsed="true"/, 'the folded form carries the « + » toggle glyph')
    const title = view === views['entity:root'] ? 'Services' : 'Modèles'
    assert.match(view.foldedSvg, new RegExp(`<title>Déplier : ${title}</title>`), 'toggle title names the unfolding action')
    assert.match(view.foldedSvg, /style="text-transform:uppercase">container<\/text>/, 'legacy DC-1 kicker is the element kind (container)')
  }
  const pageSize = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(views['entity:root'].svg)
  assert.ok(Number(pageSize[1]) > 492 && Number(pageSize[2]) > 200, 'the expanded frame grows to host the child grid')
})

test('pins the DC-1 reference geometry: 492/1044 wide zones, header content start from the DS 0.37.0 zone header, centred variant', async () => {
  const { renderDiagramViews, interimLayout } = await import(viewsModule)
  // DS 0.37.0 zone header content top for a one-line title (literal: a DS drift must fail here).
  const contentTop = 106.1875
  const document = sceneWith({
    'entity:root': container('root', 'Services'),
    'entity:models': container('models', 'Modèles'),
    'entity:gateway': node('gateway', 'Relais de modèles'),
    'entity:coordinator': node('coordinator', 'Coordinateur'),
  }, { 'relation:root-models': contains('root', 'models'), 'relation:root-coordinator': contains('root', 'coordinator'), 'relation:models-gateway': contains('models', 'gateway') })
  const layout = interimLayout(document)
  assert.ok(layout.refusals.length === 0)
  assert.ok(layout.contentTops.get('entity:models') === contentTop, 'children start at the DS zone header content top, not a hand-tuned inset')
  assert.deepEqual(layout.boxes.get('entity:models'), { width: 492, height: contentTop + 200 + 16 }, 'zone = 460 card + 16 inline insets; height = content top + one row + 16 bottom inset')
  assert.deepEqual(layout.boxes.get('entity:root'), { width: 1044, height: contentTop + 322.1875 + 16 }, 'two columns, 60px gutter, 50px row gap kept from the engine')
  const gateway = layout.nodes.find(n => n.id === 'entity:gateway')
  const models = layout.nodes.find(n => n.id === 'entity:models')
  assert.deepEqual(gateway.position, { x: 16, y: contentTop }, 'first child at 16px inline inset and the zone content top')
  assert.equal(models.parentId, 'entity:root')
  assert.equal(gateway.parentId, 'entity:models')
  const rendered = renderDiagramViews(document)
  assert.equal(rendered.kind, 'rendered')
  const size = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(rendered.views['entity:models'].svg)
  assert.equal(Number(size[1]), 492, 'the svg frame uses the exact placement size')
  const centred = renderDiagramViews(document, { align: 'center' })
  assert.equal(centred.kind, 'rendered')
  assert.match(centred.views['entity:coordinator'].svg, /text-anchor="middle"/, 'the centred variant is supported')
  assert.doesNotMatch(rendered.views['entity:coordinator'].svg, /text-anchor="middle"/, 'left by default')
})

test('ships diagram-views.mjs self-contained: it renders where no design-system package resolves, with the DS notice', async () => {
  const source = readFileSync(viewsModule, 'utf8')
  const root = mkdtempSync(join(tmpdir(), 'focus-views-standalone-'))
  try {
    // Outside every node_modules tree: a bare import of the DS would not resolve here.
    const copy = join(root, 'diagram-views.mjs')
    writeFileSync(copy, source)
    const { renderDiagramViews } = await import(pathToFileURL(copy).href)
    const outcome = renderDiagramViews(sceneWith({ 'entity:a': node('a', 'Coordinateur') }))
    assert.equal(outcome.kind, 'rendered')
    assert.match(outcome.views['entity:a'].svg, /class="st-diagramCard" data-entity="entity:a" width="460" height="200"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
  const imports = [...source.matchAll(/(?:^|[\s;])(?:import|export)\b[^'"`]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)]
    .map(m => m[1] ?? m[2]).filter(specifier => !specifier.startsWith('node:'))
  assert.deepEqual(imports, [], 'no run-time import: the pure DS renderers are bundled')
  assert.doesNotMatch(source, /svelte\/internal|@tiptap|prosemirror/, 'no Svelte runtime or editor code in the bundle')
  const banner = source.slice(0, source.indexOf('*/'))
  assert.match(banner, /@sentropic\/diagram-canvas@0\.8\.0\nMIT License/, 'the bundled DS canvas licence travels with the module')
  assert.match(banner, /@sentropic\/diagram-core@0\.6\.1\nMIT License/, 'the bundled DS core licence travels with the module')
  const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(dependencies['@sentropic/design-system-svelte'], undefined, 'the published CLI installs no frontend package')
})

test('refuses an architecture diagram whose card cannot carry its title with typed diagnostics, preserving the previous output', () => isolated(root => {
  const output = join(root, 'decision.html')
  writeFileSync(output, 'previous complete revision')
  const doc = mermaidDoc(['Coordinationinterorganisationnelledurablepermanente'], { diagramType: 'architecture' })
  const { result } = buildDoc(root, doc)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Diagram view refused/, 'the refusal is an explicit diagram-view refusal')
  assert.match(result.stderr, /card-overflow title entity:n0/, 'typed diagnostic: code, slot and entity')
  assert.match(result.stderr, /Coordinationinterorganisationnelledurablepermanente/, 'refusing text quoted')
  assert.match(result.stderr, /needed \d+(?:\.\d+)?px > \d+(?:\.\d+)?px/, 'measurements in the message')
  assert.equal(readFileSync(output, 'utf8'), 'previous complete revision', 'no silent fallback, previous output preserved')
}))

test('keeps the built dossier offline, CSP-safe and free of the local interim card markup', () => isolated(root => {
  const { r7, html } = builtDiagrams(root, mermaidDoc(['Coordinateur', 'Relais de modèles']))
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">/)
  for (const svg of [r7.wide.svg, r7.narrow.svg]) {
    assert.doesNotMatch(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), /https?:\/\//, 'the xmlns namespace is the only URL-shaped text')
    assert.ok(!/src=|xlink:href/i.test(svg), 'no external or data asset fetch at view time')
    assert.doesNotMatch(svg, /fetch\(|XMLHttpRequest/)
  }
  assert.ok(!html.includes('ecosystem-node') && !html.includes('ecosystem-container'), 'the local interim card CSS/markup is removed')
  assert.ok(html.includes('st-diagramCard') && html.includes('ds-diagram-svg'), 'the static r7 inline SVG with DS cards is inlined in the built page')
}))

test('refuses a diagram-less dossier with the ecosystem-diagram refusal', () => isolated(root => {
  const doc = fixture()
  doc.sections = doc.sections.filter(s => s.kind !== 'diagram')
  const refused = buildDoc(root, doc)
  assert.equal(refused.result.status, 1)
  assert.match(refused.result.stderr, /A Focus dossier needs an ecosystem diagram/, 'the diagram-less builder refusal stays')
}))

