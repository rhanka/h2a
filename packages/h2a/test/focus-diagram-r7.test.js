import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const kit = fileURLToPath(new URL('../focus-kit/', import.meta.url))
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url))
const fixture = () => JSON.parse(readFileSync(join(kit, 'dossier.template.json'), 'utf8'))

const isolated = (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'focus-r7-'))
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

const run = (root, ...args) => spawnSync(process.execPath, [bin, 'focus', ...args], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    HOME: root,
    XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: root,
    XDG_STATE_HOME: root,
    H2A_ROOT: join(root, 'store'),
  },
})

const buildDoc = (root, doc) => {
  const input = join(root, 'dossier.json')
  const output = join(root, 'decision.html')
  writeFileSync(input, JSON.stringify(doc))
  return { result: run(root, 'build', input, '-o', output), output, input }
}

const payloadOf = (output) => JSON.parse(
  readFileSync(output, 'utf8').match(/<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/)[1],
)

const textAttr = (value) => ({ kind: 'text', value })

/** Real r7 scene modeled on r7 Schema 1 (Avant / après) in generic@1 with zones, kickers, bodies, icons and footers. */
function r7BeforeAfterScene() {
  const card = (id, { name, kicker, description, footer, icon }) => ({
    id: `entity:${id}`,
    profile: 'generic@1',
    type: 'node',
    attributes: {
      name: textAttr(name),
      ...(kicker ? { kicker: textAttr(kicker) } : {}),
      ...(description ? { description: textAttr(description) } : {}),
      ...(footer ? { footer: textAttr(footer) } : {}),
      ...(icon ? { icon: textAttr(icon) } : {}),
    },
  })
  const zone = (id, { name, kicker }) => ({
    id: `entity:${id}`,
    profile: 'generic@1',
    type: 'container',
    attributes: {
      name: textAttr(name),
      ...(kicker ? { kicker: textAttr(kicker) } : {}),
    },
  })
  const contains = (parent, child) => ({
    id: `relation:contains-${parent}-${child}`,
    profile: 'generic@1',
    type: 'contains',
    endpoints: [
      { role: 'parent', target: `entity:${parent}` },
      { role: 'child', target: `entity:${child}` },
    ],
    attributes: {},
  })
  const link = (id, from, to, label) => ({
    id: `relation:${id}`,
    profile: 'generic@1',
    type: 'link',
    endpoints: [
      { role: 'source', target: `entity:${from}` },
      { role: 'target', target: `entity:${to}` },
    ],
    attributes: { label: textAttr(label) },
  })

  return {
    documentId: 'document:r7-before-after',
    schemaVersion: { major: 1, minor: 1 },
    revision: 0,
    profileRefs: ['generic@1'],
    typeDefinitions: {},
    entities: {
      'entity:zone-avant': zone('zone-avant', { kicker: 'Avant', name: "Aujourd'hui" }),
      'entity:zone-apres': zone('zone-apres', { kicker: 'Après', name: 'Demain' }),
      'entity:avant-outil': card('avant-outil', {
        icon: 'workstation',
        kicker: 'Un outil',
        name: 'Un fil qui grossit',
        description: "Aujourd'hui, le fil d'une session grossit.",
      }),
      'entity:avant-saturation': card('avant-saturation', {
        kicker: 'Saturation',
        name: 'Le fil sature',
        description: "Quand il sature, l'outil le résume seul.",
      }),
      'entity:avant-releve': card('avant-releve', {
        icon: 'window',
        kicker: 'Ensuite',
        name: 'Résumé ou relève',
        description: "Un résumé fait par l'outil, ou une relève.",
      }),
      'entity:avant-engram': card('avant-engram', {
        icon: 'brain',
        kicker: "À l'écart",
        name: 'engram',
        description: 'Aucun outil ne rend le contexte en direct.',
        footer: 'Aucune étape en direct',
      }),
      'entity:apres-outil': card('apres-outil', {
        icon: 'workstation',
        kicker: 'Un outil',
        name: 'Chaque étape',
        description: 'Chaque étape part au graphe.',
      }),
      'entity:apres-graphe': card('apres-graphe', {
        icon: 'graph',
        kicker: 'engram',
        name: 'Le graphe',
        description: "L'état est tenu dans le graphe.",
      }),
      'entity:apres-prompt': card('apres-prompt', {
        icon: 'document',
        kicker: 'Ce que reçoit le modèle',
        name: 'Le prompt',
        description: 'Demande épinglée, état et dernier résultat.',
      }),
    },
    relations: {
      'relation:contains-zone-avant-avant-outil': contains('zone-avant', 'avant-outil'),
      'relation:contains-zone-avant-avant-saturation': contains('zone-avant', 'avant-saturation'),
      'relation:contains-zone-avant-avant-releve': contains('zone-avant', 'avant-releve'),
      'relation:contains-zone-avant-avant-engram': contains('zone-avant', 'avant-engram'),
      'relation:contains-zone-apres-apres-outil': contains('zone-apres', 'apres-outil'),
      'relation:contains-zone-apres-apres-graphe': contains('zone-apres', 'apres-graphe'),
      'relation:contains-zone-apres-apres-prompt': contains('zone-apres', 'apres-prompt'),
      'relation:avant-grossit': link('avant-grossit', 'avant-outil', 'avant-saturation', 'le fil grossit'),
      'relation:avant-sature': link('avant-sature', 'avant-saturation', 'avant-releve', 'quand il sature'),
      'relation:apres-etape': link('apres-etape', 'apres-outil', 'apres-graphe', 'chaque étape'),
      'relation:apres-prompt': link('apres-prompt', 'apres-graphe', 'apres-prompt', "l'état"),
    },
    ports: {},
    resources: {},
    extensions: [],
  }
}

