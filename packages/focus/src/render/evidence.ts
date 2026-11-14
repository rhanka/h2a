import { isEvidenceDossier, isReportDocument } from '../model.js';
import type { FocusDocument } from '../model.js';

/** Shared bibliography order and literal origin; never turn an untrusted URI into a link. */
export function bibliography(doc: Parameters<typeof evidenceVolume>[0]) {
  if (!isEvidenceDossier(doc)) return [];
  // Hex is injective and safe in both fragment URLs and CSS selectors.
  const docId = Array.from(new TextEncoder().encode(doc.ref), b => b.toString(16).padStart(2, '0')).join('');
  const occupied = new Set(doc.sections.flatMap(s => [s.id, ...(s.kind === 'optionSet' ? s.options.map(o => o.id) : [])]));
  return doc.citations.map((citation, index) => {
    let anchorId = `src-${docId}-${index + 1}`;
    while (occupied.has(anchorId)) anchorId += '-';
    occupied.add(anchorId);
    const source = doc.sources.find(s => s.id === citation.sourceId)!;
    const origin = 'path' in source.origin
      ? `${source.origin.repo}@${source.origin.revision}:${source.origin.path}` : source.origin.uri;
    const location = citation.locator.kind === 'lines'
      ? `${origin}:${citation.locator.start}–${citation.locator.end}` : `${origin} · ${citation.locator.caption}`;
    return { number: index + 1, anchorId, citation, source, location };
  });
}

/** Disclosed estimate at six UTF-8 bytes per word; raw consultation is not decision time. */
export function evidenceVolume(doc: FocusDocument): { sources: number; bytes: number; consultationMinutes: number } {
  if (!isEvidenceDossier(doc)) return { sources: 0, bytes: 0, consultationMinutes: 0 };
  const bytes = doc.sources.reduce((n, s) => n + s.size, 0);
  const textBytes = doc.sources.filter(s => !s.mediaType.startsWith('image/')).reduce((n, s) => n + s.size, 0)
    + doc.annexes.reduce((n, a) => n + new TextEncoder().encode(JSON.stringify(a.blocks)).length, 0);
  return { sources: doc.sources.length, bytes, consultationMinutes: Math.ceil(textBytes / 6 / 180) };
}

/** All exports retain an evidence index; full raw bytes remain in the portable envelope. */
export function evidenceIndex(doc: FocusDocument): string {
  if (!isEvidenceDossier(doc)) return '';
  const v = evidenceVolume(doc);
  const lines = [`Evidence: ${v.sources} sources · ${v.bytes} bytes · estimated consultation ${v.consultationMinutes} min (6 bytes/word)`,
    'Raw supporting detail is separate from the primary reading budget.'];
  for (const s of doc.sources) lines.push(`Source ${s.id}: ${s.title} · ${s.mediaType} · ${s.size} bytes · SHA-256 ${s.sha256} · ${JSON.stringify(s.origin)}`);
  lines.push('Sources');
  const entries = bibliography(doc);
  const calls = (refs: readonly string[]) => refs.map(id => `[${entries.find(e => e.citation.id === id)!.number}]`).join(', ');
  for (const { number, citation, source, location } of entries) lines.push(`[${number}] ${citation.label} · ${source.title} · ${location}`);
  for (const s of doc.sections) {
    if (s.citationRefs?.length) lines.push(`${s.id} → ${calls(s.citationRefs)}`);
    if (s.kind === 'optionSet') for (const o of s.options) if (o.citationRefs?.length) lines.push(`${o.id} → ${calls(o.citationRefs)}`);
  }
  for (const g of doc.evidenceGroups) lines.push(`${g.id}: ${g.summary} → ${[calls(g.citationRefs), ...g.sourceRefs.map(id => `Source ${id}`)].filter(Boolean).join(', ')}`);
  for (const a of doc.annexes) {
    lines.push(`Annex ${a.id}: ${a.title} — ${a.summary} · ${a.blocks.length} support blocks · back: ${a.backRefs.join(', ')}`);
    for (const block of a.blocks) if (block.kind === 'references') lines.push(`${a.id} → ${calls(block.citationRefs)}`);
  }
  lines.push('Full embedded evidence consultation/download requires the portable HTML renderer.');
  return lines.join('\n');
}

/** Reports retain appendix contents in every export; the evidence index keeps provenance. */
export function reportAnnexes(doc: FocusDocument, format: 'html' | 'markdown' | 'terminal'): string {
  if (!isReportDocument(doc)) return '';
  const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const fence = (s: string): string => '`'.repeat(Math.max(3, ...Array.from(s.matchAll(/`+/g), m => m[0].length + 1)));
  return doc.annexes.map(a => {
    const blocks = a.blocks.map(b => {
      if (b.kind === 'table') {
        if (format === 'html') return `<table><thead><tr>${b.columns.map(c => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row => `<tr>${row.map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        return [b.columns, b.columns.map(() => '---'), ...b.rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
      }
      if (b.kind === 'references') return b.citationRefs.map(id => {
        const label = doc.citations.find(c => c.id === id)!.label;
        return format === 'html' ? `<p>${escape(label)}</p>` : label;
      }).join('\n');
      if (format === 'html') return b.kind === 'code' ? `<pre><code>${escape(b.text)}</code></pre>` : `<p>${escape(b.text)}</p>`;
      return b.kind === 'code' && format === 'markdown' ? `${fence(b.text)}\n${b.text}\n${fence(b.text)}` : b.text;
    }).join('\n');
    return format === 'html' ? `<section class="focus-annex"><h2>${escape(a.title)}</h2><p>${escape(a.summary)}</p>${blocks}</section>` : `## ${a.title}\n\n${a.summary}\n\n${blocks}`;
  }).join('\n\n');
}
