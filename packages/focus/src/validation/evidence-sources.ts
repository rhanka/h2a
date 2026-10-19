import type { EvidenceSource } from '../model.js';
import { decodeEvidence, evidenceLines, evidenceText, sha256 } from './evidence-bytes.js';
import { array, fail, imageDimensions, record, text } from './evidence-shape.js';
export const isTextSource = (media: string): boolean => /^text\/[a-z0-9.+-]+$/.test(media)
  || ['application/json', 'application/yaml', 'application/x-yaml', 'application/x-ndjson'].includes(media);
export function checkSources(value: unknown, register: (id: string, path: string) => void): { sources: EvidenceSource[]; lineCounts: Map<string, number> } {
  const lineCounts = new Map<string, number>();
  const sources = array(value, '$.sources').map((raw, i) => {
    const path = `$.sources[${i}]`;
    const s = record(raw, path, ['id','title','origin','mediaType','encoding','data','sha256','size'], ['width','height','alt']);
    for (const key of ['id','title','mediaType','sha256']) text(s[key], `${path}.${key}`);
    register(s.id as string, `${path}.id`);
    const origin = s.origin as Record<string, unknown>;
    const fields = origin && Object.hasOwn(origin, 'uri') ? ['uri'] : ['repo','revision','path'];
    record(origin, `${path}.origin`, fields);
    for (const key of fields) text(origin[key], `${path}.origin.${key}`);
    if (s.encoding !== 'base64') fail(`${path}.encoding`, 'source_encoding', 'Only original base64 bytes are accepted');
    const media = s.mediaType as string;
    if (!isTextSource(media) && !['image/png','image/jpeg'].includes(media)) fail(`${path}.mediaType`, 'unsupported_media', `Unsupported media for source ${s.id}`);
    let bytes: Uint8Array;
    try { bytes = decodeEvidence(text(s.data, `${path}.data`, true)); }
    catch { return fail(`${path}.data`, 'source_encoding', `Invalid base64 for source ${s.id}`); }
    if (!Number.isSafeInteger(s.size) || s.size !== bytes.length) fail(`${path}.size`, 'source_size', `Byte size mismatch for source ${s.id}`);
    if (!/^[a-f0-9]{64}$/.test(s.sha256 as string) || sha256(bytes) !== s.sha256) fail(`${path}.sha256`, 'source_digest', `SHA-256 mismatch for source ${s.id}`);
    if (isTextSource(media)) {
      try { lineCounts.set(s.id as string, evidenceLines(evidenceText(bytes)).length); }
      catch { fail(`${path}.data`, 'source_encoding', `Invalid UTF-8 for source ${s.id}`); }
      for (const key of ['width','height','alt']) if (s[key] !== undefined) fail(`${path}.${key}`, 'invalid_evidence', 'Image metadata on text');
    } else {
      text(s.alt, `${path}.alt`);
      const dimensions = imageDimensions(bytes, media);
      if (!dimensions || !Number.isSafeInteger(s.width) || !Number.isSafeInteger(s.height)
        || dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[0] !== s.width || dimensions[1] !== s.height)
        fail(path, 'image_metadata', `Image dimensions/signature mismatch for source ${s.id}`);
    }
    return s as unknown as EvidenceSource;
  });
  return { sources, lineCounts };
}
