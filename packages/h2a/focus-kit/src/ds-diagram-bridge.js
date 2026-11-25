/**
 * Focus dossier Design System diagram bridge (zero DOM, pure ESM).
 *
 * Bridges Focus diagram sections (`workflow` / `process@1` and `architecture` / `generic@1`)
 * cleanly over `@sentropic/diagram-canvas@0.6.0` + `@sentropic/diagram-core@0.6.1`, aligning
 * with the published `@sentropic/design-system-elements@0.4.0` focus-diagrams contract
 * (`FOCUS_PROCESS_TARGET_WIDTH = 640`, `relation:<from>.<to>`, `sentropic:process-flow`,
 * `foldableGenericProfile`, `renderSceneSvg`, `renderProcessTable`).
 */
import {
  shippedSceneBindings,
  shippedSceneRegistry,
  validateSceneDocument,
} from '@sentropic/diagram-canvas/diagramSceneModel';
import {
  cardLineMeasurer,
  defaultCardMeasure,
  layoutCard,
  layoutZone,
  sceneCardMeasure,
} from '@sentropic/diagram-canvas/diagramCardModel';
import {
  projectCardProps,
  projectZoneProps,
  renderProcessTable,
  renderSceneSvg,
} from '@sentropic/diagram-canvas/diagram-render';
import { DIAGRAM_GLYPHS } from '@sentropic/diagram-canvas/diagram-icons';
import ecosystemCatalog from '../ecosystem.json' with { type: 'json' };

/** Pinned column width for Focus `process@1` diagrams (72ch column, scale >= 0.9 under process-fit). */
export const FOCUS_PROCESS_TARGET_WIDTH = 640;
export const FOCUS_PHONE_TARGET_WIDTH = 340;

const PROCESS_FLOW_EXTENSION_NAMESPACE = 'sentropic:process-flow';
const ALLOWED_FOCUS_PROFILES = new Set(['generic@1', 'process@1']);
const FOCUS_OPTIONAL_TEXT_ATTRS = new Set(['description', 'kicker', 'footer', 'icon']);
const PRESENTATION_CONTRACT_PIN = {
  id: 'diagram-presentation',
  version: '1',
  contentDigest: '74dadb9c31fff7653ca31692d8db3cfea782baea8d9268a3c20982ea8ab0aeae',
};

const LAYOUT_FAILURES = new Set([
  'label-unplaced',
  'label-budget-exhausted',
  'route-obstructed',
  'route-spacing-conflict',
  'channel-unresolved',
  'channel-capacity-exceeded',
  'docking-overflow',
]);

const ECOSYSTEM_ICONS = {
  'entity:h2a': 'robot',
  'entity:cluster-mesh': 'cluster',
  'entity:llm-gateway': 'api',
  'entity:llm-mesh': 'llm',
  'entity:track': 'check',
  'entity:engram': 'brain',
  'entity:design-system': 'window',
  'entity:sentropic-apps': 'web',
  'entity:codex': 'workstation',
  'entity:claude': 'workstation',
  'entity:vibe': 'workstation',
  'entity:sentropic-cli': 'workstation',
};

