import { isAbsolute, posix } from 'node:path';
import { canonicalBytes } from './wire.js';
export { schemas } from './schemas.js';
import { schemas } from './schemas.js';

export function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
    !value.includes('\0') && !isAbsolute(value) && value.split('/').every(p => p && p !== '.' && p !== '..');
}
export function numericEndpoint(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      !u.port || u.username || u.password || u.search || u.hash || u.href !== value) {
    throw new Error('invalid_endpoint');
  }
  return value;
}
function check(schema, value, path) {
  const fail = () => { throw new Error(`invalid_format:${path}`); };
  if ('const' in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.anyOf && !schema.anyOf.some(s => { try { check(s, value, path); return true; } catch { return false; } })) fail();
  if (schema.type === 'null' && value !== null) fail();
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail();
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) ||
        (schema.pattern && !new RegExp(schema.pattern).test(value))) fail();
    if (schema.format === 'relative-path' && !safeRelative(value)) fail();
    if (schema.format === 'absolute-path' && (!value.startsWith('/') || value.includes('\0') ||
        value.includes('\\') || posix.normalize(value) !== value)) fail();
    if (schema.format === 'endpoint') numericEndpoint(value);
  }
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) ||
      value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER))) fail();
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail();
    value.forEach((v, i) => check(schema.items, v, `${path}/${i}`));
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail();
    for (const key of Object.keys(value)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
      if (!child && schema.additionalProperties === false) fail();
      check(child ?? schema.additionalProperties ?? {}, value[key], `${path}/${key}`);
    }
  }
}
export function validate(name, value) {
  if (!Object.hasOwn(schemas, name)) throw new Error('unknown_schema');
  canonicalBytes(value); // Also rejects unsupported values in opaque JSON sections.
  check(schemas[name], value, name);
  if (name === 'marker' && (value.pid !== value.processIdentity.pid ||
      value.publicationEpoch.bootId !== value.processIdentity.bootId ||
      value.handoverCapabilities.endpointPinned !== (value.endpointMode === 'fixed'))) throw new Error('contradictory_marker');
  if (name === 'compatibilityEvidence' && value.expiresAt <= value.issuedAt) throw new Error('invalid_evidence_interval');
  if (name === 'upgradeTransaction' && (value.updatedAt < value.createdAt ||
      (value.delegationState === 'DELEGATING' && value.controllerAuthorityState === 'ACTIVE'))) throw new Error('contradictory_delegation');
  return value;
}
export function classifyMarker(value, expectedPrefixId) {
  if (!Object.hasOwn(value, 'schemaVersion')) {
    if (![value.endpoint, value.generation, value.startedAt, value.token].every(v => typeof v === 'string' && v.length) ||
        typeof value.pid !== 'number') throw new Error('invalid_legacy_marker');
    const u = new URL(value.endpoint);
    if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) ||
        !u.port || u.username || u.password || u.search || u.hash) throw new Error('invalid_legacy_marker');
    return 'legacy';
  }
  validate('marker', value);
  if (value.prefixId !== expectedPrefixId) throw new Error('foreign_installation_authority');
  return 'v2';
}
