import {
  shippedSceneBindings,
  shippedSceneRegistry,
  validateSceneDocument,
} from '@sentropic/diagram-canvas/diagramSceneModel';
import {
  DIAGRAM_PRESENTATION_CONTRACT_PIN,
  localIdOf,
  occurrenceRef,
} from '@sentropic/diagram-core';

const genericProfile = {
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

const registry = {
  get: (id) => (id === 'generic@1' ? genericProfile : shippedSceneRegistry.get(id)),
  has: (id) => id === 'generic@1' || shippedSceneRegistry.has(id),
  list: () => ['generic@1', ...shippedSceneRegistry.list().filter((id) => id !== 'generic@1')],
};

const bindings = {
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

/** Bounded, derived presentation only: semantic input is never annotated or upgraded. */
export function diagramAdapter(document) {
  const profile = Array.isArray(document?.profileRefs) && document.profileRefs.length === 1
    ? document.profileRefs[0]
    : undefined;
  if (
    (profile !== 'generic@1' && profile !== 'process@1') ||
    Object.keys(document.entities ?? {}).length > 80 ||
    Object.keys(document.relations ?? {}).length > 240
  ) {
    throw new Error('Unsupported portable Vue diagram: expected bounded generic@1 or process@1 semantics');
  }
  const diagnostics = validateSceneDocument(document, { registry, bindings });
  if (diagnostics.some((item) => item.severity === 'error')) {
    throw new Error('Unsupported portable Vue diagram: expected bounded generic@1 or process@1 semantics');
  }
  if (profile === 'process@1') {
    return {
      registry,
      bindings,
      presentation: {
        contractPin: DIAGRAM_PRESENTATION_CONTRACT_PIN,
        entities: {},
        legends: {},
        categoryTokens: [],
      },
    };
  }
  const parents = new Set(
    Object.values(document.relations)
      .filter((r) => r.type === 'contains')
      .map((r) => r.endpoints.find((e) => e.role === 'parent').target),
  );
  const entities = Object.fromEntries(
    Object.values(document.entities).map((entity) => [
      occurrenceRef(`e.${localIdOf(entity.id)}`),
      {
        form: parents.has(entity.id) ? 'container' : 'card',
        text: { title: entity.attributes.name.value, kicker: entity.type },
      },
    ]),
  );
  return {
    registry,
    bindings,
    presentation: {
      contractPin: DIAGRAM_PRESENTATION_CONTRACT_PIN,
      entities,
      legends: {},
      categoryTokens: [],
    },
  };
}
