import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

// RFC 8785: emit keys directly. JSON.stringify(object) reorders integer keys.
export function canonicalBytes(value) {
  const stack = new Set();
  const string = (s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('invalid_unicode');
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('invalid_unicode');
    }
    return JSON.stringify(s);
  };
  const emit = (v) => {
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return string(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null || stack.has(v)) throw new Error('invalid_json');
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      throw new Error('invalid_json_object');
    }
    if (Reflect.ownKeys(v).some((key) => typeof key === 'symbol')) throw new Error('invalid_json_key');
    stack.add(v);
    let result;
    if (Array.isArray(v)) {
      const values = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw new Error('invalid_json_array');
        values.push(emit(v[i]));
      }
      result = `[${values.join(',')}]`;
    } else {
      result = `{${Object.keys(v).sort().map((key) => `${string(key)}:${emit(v[key])}`).join(',')}}`;
    }
    stack.delete(v);
    return result;
  };
  return Buffer.from(emit(value), 'utf8');
}

export function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalBytes(value)).digest('hex')}`;
}

const domains = new Set(['readiness', 'requests', 'responses', 'notifications', 'admission', 'compatibility']);
export function deriveKey(root, domain, context) {
  if (!Buffer.isBuffer(root) || root.length < 32 || !domains.has(domain)) throw new Error('invalid_key_domain');
  if (Object.keys(context).sort().join(',') !== 'generation,namespaceId,service' ||
      context.service !== 'h2a-mcp-central' ||
      ![context.namespaceId, context.generation].every((v) => typeof v === 'string' && v.length)) {
    throw new Error('invalid_key_context');
  }
  return Buffer.from(hkdfSync('sha256', root, Buffer.from('h2a-mcp-v2/hkdf/v1'),
    canonicalBytes({ domain, ...context }), 32));
}

export function sign(root, domain, context, payload) {
  return createHmac('sha256', deriveKey(root, domain, context)).update(canonicalBytes(payload)).digest('hex');
}

export function verify(root, domain, context, payload, mac) {
  if (typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac)) return false;
  return timingSafeEqual(Buffer.from(sign(root, domain, context, payload), 'hex'), Buffer.from(mac, 'hex'));
}
