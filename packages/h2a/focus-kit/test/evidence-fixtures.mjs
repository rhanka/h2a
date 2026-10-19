import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const source = (id, bytes, mediaType = 'text/plain') => ({ id, title: `Source ${id}`,
  origin: { uri: `urn:fixture:${id}` }, mediaType, encoding: 'base64',
  data: Buffer.from(bytes).toString('base64'), sha256: digest(bytes), size: Buffer.byteLength(bytes) });
export function evidenceFixture(lines = 12, count = 3) {
  const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
  const text = Array.from({ length: lines }, (_, i) => `Ligne ${i + 1} café — ${i === lines - 1 ? 'fin distante' : 'preuve'}`).join('\r\n') + '\r\n';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=', 'base64');
  doc.schemaVersion = 2;
  doc.sources = [source('long', text), { ...source('capture', png, 'image/png'), width: 1, height: 1, alt: 'Capture de référence' },
    ...Array.from({ length: count - 2 }, (_, i) => source(`other-${i}`, 'Supporting text'))];
  doc.citations = [{ id: 'late', sourceId: 'long', label: 'Preuve distante', locator: { kind: 'lines', start: lines, end: lines + 1 } },
    { id: 'picture', sourceId: 'capture', label: 'Capture', locator: { kind: 'image', caption: 'État observé' } }];
  doc.evidenceGroups = [{ id: 'claim', summary: 'Les pièces étayent la proposition.', citationRefs: ['late', 'picture'], sourceRefs: ['long'] }];
  doc.annexes = [{ id: 'detail', title: 'Détail des pièces', summary: 'Démonstration consultable séparément.', blocks: [
    { kind: 'text', text: 'Texte de soutien.' }, { kind: 'code', language: 'yaml', text: 'step: test' },
    { kind: 'table', columns: ['État'], rows: [['Mesuré']] }, { kind: 'references', citationRefs: ['late'] }], backRefs: [doc.sections[0].id] }];
  doc.sections[0].citationRefs = ['late'];
  doc.sections.find(s => s.kind === 'optionSet').options[0].citationRefs = ['picture'];
  return doc;
}