// Foldable generic@1 profile (container: true) kept compatible with focus-views/1 snapshots.
export const foldableGenericProfile = {
  id: 'generic@1',
  name: 'generic',
  version: 1,
  completeness: 'complete',
  entityTypes: [
    {
      id: 'node',
      label: 'Node',
      attributes: [
        { name: 'name', kind: 'text', required: true, maxLength: 200 },
        { name: 'state', kind: 'enum', values: ['draft', 'active', 'retired'] },
        { name: 'weight', kind: 'quantity', units: ['unit'] },
        { name: 'duration', kind: 'quantity', units: ['s', 'min', 'h'] },
        { name: 'createdAt', kind: 'date' },
        { name: 'pinned', kind: 'boolean' },
        { name: 'tags', kind: 'collection', item: { kind: 'text', maxLength: 40 }, maxItems: 8 },
        { name: 'owner', kind: 'reference', refKind: 'entity' },
      ],
    },
    {
      id: 'container',
      label: 'Container',
      container: true,
      attributes: [
        { name: 'name', kind: 'text', required: true, maxLength: 200 },
        { name: 'collapsed', kind: 'boolean' },
      ],
    },
  ],
  portTypes: [
    {
      id: 'port',
      label: 'Port',
      directions: ['in', 'out', 'inout'],
      attributes: [{ name: 'label', kind: 'text', maxLength: 80 }],
    },
  ],
  relationTypes: [
    {
      id: 'link',
      label: 'Link',
      direction: 'directed',
      roles: [
        { role: 'source', cardinality: { min: 1, max: 1 }, targets: ['entity', 'port'] },
        { role: 'target', cardinality: { min: 1, max: 1 }, targets: ['entity', 'port'] },
      ],
      attributes: [
        { name: 'label', kind: 'text', maxLength: 120 },
        { name: 'weight', kind: 'quantity', units: ['unit'] },
      ],
    },
    {
      id: 'contains',
      label: 'Contains',
      direction: 'directed',
      roles: [
        { role: 'parent', cardinality: { min: 1, max: 1 }, targets: ['entity'], entityTypes: ['container'] },
        { role: 'child', cardinality: { min: 1, max: 1 }, targets: ['entity'] },
      ],
      hierarchy: { id: 'containment', shape: 'tree', parentRole: 'parent', childRole: 'child' },
    },
    {
      id: 'association',
      label: 'Association',
      direction: 'undirected',
      roles: [{ role: 'member', cardinality: { min: 2, max: 8 }, targets: ['entity'] }],
      attributes: [{ name: 'label', kind: 'text', maxLength: 120 }],
    },
  ],
  constraints: [
    { kind: 'acyclic-hierarchy', hierarchyId: 'containment' },
    { kind: 'unique-attribute', entityType: 'container', attribute: 'name' },
    { kind: 'max-entities-of-type', entityType: 'container', max: 64 },
  ],
  limits: { maxEntities: 100_000, maxRelations: 500_000, maxEndpointsPerRelation: 8 },
  notes: ['Foldable generic@1 profile for Focus dossier diagrams.'],
};

export const focusSceneRegistry = {
  get: (id) => (id === 'generic@1' ? foldableGenericProfile : shippedSceneRegistry.get(id)),
  has: (id) => id === 'generic@1' || shippedSceneRegistry.has(id),
  list: () => ['generic@1', ...shippedSceneRegistry.list().filter((id) => id !== 'generic@1')],
};

export const focusSceneBindings = {
  schemaVersion: '1',
  rows: [
    {
      profileId: 'generic@1',
      profilePin: {
        id: 'generic@1',
        version: 1,
        contentDigest: 'a003981971bdf75b50f455f19d701130c81fd896aeb7f4b0f0f9fe49dd874b8a',
      },
      declarationAdapter: 'legacy-constraints@1',
    },
    ...shippedSceneBindings.rows,
  ],
};

const measure = sceneCardMeasure(defaultCardMeasure);
const measureLines = cardLineMeasurer(measure);
const processMeasureLines = (request) => {
  const layout = measureLines(request);
  if (request.role !== 'edge-label' || layout.width === 0) return layout;
  return { ...layout, width: layout.width + 8, height: layout.height + 6 };
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const closed = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
const localIdOf = (ref) => ref.slice(ref.indexOf(':') + 1);
const occurrenceRef = (id) => `occurrence:${id}`;
const textAttr = (entityOrRel, key) => {
  const attr = entityOrRel?.attributes?.[key];
  return attr?.kind === 'text' && typeof attr.value === 'string' && attr.value.trim() ? attr.value.trim() : undefined;
};

function isClosedScalarValue(value) {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'text':
    case 'date':
    case 'enum':
    case 'reference':
      return closed(value, ['kind', 'value']) && typeof value.value === 'string';
    case 'boolean':
      return closed(value, ['kind', 'value']) && typeof value.value === 'boolean';
    case 'quantity':
      return closed(value, ['kind', 'value', 'unit']) && typeof value.value === 'number' && typeof value.unit === 'string';
    default:
      return false;
  }
}

function isClosedAttributeValue(value) {
  if (isClosedScalarValue(value)) return true;
  return (
    closed(value, ['kind', 'items']) &&
    value.kind === 'collection' &&
    Array.isArray(value.items) &&
    value.items.every(isClosedScalarValue)
  );
}