test('default focus build renders a real r7 scene as offline inline SVG with zero overlaps, full bodies and untruncated labels', () => isolated((root) => {
  const doc = fixture()
  const diagramSection = doc.sections.find(s => s.kind === 'diagram')
  const scene = r7BeforeAfterScene()
  diagramSection.scene = scene

  const { result, output } = buildDoc(root, doc)
  assert.equal(result.status, 0, result.stderr)

  const html = readFileSync(output, 'utf8')
  const payload = payloadOf(output)
  assert.ok(payload.diagrams, 'built payload must include r7 rendered diagrams by default without any flag')
  const rendered = payload.diagrams[diagramSection.id]
  assert.ok(rendered, 'diagram section must have an r7 diagram entry')
  assert.equal(rendered.renderer, 'r7')
  assert.ok(rendered.wide && typeof rendered.wide.svg === 'string', 'wide variant inline SVG required')
  assert.ok(rendered.narrow && typeof rendered.narrow.svg === 'string', 'narrow variant inline SVG required')
  assert.deepEqual(rendered.wide.problems, [], `wide r7 geometry lint must report 0 problems: ${JSON.stringify(rendered.wide.problems)}`)
  assert.deepEqual(rendered.narrow.problems, [], `narrow r7 geometry lint must report 0 problems: ${JSON.stringify(rendered.narrow.problems)}`)

  // Wide <-> narrow entity & edge bijection (layout-check invariant).
  assert.deepEqual([...rendered.wide.cards].sort(), [...rendered.narrow.cards].sort(), 'wide and narrow must render identical card sets')
  assert.deepEqual([...rendered.wide.zones].sort(), [...rendered.narrow.zones].sort(), 'wide and narrow must render identical zone sets')
  assert.deepEqual(
    rendered.wide.edges.map(e => `${e.id}:${e.from}>${e.to}`).sort(),
    rendered.narrow.edges.map(e => `${e.id}:${e.from}>${e.to}`).sort(),
    'wide and narrow must render identical relation sets',
  )

  for (const [variantName, variant] of [['wide', rendered.wide], ['narrow', rendered.narrow]]) {
    const svg = variant.svg
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="ds-diagram-svg"/, `${variantName}: inline DS SVG root`)
    assert.match(svg, /data-scene-connectors=""/, `${variantName}: DS connectors present`)
    assert.match(svg, /data-scene-edge="/, `${variantName}: DS edges present`)
    assert.match(svg, /data-scene-label="/, `${variantName}: DS edge labels present`)
    assert.doesNotMatch(svg, /data-toggle="true"/, `${variantName}: static SVG has no inert fold toggles`)

    // Never emit literal generic@1 type names ("node" / "container") as kickers.
    assert.doesNotMatch(svg, /class="st-diagramCard-kicker"[^>]*>node<\/text>/i, `${variantName}: must not leak literal "node" kicker`)
    assert.doesNotMatch(svg, /class="st-diagramZone-kicker"[^>]*>container<\/text>/i, `${variantName}: must not leak literal "container" kicker`)

    // Every node title and every node body word must appear untruncated, with centered bodies.
    for (const [id, entity] of Object.entries(scene.entities)) {
      const name = entity.attributes.name.value
      assert.ok(svg.includes(name), `${variantName}: missing title for ${id}: ${name}`)
      if (entity.type === 'node' && entity.attributes.description) {
        const words = entity.attributes.description.value.split(/\s+/).filter(Boolean)
        for (const word of words) {
          assert.ok(svg.includes(word), `${variantName}: missing body word "${word}" for ${id}`)
        }
        assert.match(svg, /class="st-diagramCard-body"[^>]*text-anchor="middle"/, `${variantName}: card body must be centered`)
      }
      if (entity.attributes.footer) {
        assert.ok(svg.includes(entity.attributes.footer.value), `${variantName}: missing footer for ${id}`)
      }
    }

    // Every edge label must appear inside a pill, untruncated.
    for (const rel of Object.values(scene.relations)) {
      if (rel.type !== 'link') continue
      const label = rel.attributes.label.value
      for (const word of label.split(/\s+/).filter(Boolean)) {
        assert.ok(svg.includes(word), `${variantName}: missing edge pill word "${word}" for ${rel.id}`)
      }
    }

    // Offline & CSP-safe invariants.
    assert.doesNotMatch(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), /https?:\/\//, `${variantName}: no external URLs`)
    assert.ok(!/src=|xlink:href|<script/i.test(svg), `${variantName}: no external assets or scripts in SVG`)
  }

  // Deterministic double build.
  const output2 = join(root, 'decision-2.html')
  const second = run(root, 'build', join(root, 'dossier.json'), '-o', output2)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(output2, 'utf8'), html, 'r7 focus build must be byte-deterministic')
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/)
}))

