import { digest } from './wire.js';
import { isCompatibilityAcceptance } from './evidence.js';

// Only editorial fields at schema-keyword positions are excluded. A property
// CALLED description, enum, default, effects, annotations and unknown extensions
// remain normative. Local refs are content-addressed by the complete schema;
// mutable external refs are refused rather than treated as compatibility.
function schemaContract(value, propertyMap = false) {
  if (Array.isArray(value)) return value.map(v => schemaContract(v));
  if (!value || typeof value !== 'object') return value;
  if (propertyMap) return Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, schemaContract(schema)]));
  if (Object.hasOwn(value, '$ref') && (typeof value.$ref !== 'string' || !value.$ref.startsWith('#'))) throw new Error('mutable_schema_reference');
  return Object.fromEntries(Object.entries(value).filter(([k]) => !['description', 'title', '$comment', 'examples'].includes(k))
    .map(([k, v]) => [k, ['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(k) ? schemaContract(v, true) :
      ['items', 'prefixItems', 'additionalItems', 'contains', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'not', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else'].includes(k) ? schemaContract(v) : structuredClone(v)]));
}
export function toolContract(tool) {
  const { description, ...contract } = tool;
  return { behaviorVersion: '1', ...contract, ...(tool.inputSchema ? { inputSchema: schemaContract(tool.inputSchema) } : {}),
    ...(tool.outputSchema ? { outputSchema: schemaContract(tool.outputSchema) } : {}) };
}
export function describeCatalogue(tools, capabilities = { tools: { listChanged: true } }, protocolVersions = ['2025-06-18', '2024-11-05']) {
  if (!Array.isArray(tools) || tools.some(t => !t || typeof t.name !== 'string' || !t.inputSchema) || new Set(tools.map(t => t.name)).size !== tools.length) throw new Error('catalogue_invalid');
  const toolDigests = Object.fromEntries(tools.map(t => [t.name, { behaviorVersion: t.behaviorVersion ?? '1',
    descriptorDigest: digest(t), contractDigest: digest(toolContract(t)) }]));
  const value = structuredClone({ projectionVersion: 1, normalizationVersion: 1, tools, toolDigests, capabilities, protocolVersions });
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new Error('catalogue_budget');
  return { ...value, descriptorDigest: digest(value), contractDigest: digest({ ...value, tools: tools.map(toolContract),
    toolDigests: Object.fromEntries(Object.entries(toolDigests).map(([name, { descriptorDigest, ...contract }]) => [name, contract])) }) };
}
export function checkCatalogue(value) {
  const actual = describeCatalogue(value.tools, value.capabilities, value.protocolVersions);
  if (actual.descriptorDigest !== value.descriptorDigest || actual.contractDigest !== value.contractDigest ||
      value.projectionVersion !== 1 || value.normalizationVersion !== 1 || digest(value.toolDigests) !== digest(actual.toolDigests)) throw new Error('descriptor_digest_mismatch');
  return actual;
}
export class CatalogueView {
  constructor(descriptor) { this.served = checkCatalogue(descriptor); this.upstream = undefined; this.state = 'CURRENT'; }
  tools() { return structuredClone(this.served.tools); }
  page(cursor) {
    let index = 0;
    if (cursor) {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (parsed.digest !== this.served.descriptorDigest || !Number.isSafeInteger(parsed.index) || parsed.index < 0 || parsed.index > this.served.tools.length) throw new Error('catalogue_cursor_invalid');
      index = parsed.index;
    }
    const tools = []; let bytes = 1024;
    while (index < this.served.tools.length) {
      const tool = this.served.tools[index], size = Buffer.byteLength(JSON.stringify(tool)) + 1;
      if (bytes + size > 900 * 1024) { if (!tools.length) throw new Error('catalogue_tool_frame_budget'); break; }
      tools.push(tool); bytes += size; index++;
    }
    return { tools: structuredClone(tools), ...(index < this.served.tools.length ? {
      nextCursor: Buffer.from(JSON.stringify({ digest: this.served.descriptorDigest, index })).toString('base64url') } : {}) };
  }
  install(descriptor, acceptance) {
    const next = checkCatalogue(descriptor); this.upstream = next;
    const proven = isCompatibilityAcceptance(acceptance) && acceptance.sourceContractDigest === this.served.contractDigest && acceptance.targetDescriptorDigest === next.descriptorDigest;
    if (next.contractDigest !== this.served.contractDigest && !proven) { this.state = 'DEGRADED_CATALOGUE'; return false; }
    this.served = next; this.state = 'CURRENT'; return true;
  }
  canCall(name, protocolVersion = this.served.protocolVersions[0]) {
    const old = this.served.tools.find(t => t.name === name), next = this.upstream?.tools.find(t => t.name === name);
    return Boolean(old && next && this.upstream.protocolVersions.includes(protocolVersion) && digest(toolContract(old)) === digest(toolContract(next)) &&
      digest(this.served.capabilities) === digest(this.upstream.capabilities));
  }
}