function isClosedAttributes(value) {
  return isRecord(value) && Object.values(value).every(isClosedAttributeValue);
}

function fnv1a64(content) {
  const bytes = new TextEncoder().encode(content);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x00000100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function createProcessDirectionExtension(direction) {
  const source = JSON.stringify({ direction });
  return {
    namespace: PROCESS_FLOW_EXTENSION_NAMESPACE,
    schemaVersion: '1',
    scope: { kind: 'document' },
    validation: 'validated',
    contentHash: fnv1a64(source),
    source,
  };
}

/**
 * Return a copy of `generic@1` with Focus card presentation attributes (`description`,
 * `kicker`, `footer`, `icon`) stripped for strict `validateSceneDocument` / `renderSceneSvg`
 * while rejecting malformed or non-text values on those attributes first.
 */
function prepareGenericSceneForEngine(scene, refuse) {
  const profileId = scene.profileRefs?.[0];
  if (profileId !== 'generic@1') return scene;
  const cleanEntities = {};
  for (const [id, entity] of Object.entries(scene.entities)) {
    const cleanAttrs = {};
    for (const [k, v] of Object.entries(entity.attributes)) {
      if (FOCUS_OPTIONAL_TEXT_ATTRS.has(k)) {
        if (!closed(v, ['kind', 'value']) || v.kind !== 'text' || typeof v.value !== 'string') {
          refuse(`Invalid optional text attribute "${k}" on "${id}"`);
        }
        continue;
      }
      cleanAttrs[k] = v;
    }
    cleanEntities[id] = { ...entity, attributes: cleanAttrs };
  }
  return { ...scene, entities: cleanEntities };
}

/** Validate a Focus semantic diagram scene using the DS registry and closed envelope bounds. */
export function validateCheckedFocusScene(scene, errorPrefix = '') {
  const refuse = (reason) => {
    const msg = reason ?? 'Unsupported diagram-core document: expected generic@1 or process@1 without views, geometry or layout hints';
    throw new Error(errorPrefix ? `${errorPrefix}${msg}` : msg);
  };
  if (!isRecord(scene)) refuse('Expected a semantic scene object');
  const {
    documentId,
    schemaVersion,
    revision,
    profileRefs,
    typeDefinitions,
    entities,
    relations,
    ports,
    resources,
    extensions,
  } = scene;
  if (
    !closed(scene, [
      'documentId',
      'schemaVersion',
      'revision',
      'profileRefs',
      'typeDefinitions',
      'entities',
      'relations',
      'ports',
      'resources',
      'extensions',
    ]) ||
    typeof documentId !== 'string' ||
    !documentId.startsWith('document:') ||
    !closed(schemaVersion, ['major', 'minor']) ||
    schemaVersion.major !== 1 ||
    schemaVersion.minor !== 1 ||
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 0 ||
    !Array.isArray(profileRefs) ||
    profileRefs.length !== 1 ||
    typeof profileRefs[0] !== 'string' ||
    !ALLOWED_FOCUS_PROFILES.has(profileRefs[0]) ||
    !closed(typeDefinitions, []) ||
    !closed(ports, []) ||
    !closed(resources, []) ||
    !Array.isArray(extensions)
  ) {
    refuse();
  }
  const profileId = profileRefs[0];
  if (profileId === 'generic@1' && extensions.length !== 0) refuse();
  if (profileId === 'process@1') {
    if (extensions.length > 1) refuse('Unsupported extension on process@1 scene');
    for (const ext of extensions) {
      if (
        !closed(ext, ['namespace', 'schemaVersion', 'scope', 'validation', 'contentHash', 'source']) ||
        ext.namespace !== PROCESS_FLOW_EXTENSION_NAMESPACE ||
        typeof ext.schemaVersion !== 'string' ||
        !closed(ext.scope, ['kind']) ||
        ext.scope.kind !== 'document' ||
        typeof ext.validation !== 'string' ||
        typeof ext.contentHash !== 'string' ||
        (ext.source !== undefined && typeof ext.source !== 'string')
      ) {
        refuse('Unsupported extension on process@1 scene');
      }
    }
  }
  if (!isRecord(entities) || !isRecord(relations)) refuse();
  const nodes = Object.entries(entities);
  const edges = Object.entries(relations);
  if (nodes.length === 0 || nodes.length > 80 || edges.length > 240) refuse();
  for (const [id, entity] of nodes) {
    if (
      !id.startsWith('entity:') ||
      !closed(entity, ['id', 'profile', 'type', 'attributes']) ||
      typeof entity.id !== 'string' ||
      typeof entity.profile !== 'string' ||
      typeof entity.type !== 'string' ||
      !isClosedAttributes(entity.attributes)
    ) {
      refuse();
    }
  }
  for (const [id, relation] of edges) {
    if (
      !id.startsWith('relation:') ||
      !closed(relation, ['id', 'profile', 'type', 'endpoints', 'attributes']) ||
      typeof relation.id !== 'string' ||
      typeof relation.profile !== 'string' ||
      typeof relation.type !== 'string' ||
      !Array.isArray(relation.endpoints) ||
      !relation.endpoints.every(
        (ep) => closed(ep, ['role', 'target']) && typeof ep.role === 'string' && typeof ep.target === 'string',
      ) ||
      !isClosedAttributes(relation.attributes)
    ) {
      refuse();
    }
  }
  const engineDoc = prepareGenericSceneForEngine(scene, refuse);
  const diagnostics = validateSceneDocument(engineDoc, {
    registry: focusSceneRegistry,
    bindings: focusSceneBindings,
  });
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (errors.length > 0) {
    refuse(`Unsupported diagram-core document: ${errors.map((d) => d.message).join('; ')}`);
  }
  return engineDoc;
}

/** Parse bounded Mermaid `flowchart LR|TB|TD` into `process@1` (default) or `generic@1` (opt-out). */
export function parseFlowchartToScene(source, id, profile = 'process@1') {
  const lines = String(source ?? '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
  const header = /^flowchart (LR|TB|TD)$/.exec(lines.shift() ?? '');
  if (header === null) {
    throw new Error('Unsupported diagram: use ecosystem:<scene> or the documented Mermaid flowchart profile');
  }
  const direction = header[1];
  const isProcess = profile === 'process@1';
  const entities = {};
  const relations = {};
  const pairCounts = new Map();
  let edgeCount = 0;

  for (const line of lines) {
    const node = /^([a-z][a-z0-9_-]*)\["([^"<>\n]+)"\]$/.exec(line);
    const edge = /^([a-z][a-z0-9_-]*) -->\|([^|<>\n]+)\| ([a-z][a-z0-9_-]*)$/.exec(line);
    if (node !== null) {
      const entityId = `entity:${node[1]}`;
      if (Object.hasOwn(entities, entityId)) {
        throw new Error(`Duplicate diagram node: ${node[1]}`);
      }
      entities[entityId] = {
        id: entityId,
        profile,
        type: isProcess ? 'step' : 'node',
        attributes: { name: { kind: 'text', value: node[2] } },
      };
    } else if (edge !== null) {
      edgeCount += 1;
      const pairKey = `${edge[1]}.${edge[3]}`;
      const ordinal = (pairCounts.get(pairKey) ?? 0) + 1;
      pairCounts.set(pairKey, ordinal);
      const relationId = ordinal === 1 ? `relation:${pairKey}` : `relation:${pairKey}.${ordinal}`;
      relations[relationId] = {
        id: relationId,
        profile,
        type: isProcess ? 'transition' : 'link',
        endpoints: [
          { role: 'source', target: `entity:${edge[1]}` },
          { role: 'target', target: `entity:${edge[3]}` },
        ],
        attributes: { label: { kind: 'text', value: edge[2] } },
      };
    } else {
      throw new Error(`Unsupported flowchart line: ${line}`);
    }
  }
  const entityCount = Object.keys(entities).length;
  if (entityCount === 0 || entityCount > 80 || edgeCount > 160) {
    throw new Error('Diagram needs 1–80 nodes and at most 160 edges');
  }
  const scene = {
    documentId: `document:${id}`,
    schemaVersion: { major: 1, minor: 1 },
    revision: 0,
    profileRefs: [profile],
    typeDefinitions: {},
    entities,
    relations,
    ports: {},
    resources: {},
    extensions:
      isProcess && (direction === 'TB' || direction === 'TD')
        ? [createProcessDirectionExtension('TB')]
        : [],
  };
  validateCheckedFocusScene(scene);
  return { scene, direction };
}

/** Generate a readable Mermaid flowchart fallback from a validated generic@1 or process@1 scene. */
export function sceneToMermaidFallback(scene) {
  let direction = 'LR';
  if (Array.isArray(scene.extensions)) {
    const ext = scene.extensions.find((item) => item?.namespace === PROCESS_FLOW_EXTENSION_NAMESPACE);
    if (ext && typeof ext.source === 'string') {
      try {
        const parsed = JSON.parse(ext.source);
        if (parsed?.direction === 'TB' || parsed?.direction === 'TD') direction = parsed.direction;
      } catch {
        /* Keep default LR direction. */
      }
    }
  }
  const entries = Object.entries(scene.entities);
  const ids = new Map(entries.map(([id], index) => [id, `node${index}`]));
  const lines = [`flowchart ${direction}`];
  for (const [id, entity] of entries) {
    lines.push(`${ids.get(id)}[${JSON.stringify(textAttr(entity, 'name') ?? id)}]`);
  }
  for (const relation of Object.values(scene.relations)) {
    if (relation.type !== 'link' && relation.type !== 'transition') continue;
    const from = relation.endpoints?.find((e) => e.role === 'source')?.target;
    const to = relation.endpoints?.find((e) => e.role === 'target')?.target;
    if (!ids.has(from) || !ids.has(to)) continue;
    const label = textAttr(relation, 'label');
    lines.push(`${ids.get(from)} -->|${label ? label.replace(/\|/g, '&#124;') : ' '}| ${ids.get(to)}`);
  }
  return lines.join('\n');
}

/** Resolve and validate a Focus dossier diagram section under DESIGN-r3 §2.1 C Lot 1 rules. */
export function resolveDossierDiagramScene(section, options = {}) {
  const catalog = options.ecosystemCatalog ?? ecosystemCatalog;
  if (section.sourceRef !== undefined) {
    throw new Error(
      `Reference diagram "${section.id}" (${section.renderComponent} -> ${section.sourceRef}) requires a host diagramResolver; offline portable bundles support inline diagrams only`,
    );
  }
  const diagramType = section.diagramType;
  if (diagramType !== undefined && diagramType !== 'workflow' && diagramType !== 'architecture') {
    throw new Error(
      `Diagram "${section.id}": diagramType "${diagramType}" is not supported by the offline Focus builder in Lot 1 (supported: "workflow", "architecture")`,
    );
  }

  const catalogByDocId = new Map(
    Object.values(catalog.scenes).map((entry) => [
      entry.document.documentId,
      { title: entry.title, description: entry.description },
    ]),
  );

  // Explicit semantic scene takes precedence when supplied.
  if (section.scene !== undefined) {
    validateCheckedFocusScene(section.scene);
    const profile = section.scene.profileRefs[0];
    if (diagramType === 'architecture' && profile !== 'generic@1') {
      throw new Error(`Diagram "${section.id}": diagramType "architecture" requires a generic@1 scene in Lot 1 (received ${profile})`);
    }
    if (diagramType === 'workflow' && profile !== 'process@1') {
      throw new Error(`Diagram "${section.id}": diagramType "workflow" requires a process@1 scene (received ${profile})`);
    }
    const matched =
      profile === 'generic@1' && typeof section.scene.documentId === 'string'
        ? catalogByDocId.get(section.scene.documentId)
        : undefined;
    const enrichment = matched ? { ...matched, ecosystemIcons: true } : undefined;
    return {
      scene: section.scene,
      source: sceneToMermaidFallback(section.scene),
      renderedAsArchitecture: profile === 'generic@1',
      direction: 'LR',
      ...(enrichment ? { enrichment } : {}),
    };
  }

  if (section.syntax !== 'mermaid') {
    throw new Error('Unsupported diagram syntax: use mermaid flowcharts or ecosystem references');
  }

  if (section.source.startsWith('ecosystem:')) {
    if (diagramType === 'workflow') {
      throw new Error(`Diagram "${section.id}": ecosystem references represent architecture components and cannot use diagramType "workflow"`);
    }
    const name = section.source.slice('ecosystem:'.length);
    if (!Object.hasOwn(catalog.scenes, name)) {
      throw new Error(`Unknown ecosystem scene: ${name}`);
    }
    const entry = catalog.scenes[name];
    validateCheckedFocusScene(entry.document);
    const enrichment = { title: entry.title, description: entry.description, ecosystemIcons: true };
    const fallback =
      sceneToMermaidFallback(entry.document) +
      '\n' +
      entry.description
        .split('\n')
        .map((line) => `%% ${line}`)
        .join('\n');
    return {
      scene: entry.document,
      source: fallback,
      renderedAsArchitecture: true,
      direction: 'LR',
      enrichment,
    };
  }

  // Raw Mermaid flowchart: default to workflow (process@1) unless diagramType === "architecture" opts out.
  const targetProfile = diagramType === 'architecture' ? 'generic@1' : 'process@1';
  const { scene, direction } = parseFlowchartToScene(section.source, section.id, targetProfile);
  return {
    scene,
    source: section.source,
    renderedAsArchitecture: targetProfile === 'generic@1',
    direction,
  };
}

/** Deterministic §2.1 B cycle-free predicate warning when an architecture scene is a linear chain of >= 3 steps. */
export function findLinearChainArchitectureWarning(sectionId, scene) {
  if (!isRecord(scene) || !isRecord(scene.entities) || !isRecord(scene.relations)) {
    return undefined;
  }
  const entities = Object.values(scene.entities);
  const relations = Object.values(scene.relations);
  if (entities.some((e) => e?.type === 'container') || relations.some((r) => r?.type === 'contains')) {
    return undefined;
  }
  const n = entities.length;
  const links = relations.filter((r) => r?.type === 'link');
  if (n < 3 || links.length !== n - 1 || links.length !== relations.length) {
    return undefined;
  }
  const nodeIds = new Set(entities.map((e) => e.id));
  const inDegree = new Map([...nodeIds].map((id) => [id, 0]));
  const nextOf = new Map();
  for (const link of links) {
    const src = link.endpoints?.find((ep) => ep.role === 'source')?.target;
    const dst = link.endpoints?.find((ep) => ep.role === 'target')?.target;
    if (!nodeIds.has(src) || !nodeIds.has(dst) || src === dst || nextOf.has(src)) {
      return undefined;
    }
    nextOf.set(src, dst);
    inDegree.set(dst, (inDegree.get(dst) ?? 0) + 1);
  }
  let startId;
  let endCount = 0;
  for (const id of nodeIds) {
    const ind = inDegree.get(id) ?? 0;
    const outd = nextOf.has(id) ? 1 : 0;
    if (ind === 0 && outd === 1) {
      if (startId !== undefined) return undefined;
      startId = id;
    } else if (ind === 1 && outd === 0) {
      endCount += 1;
    } else if (!(ind === 1 && outd === 1)) {
      return undefined;
    }
  }
  if (startId === undefined || endCount !== 1) return undefined;
  const visited = new Set();
  for (let current = startId; current !== undefined; current = nextOf.get(current)) {
    if (visited.has(current)) return undefined;
    visited.add(current);
  }
  if (visited.size !== n) return undefined;
  return `linear_chain_as_architecture_cards: ${sectionId} (${n} nodes, 0 containers) — set diagramType "workflow" if this describes a process`;
}

function parseCatalogRoles(description) {
  const roles = new Map();
  if (!description) return roles;
  for (const line of String(description).split(/\r?\n/)) {
    const idx = line.indexOf(' : ');
    if (idx > 0) roles.set(line.slice(0, idx).trim(), line.slice(idx + 3).trim());
  }
  return roles;
}

function buildPresentation(scene, enrichment) {
  const isProcess = scene.profileRefs.length === 1 && scene.profileRefs[0] === 'process@1';
  if (isProcess) {
    return { contractPin: PRESENTATION_CONTRACT_PIN, entities: {}, legends: {}, categoryTokens: [] };
  }
  const hasChildren = new Set();
  for (const rel of Object.values(scene.relations ?? {})) {
    if (rel.type === 'contains') {
      const parent = rel.endpoints?.find((ep) => ep.role === 'parent')?.target;
      if (parent) hasChildren.add(parent);
    }
  }
  const catalogRoles = parseCatalogRoles(enrichment?.description);
  const useEcosystemIcons = Boolean(enrichment?.ecosystemIcons);
  const entities = {};
  for (const entity of Object.values(scene.entities ?? {})) {
    const isZone = entity.type === 'container' && hasChildren.has(entity.id);
    const title = textAttr(entity, 'name') ?? entity.id;
    const kicker = textAttr(entity, 'kicker');
    const explicitBody = textAttr(entity, 'description');
    const catalogBody = !isZone && !explicitBody ? catalogRoles.get(title) : undefined;
    const body = explicitBody ?? catalogBody;
    const footer = textAttr(entity, 'footer');
    const explicitIcon = textAttr(entity, 'icon');
    const ecoIcon = useEcosystemIcons ? ECOSYSTEM_ICONS[entity.id] : undefined;
    const icon = explicitIcon ?? ecoIcon;
    entities[occurrenceRef(`e.${localIdOf(entity.id)}`)] = {
      form: isZone ? 'container' : 'card',
      text: {
        title,
        ...(kicker ? { kicker } : {}),
        ...(body ? (isZone ? { subtitle: body } : { body }) : {}),
        ...(footer ? { footer } : {}),
      },
      ...(icon ? { icon } : {}),
    };
  }
  return { contractPin: PRESENTATION_CONTRACT_PIN, entities, legends: {}, categoryTokens: [] };
}

function decorateStaticSvg(svg, variantName) {
  // Static inline SVGs carry no interactive fold click handlers: strip inert toggle glyphs.
  const withoutToggles = svg.replace(/<g class="st-diagramCard-toggle"[\s\S]*?<\/g>/g, '');
  const prefix = '<svg xmlns="http://www.w3.org/2000/svg"';
  const attrs = ` class="ds-diagram-svg" data-variant="${variantName}"`;
  if (withoutToggles.startsWith(prefix)) {
    return `${prefix}${attrs}${withoutToggles.slice(prefix.length)}`;
  }
  return withoutToggles.replace('<svg ', `<svg${attrs} `);
}

function renderVariant(engineDoc, scene, presentation, targetWidth, variantName, title) {
  const isProcess = engineDoc.profileRefs[0] === 'process@1';
  const containers = isProcess
    ? []
    : Object.entries(presentation.entities)
        .filter(([, ent]) => ent.form === 'container')
        .map(([occId]) => occId);
  const input = {
    document: engineDoc,
    registry: focusSceneRegistry,
    bindings: focusSceneBindings,
    presentation,
    measureLines: isProcess ? processMeasureLines : measureLines,
    containers,
    targetWidth,
    collapsed: [],
  };

  let drawing;
  try {
    drawing = renderSceneSvg(input, isProcess ? { title } : { title, measure });
  } catch (error) {
    const result = layoutScene(input);
    if (result.status !== 'laid-out') {
      const diagnostics = [...(result.refusals ?? []), ...(result.diagnostics ?? [])].map((d) => ({
        code: d.code ?? 'scene-refused',
        slot: d.slot ?? 'scene',
        entityId: d.entityId ?? d.path ?? engineDoc.documentId,
        neededPx: d.neededPx ?? 1,
        allocatedPx: d.allocatedPx ?? 0,
        ...(d.text ? { text: d.text } : d.message ? { text: d.message } : {}),
      }));
      return { kind: 'refused', diagnostics };
    }
    throw error;
  }

  const cardDiagnostics = drawing.scene.nodes.flatMap((node) => {
    if (node.kind === 'process' || node.kind === 'erd') return [];
    const opts = { entityId: node.entity, resolveGlyph: (name) => DIAGRAM_GLYPHS[name] };
    const projected =
      node.kind === 'zone'
        ? projectZoneProps(node.presentation, {
            ...opts,
            collapsed: node.collapsed,
            width: node.rect.width,
            height: node.rect.height,
          })
        : projectCardProps(node.presentation, opts);
    if (projected.kind === 'label') return [];
    const layoutResult =
      projected.kind === 'zone'
        ? layoutZone({ ...projected.props, autoSize: true }, measure)
        : layoutCard({ ...projected.props, height: node.rect.height, autoSize: true }, measure);
    return layoutResult.diagnostics.filter(
      (item) => (item.code === 'card-overflow' || item.code === 'zone-overflow') && item.reason !== 'fallback-v1',
    );
  });

  const warningDiagnostics = (drawing.result.warnings ?? [])
    .filter(({ code }) => LAYOUT_FAILURES.has(code) || code.endsWith('-overflow'))
    .map((w) => ({
      code: w.code,
      slot: w.slot ?? 'scene',
      entityId: w.entityId ?? engineDoc.documentId,
      neededPx: w.neededPx ?? 1,
      allocatedPx: w.allocatedPx ?? 0,
      ...(w.text ? { text: w.text } : w.message ? { text: w.message } : {}),
    }));

  const blocking = [...cardDiagnostics, ...warningDiagnostics];
  if (blocking.length > 0) {
    return { kind: 'refused', diagnostics: blocking };
  }

  const widthMatch = /width="([^"]+)"/.exec(drawing.svg);
  const scaleMatch = /data-display-scale="([^"]+)"/.exec(drawing.svg);
  const boundsW = drawing.scene.bounds?.width ?? Number(widthMatch?.[1] ?? 0);
  const boundsH = drawing.scene.bounds?.height ?? 0;
  const displayWidth = Math.ceil(Number(widthMatch?.[1] ?? boundsW));
  const displayScale = Number(scaleMatch?.[1] ?? 1);

  const cards = drawing.scene.nodes
    .filter((node) => node.kind === 'card')
    .map((node) => node.entity);
  const zones = drawing.scene.nodes
    .filter((node) => node.kind === 'zone')
    .map((node) => node.entity);
  const steps = drawing.scene.nodes
    .filter((node) => node.kind === 'process')
    .map((node) => node.entity);
  const edges = (drawing.scene.edges ?? []).map((edge) => ({
    id: edge.occurrence,
    from: edge.from,
    to: edge.to,
    style: edge.strokeStyle ?? 'solid',
    label: edge.label ?? '',
  }));

  return {
    kind: 'rendered',
    variant: {
      svg: decorateStaticSvg(drawing.svg, variantName),
      width: Math.ceil(boundsW),
      height: Math.ceil(boundsH),
      displayWidth,
      displayScale,
      orientation: drawing.scene.r7Connectors ? drawing.scene.orientation ?? 'LR' : undefined,
      problems: [],
      cards,
      zones,
      steps,
      panels: [],
      edges,
    },
  };
}