test('default focus build renders ecosystem:overview with r7 inline SVG and catalog node bodies without mutating scene', () => isolated((root) => {
  const doc = fixture()
  const { result, output } = buildDoc(root, doc)
  assert.equal(result.status, 0, result.stderr)

  const payload = payloadOf(output)
  const diagram = payload.document.sections.find(s => s.kind === 'diagram')
  const rendered = payload.diagrams?.[diagram.id]
  assert.ok(rendered && rendered.renderer === 'r7', 'ecosystem:overview must use r7 renderer by default')
  assert.deepEqual(rendered.wide.problems, [], `ecosystem:overview wide lint: ${JSON.stringify(rendered.wide.problems)}`)
  assert.deepEqual(rendered.narrow.problems, [], `ecosystem:overview narrow lint: ${JSON.stringify(rendered.narrow.problems)}`)

  // Pure generic@1 scene stays untouched (no geometry, no layout hints, no mutated attributes).
  for (const entity of Object.values(diagram.scene.entities)) {
    assert.deepEqual(Object.keys(entity.attributes), ['name'])
  }

  // Catalog bodies and icons are shown in the r7 SVG.
  for (const snippet of [
    'Coordonne les agents',
    'Relie services et identités',
    'Achemine les demandes',
    'Apporte la mémoire',
    'Fournit les composants',
  ]) {
    assert.ok(rendered.wide.svg.includes(snippet), `wide ecosystem:overview must display body "${snippet}"`)
    assert.ok(rendered.narrow.svg.includes(snippet), `narrow ecosystem:overview must display body "${snippet}"`)
  }
  assert.doesNotMatch(rendered.wide.svg, /class="st-diagramCard-kicker"[^>]*>node<\/text>/i)
}))

