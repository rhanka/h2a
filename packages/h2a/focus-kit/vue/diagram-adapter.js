import { createProfileRegistry, genericProfile, embeddedExecutorBindings, DIAGRAM_PRESENTATION_CONTRACT_PIN,
  occurrenceRef, localIdOf, validateDocument, hasErrors } from '@sentropic/diagram-core';

const registry = createProfileRegistry([genericProfile]);
const bindings = embeddedExecutorBindings([genericProfile]);

/** Bounded, derived presentation only: semantic input is never annotated or upgraded. */
export function diagramAdapter(document) {
  if (JSON.stringify(document.profileRefs) !== '["generic@1"]' || Object.keys(document.entities).length > 80 ||
      Object.keys(document.relations).length > 240 || hasErrors(validateDocument(document, { registry, bindings }))) {
    throw new Error('Unsupported portable Vue diagram: expected bounded generic@1 semantics');
  }
  const parents = new Set(Object.values(document.relations).filter(r => r.type === 'contains')
    .map(r => r.endpoints.find(e => e.role === 'parent').target));
  const entities = Object.fromEntries(Object.values(document.entities).map(entity => [occurrenceRef(`e.${localIdOf(entity.id)}`), {
    form: parents.has(entity.id) ? 'container' : 'card', text: { title: entity.attributes.name.value, kicker: entity.type },
  }]));
  return { registry, bindings,
    presentation: { contractPin: DIAGRAM_PRESENTATION_CONTRACT_PIN, entities, legends: {}, categoryTokens: [] } };
}
