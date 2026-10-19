/** Single source for published JSON Schemas and the structural validator.
 * Only this deliberately small standard-JSON-Schema vocabulary is used. */
type Schema = { type?: string | string[]; const?: unknown; enum?: unknown[]; pattern?: string; minLength?: number; minimum?: number;
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  items?: Schema; uniqueItems?: boolean; minItems?: number; anyOf?: Schema[]; $schema?: string; $id?: string };
const text: Schema = { type: 'string' }, id: Schema = { type: 'string', minLength: 1 };
const nullableText: Schema = { type: ['string', 'null'] }, nullableId: Schema = { anyOf: [id, { type: 'null' }] };
const hash: Schema = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const array = (items: Schema, uniqueItems = false): Schema => ({ type: 'array', items, ...(uniqueItems ? { uniqueItems } : {}) });
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties).filter(k => !optional.includes(k)) });
const address = { nodeId: id, targetRef: id, field: { enum: ['markdown', 'question', 'recommendedAnswer', 'context', 'label', 'body', 'consequence'] } };
const format: Schema = { enum: ['text/plain', 'focus.markdown.p0@1'] };
const anchors = object({ parentId: { type: 'null' }, previousParagraphId: nullableId, nextParagraphId: nullableId });
const field = object({ ...address, contentFormat: format, blockKind: { enum: ['prose', 'question', 'option'] } });
const paragraph = object({ ...address, paragraphId: id, blockKind: { const: 'paragraph' }, parentId: { type: 'null' }, order: { type: 'integer', minimum: 0 },
  range: object({ start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, unit: { const: 'utf16' } }) });
export const manifestSchema: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:sentropic:focus:FocusEditingManifest:1.0.0',
  ...object({ schemaVersion: { const: 1 }, manifestId: id, documentRef: id, baseHash: hash, manifestBaseHash: hash,
    fields: array(field), paragraphs: array(paragraph), retiredParagraphIds: array(id, true) }),
};
const changeProperties = { ...address, documentRef: id, paragraphId: id, changeId: id, blockKind: { const: 'paragraph' }, format,
  operation: { enum: ['replace', 'insert', 'delete', 'move'] }, before: nullableText, after: nullableText,
  anchors, beforeAnchors: { anyOf: [anchors, { type: 'null' }] } };
const change: Schema = { anyOf: ['replace', 'insert', 'delete', 'move'].map(operation => object({ ...changeProperties,
  operation: { const: operation }, before: operation === 'insert' ? { type: 'null' } : text,
  after: operation === 'delete' ? { type: 'null' } : text,
  beforeAnchors: operation === 'insert' ? { type: 'null' } : anchors,
})) };
const { $id: _manifestId, $schema: _manifestDialect, ...embeddedManifest } = manifestSchema;
export const returnSchema: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:sentropic:focus:FocusEditReturn:1.0.0',
  ...object({ kind: { const: 'focus.return' }, schemaVersion: { const: 1 }, returnId: id, digest: hash, capture: object({ at: id }),
    scope: { anyOf: [object({ workspaceId: id }), { type: 'null' }] },
    source: object({ documentRef: id, hash: text, cursor: text, baseHash: hash, manifestId: id, manifestBaseHash: hash }),
    production: { anyOf: [object({ producerId: id, generationId: id, requestId: id }), { type: 'null' }] },
    manifest: embeddedManifest,
    answers: array(object({ questionId: id, targetRef: id, optionIds: array(id, true), text: nullableText })),
    notes: array(object({ targetRef: id, text: nullableText })),
    editReturn: object({ schemaVersion: { const: 1 }, mode: { const: 'cumulative' },
      transactions: array(object({ transactionId: id, changes: { ...array(change), minItems: 1 } })),
      supersedesReturnId: id, supersededReturnIds: array(id, true) }, ['supersedesReturnId']),
  }),
};
export function matchesSchema(schema: Schema, value: unknown): boolean {
  if (schema.anyOf && !schema.anyOf.some(s => matchesSchema(s, value))) return false;
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => t === type || (t === 'integer' && Number.isInteger(value)))) return false;
  if (typeof value === 'string' && ((schema.minLength !== undefined && [...value].length < schema.minLength) || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)))) return false;
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) return false;
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) return false;
    if (schema.items && !value.every(v => matchesSchema(schema.items!, v))) return false;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const v = value as Record<string, unknown>;
    if (schema.required?.some(k => !Object.hasOwn(v, k))) return false;
    if (Object.keys(v).some(k => Object.hasOwn(schema.properties!, k) ? !matchesSchema(schema.properties![k], v[k]) : schema.additionalProperties === false)) return false;
  }
  return true;
}
