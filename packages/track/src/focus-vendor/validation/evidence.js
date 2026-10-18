import { array, EvidenceError, fail, record, strings, text } from './evidence-shape.js';
import { checkSources } from './evidence-sources.js';
/** Dispatch before the legacy closed validator, keeping its shape and identity intact. */
export function checkEvidence(value, legacy) {
    try {
        const { schemaVersion: _version, sources: rawSources, citations: rawCitations, evidenceGroups: rawGroups, annexes: rawAnnexes, ...base } = value;
        const citationLinks = new Map();
        const strip = (raw, path) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                return raw;
            const { citationRefs, ...node } = raw;
            if (citationRefs !== undefined)
                citationLinks.set(path, strings(citationRefs, `${path}.citationRefs`));
            return node;
        };
        if (Array.isArray(base.sections))
            base.sections = base.sections.map((raw, i) => {
                const section = strip(raw, `$.sections[${i}]`);
                if (section?.kind === 'optionSet' && Array.isArray(section.options))
                    return { ...section,
                        options: section.options.map((o, j) => strip(o, `$.sections[${i}].options[${j}]`)) };
                return section;
            });
        const checked = legacy(base);
        if (!checked.ok)
            return checked;
        const doc = checked.value, seen = new Set(), targets = new Set([doc.ref]);
        const register = (id, path) => {
            if (seen.has(id))
                fail(path, 'duplicate_id', `Duplicate id ${id}`);
            seen.add(id);
        };
        doc.sections.forEach(s => {
            register(s.id, '$.sections');
            targets.add(s.id);
            targets.add(s.targetRef);
            if (s.kind === 'optionSet')
                s.options.forEach(o => { register(o.id, '$.sections.options'); targets.add(o.id); targets.add(o.targetRef); });
        });
        const { sources, lineCounts } = checkSources(rawSources, register);
        const sourceMap = new Map(sources.map(s => [s.id, s]));
        const citations = array(rawCitations, '$.citations').map((raw, i) => {
            const p = `$.citations[${i}]`, c = record(raw, p, ['id', 'sourceId', 'label', 'locator']);
            for (const key of ['id', 'sourceId', 'label'])
                text(c[key], `${p}.${key}`);
            register(c.id, `${p}.id`);
            const source = sourceMap.get(c.sourceId) ?? fail(`${p}.sourceId`, 'unresolved_source', `Unknown source ${c.sourceId}`);
            const loc = c.locator;
            if (loc?.kind === 'lines') {
                record(loc, `${p}.locator`, ['kind', 'start', 'end']);
                if (!lineCounts.has(source.id))
                    fail(`${p}.locator`, 'citation_media', `Source ${source.id} is not text`);
                if (!Number.isSafeInteger(loc.start) || !Number.isSafeInteger(loc.end) || loc.start < 1
                    || loc.end < loc.start || loc.end > lineCounts.get(source.id))
                    fail(`${p}.locator`, 'citation_range', `Invalid inclusive line range for ${source.id}`);
            }
            else if (loc?.kind === 'image') {
                record(loc, `${p}.locator`, ['kind', 'caption']);
                text(loc.caption, `${p}.locator.caption`);
                if (!source.mediaType.startsWith('image/'))
                    fail(`${p}.locator`, 'citation_media', `Source ${source.id} is not an image`);
            }
            else
                fail(`${p}.locator`, 'invalid_evidence', 'Unknown citation locator');
            return c;
        });
        const citationIds = new Set(citations.map(c => c.id));
        const references = (raw, p, ids, code) => {
            const refs = strings(raw, p);
            for (const id of refs)
                if (!ids.has(id))
                    fail(p, code, `Unresolved reference ${id}`);
            return refs;
        };
        for (const [path, refs] of citationLinks)
            references(refs, `${path}.citationRefs`, citationIds, 'unresolved_citation');
        const evidenceGroups = array(rawGroups, '$.evidenceGroups').map((raw, i) => {
            const p = `$.evidenceGroups[${i}]`, g = record(raw, p, ['id', 'summary', 'citationRefs', 'sourceRefs']);
            register(text(g.id, `${p}.id`), `${p}.id`);
            text(g.summary, `${p}.summary`);
            references(g.citationRefs, `${p}.citationRefs`, citationIds, 'unresolved_citation');
            references(g.sourceRefs, `${p}.sourceRefs`, new Set(sourceMap.keys()), 'unresolved_source');
            return g;
        });
        const annexes = array(rawAnnexes, '$.annexes').map((raw, i) => {
            const p = `$.annexes[${i}]`, a = record(raw, p, ['id', 'title', 'summary', 'blocks', 'backRefs']);
            register(text(a.id, `${p}.id`), `${p}.id`);
            text(a.title, `${p}.title`);
            text(a.summary, `${p}.summary`);
            references(a.backRefs, `${p}.backRefs`, targets, 'unresolved_target');
            array(a.blocks, `${p}.blocks`).forEach((rawBlock, j) => {
                const bpath = `${p}.blocks[${j}]`, kind = rawBlock?.kind;
                if (kind === 'text' || kind === 'code') {
                    const b = record(rawBlock, bpath, ['kind', 'text'], kind === 'code' ? ['language'] : []);
                    text(b.text, `${bpath}.text`, true);
                    if (b.language !== undefined)
                        text(b.language, `${bpath}.language`);
                }
                else if (kind === 'table') {
                    const b = record(rawBlock, bpath, ['kind', 'columns', 'rows']);
                    const columns = strings(b.columns, `${bpath}.columns`);
                    if (!columns.length)
                        fail(bpath, 'invalid_evidence', 'A table needs columns');
                    array(b.rows, `${bpath}.rows`).forEach((row, k) => {
                        const cells = array(row, `${bpath}.rows[${k}]`);
                        cells.forEach((cell, l) => text(cell, `${bpath}.rows[${k}][${l}]`, true));
                        if (cells.length !== columns.length)
                            fail(bpath, 'invalid_evidence', 'Table row width mismatch');
                    });
                }
                else if (kind === 'references') {
                    const b = record(rawBlock, bpath, ['kind', 'citationRefs']);
                    references(b.citationRefs, `${bpath}.citationRefs`, citationIds, 'unresolved_citation');
                }
                else
                    fail(`${bpath}.kind`, 'invalid_evidence', 'Unsupported annex block (no decisions or active content)');
            });
            return a;
        });
        const attach = (node, path) => citationLinks.has(path) ? { ...node, citationRefs: citationLinks.get(path) } : node;
        const sections = doc.sections.map((s, i) => attach(s.kind === 'optionSet' ? { ...s,
            options: s.options.map((o, j) => attach(o, `$.sections[${i}].options[${j}]`)) } : s, `$.sections[${i}]`));
        return { ok: true, value: { ...doc, schemaVersion: 2, sections, sources, citations, evidenceGroups, annexes } };
    }
    catch (error) {
        if (error instanceof EvidenceError)
            return { ok: false, issues: [error.issue] };
        throw error;
    }
}