test('default focus build renders a 7-node Mermaid flowchart LR (ste100 circuit) as process@1 and retains cards with diagramType architecture', () => isolated((root) => {
  const doc = fixture()
  const diagram = doc.sections.find(s => s.kind === 'diagram')
  diagram.source = [
    'flowchart LR',
    'analyse["Faits et réserves"]',
    'auteur["Auteur de la remise"]',
    'controle["Contrôle Node"]',
    'focus["Dossier Focus"]',
    'agent["Agent sans historique"]',
    'owner["Propriétaire"]',
    'conducteur["Conducteur"]',
    'analyse -->|après vérification| auteur',
    'auteur -->|guide de rédaction| controle',
    'controle -->|décision| focus',
    'controle -->|rapport ou étude| owner',
    'focus -->|selon la fréquence choisie| agent',
    'agent -->|réserve conservée| owner',
    'focus -->|si lecture non requise| owner',
    'owner -->|retours sur cinq remises| conducteur',
  ].join('\n')

  const { result, output } = buildDoc(root, doc)
  assert.equal(result.status, 0, result.stderr)

  const payload = payloadOf(output)
  const builtDiagram = payload.document.sections.find(s => s.kind === 'diagram')
  assert.equal(builtDiagram.scene.profileRefs[0], 'process@1')
  const rendered = payload.diagrams?.[diagram.id]
  assert.ok(rendered && rendered.renderer === 'r7')
  assert.deepEqual(rendered.wide.problems, [], `ste100 wide lint: ${JSON.stringify(rendered.wide.problems)}`)
  assert.deepEqual(rendered.narrow.problems, [], `ste100 narrow lint: ${JSON.stringify(rendered.narrow.problems)}`)
  assert.equal(rendered.wide.steps.length, 7)
  assert.equal(rendered.wide.cards.length, 0)
  assert.equal(rendered.wide.edges.length, 8)
  for (const title of ['Faits et réserves', 'Auteur de la remise', 'Contrôle Node', 'Dossier Focus', 'Agent sans historique', 'Propriétaire', 'Conducteur']) {
    assert.ok(rendered.wide.svg.includes(`<title>${title}</title>`), `wide missing step title "${title}"`)
    assert.ok(rendered.narrow.svg.includes(`<title>${title}</title>`), `narrow missing step title "${title}"`)
    assert.ok((rendered.processTable ?? '').includes(title), `processTable missing step "${title}"`)
  }
  for (const labelWord of ['vérification', 'rédaction', 'décision', 'étude', 'fréquence', 'conservée', 'requise', 'remises']) {
    assert.ok((rendered.processTable ?? '').includes(labelWord), `processTable missing edge label word "${labelWord}"`)
  }
  assert.ok(rendered.wide.svg.includes('après vérification') && rendered.wide.svg.includes('retours sur cinq remises'))
  assert.doesNotMatch(rendered.wide.svg, /st-diagramCard-icon|data-toggle="true"/)

  diagram.diagramType = 'architecture'
  const archBuild = buildDoc(root, doc)
  assert.equal(archBuild.result.status, 0, archBuild.result.stderr)
  const archPayload = payloadOf(archBuild.output)
  assert.equal(archPayload.diagrams?.[diagram.id].wide.cards.length, 7)
  for (const labelWord of ['vérification', 'rédaction', 'décision', 'étude', 'fréquence', 'conservée', 'requise', 'remises']) {
    assert.ok(archPayload.diagrams?.[diagram.id].wide.svg.includes(labelWord), `architecture wide missing label word "${labelWord}"`)
  }
  assert.doesNotMatch(archPayload.diagrams?.[diagram.id].wide.svg, /class="st-diagramCard-kicker"[^>]*>node<\/text>/i)
}))

test('default focus build renders nested containers with bidirectional links cleanly in r7 wide and narrow variants', () => isolated((root) => {
  const doc = fixture()
  const semantic = JSON.parse(readFileSync(join(kit, '../../focus/tests/diagram-core-generic.fixture.json'), 'utf8'))
  const diagram = doc.sections.find(s => s.kind === 'diagram')
  diagram.scene = semantic

  const { result, output } = buildDoc(root, doc)
  assert.equal(result.status, 0, result.stderr)

  const payload = payloadOf(output)
  const rendered = payload.diagrams?.[diagram.id]
  assert.ok(rendered && rendered.renderer === 'r7')
  assert.deepEqual(rendered.wide.problems, [], `nested wide lint: ${JSON.stringify(rendered.wide.problems)}`)
  assert.deepEqual(rendered.narrow.problems, [], `nested narrow lint: ${JSON.stringify(rendered.narrow.problems)}`)
  assert.equal(rendered.wide.zones.length, 2)
  assert.equal(rendered.wide.cards.length, 2)
  assert.equal(rendered.wide.edges.length, 2)
  assert.ok(rendered.wide.svg.includes('Demandes'))
  assert.ok(rendered.narrow.svg.includes('Demandes'))
}))