/** Render a validated Focus generic@1 or process@1 scene into offline DS inline SVG variants. */
export function renderDossierDiagram(scene, options = {}) {
  let engineDoc;
  try {
    engineDoc = validateCheckedFocusScene(scene);
  } catch (error) {
    return {
      kind: 'refused',
      diagnostics: [
        {
          code: 'diagram-source-unsupported',
          slot: 'scene',
          entityId: scene?.documentId ?? 'diagram',
          neededPx: 1,
          allocatedPx: 0,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const isProcess = engineDoc.profileRefs[0] === 'process@1';
  const presentation = buildPresentation(scene, options.enrichment);
  const title = options.title ?? options.alt ?? engineDoc.documentId;

  const wide = renderVariant(engineDoc, scene, presentation, 1440, 'wide', title);
  if (wide.kind !== 'rendered') return wide;

  const narrow = renderVariant(engineDoc, scene, presentation, FOCUS_PROCESS_TARGET_WIDTH, 'narrow', title);
  if (narrow.kind !== 'rendered') return narrow;

  let phoneVariant;
  if (isProcess && narrow.variant.displayWidth > FOCUS_PHONE_TARGET_WIDTH) {
    const phone = renderVariant(engineDoc, scene, presentation, FOCUS_PHONE_TARGET_WIDTH, 'phone', title);
    if (phone.kind !== 'rendered') return phone;
    if (phone.variant.displayWidth < narrow.variant.displayWidth) {
      phoneVariant = phone.variant;
    }
  }

  return {
    kind: 'rendered',
    renderer: 'r7',
    profile: engineDoc.profileRefs[0],
    wide: wide.variant,
    narrow: narrow.variant,
    ...(phoneVariant ? { phone: phoneVariant } : {}),
    ...(isProcess ? { processTable: renderProcessTable(engineDoc) } : {}),
  };
}

export { renderProcessTable };
