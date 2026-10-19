import { isEvidenceDossier } from '../model.js';
import type { DecisionDossierDocument } from '../model.js';

/** Disclosed estimate at six UTF-8 bytes per word; raw consultation is not decision time. */
export function evidenceVolume(doc: DecisionDossierDocument): { sources: number; bytes: number; consultationMinutes: number } {
  if (!isEvidenceDossier(doc)) return { sources: 0, bytes: 0, consultationMinutes: 0 };
  const bytes = doc.sources.reduce((n, s) => n + s.size, 0);
  const textBytes = doc.sources.filter(s => !s.mediaType.startsWith('image/')).reduce((n, s) => n + s.size, 0)
    + doc.annexes.reduce((n, a) => n + new TextEncoder().encode(JSON.stringify(a.blocks)).length, 0);
  return { sources: doc.sources.length, bytes, consultationMinutes: Math.ceil(textBytes / 6 / 180) };
}

/** All exports retain an evidence index; full raw bytes remain in the portable envelope. */
export function evidenceIndex(doc: DecisionDossierDocument): string {
  if (!isEvidenceDossier(doc)) return '';
  const v = evidenceVolume(doc);
  const lines = [`Evidence: ${v.sources} sources · ${v.bytes} bytes · estimated consultation ${v.consultationMinutes} min (6 bytes/word)`,
    'Raw supporting detail is separate from the primary reading budget.'];
  for (const s of doc.sources) lines.push(`Source ${s.id}: ${s.title} · ${s.mediaType} · ${s.size} bytes · SHA-256 ${s.sha256} · ${JSON.stringify(s.origin)}`);
  for (const c of doc.citations) lines.push(`Citation ${c.id}: ${c.label} → ${c.sourceId}:${c.locator.kind === 'lines' ? `${c.locator.start}–${c.locator.end}` : c.locator.caption}`);
  for (const s of doc.sections) {
    if (s.citationRefs?.length) lines.push(`${s.id} → ${s.citationRefs.join(', ')}`);
    if (s.kind === 'optionSet') for (const o of s.options) if (o.citationRefs?.length) lines.push(`${o.id} → ${o.citationRefs.join(', ')}`);
  }
  for (const g of doc.evidenceGroups) lines.push(`${g.id}: ${g.summary} → ${[...g.citationRefs,...g.sourceRefs].join(', ')}`);
  for (const a of doc.annexes) lines.push(`Annex ${a.id}: ${a.title} — ${a.summary} · ${a.blocks.length} support blocks · back: ${a.backRefs.join(', ')}`);
  lines.push('Full embedded evidence consultation/download requires the portable HTML renderer.');
  return lines.join('\n');
}
