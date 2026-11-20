// Anchors live inside the existing `sectionKey` field (DS review kit r6 §2):
//   sectionKey = "a1:" + base64url(utf8(JSON.stringify(payload)))
//   text:    { t:"text", q:{exact,prefix,suffix}, pos?, sel?, aid?, v }
//   element: { t:"element", sel, aid?, v }
//   region:  { t:"region", rect, v }
// The server never rewrites an anchor; it decodes one only to validate it and to hand the decoded form to
// the owning agent in the h2a send payload (r6 §4). The 2048-character cap is owner decision D3 (code
// `section_key_too_long`, maxLength 2048).

export const ANCHOR_PREFIX = 'a1:';
export const SECTION_KEY_MAX = 2048;
export const EXCERPT_MAX = 500;
const ANCHOR_TYPES = new Set(['text', 'element', 'region']);
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
export function encodeAnchor(payload) {
  return ANCHOR_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Validate and decode a `sectionKey` anchor. Returns a result object instead of throwing: callers decide
 * whether a bad anchor is a 400 (a write) or a reason to send `anchor: null` (an already stored row).
 * @param {unknown} sectionKey
 * @returns {{ ok: true, anchor: Record<string, unknown> } | { ok: false, code: string, message: string, details?: Record<string, unknown> }}
 */
export function decodeAnchor(sectionKey) {
  if (typeof sectionKey !== 'string' || sectionKey.length === 0) {
    return { ok: false, code: 'invalid_anchor', message: 'sectionKey must be a non-empty string.' };
  }
  if (sectionKey.length > SECTION_KEY_MAX) {
    return {
      ok: false,
      code: 'section_key_too_long',
      message: `sectionKey is ${sectionKey.length} characters; the cap is ${SECTION_KEY_MAX} (decision D3). Shorten the quote context.`,
      details: { maxLength: SECTION_KEY_MAX }
    };
  }
  if (!sectionKey.startsWith(ANCHOR_PREFIX)) {
    return {
      ok: false,
      code: 'invalid_anchor',
      message: `sectionKey must use the review kit anchor format "${ANCHOR_PREFIX}" + base64url(JSON).`
    };
  }
  const encoded = sectionKey.slice(ANCHOR_PREFIX.length);
  if (!BASE64URL.test(encoded)) {
    return { ok: false, code: 'invalid_anchor', message: 'sectionKey anchor payload is not base64url.' };
  }
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, code: 'invalid_anchor', message: 'sectionKey anchor payload is not JSON.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid_anchor', message: 'sectionKey anchor payload must be a JSON object.' };
  }
  const anchor = /** @type {Record<string, unknown>} */ (payload);
  if (typeof anchor.t !== 'string' || !ANCHOR_TYPES.has(anchor.t)) {
    return {
      ok: false,
      code: 'invalid_anchor',
      message: `sectionKey anchor type must be one of ${[...ANCHOR_TYPES].join(', ')}.`
    };
  }
  return { ok: true, anchor };
}

/**
 * A bounded excerpt of a comment body for the h2a send payload: the envelope never carries more than this.
 * @param {string} body
 * @param {number} [max]
 * @returns {string}
 */
export function excerptOf(body, max = EXCERPT_MAX) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
