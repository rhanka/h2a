/** Portable dossier adapter. Focus owns the document and the presentation gate. */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DecisionDossierDocument } from '@sentropic/focus';

// Generated directly from @sentropic/focus/validate; no second validation implementation.
const { assertDecisionDossierForPresentation, assertDecisionDossierDocument } =
  await import(new URL('../focus-kit/validator.mjs', import.meta.url).href) as typeof import('@sentropic/focus/validate');

const kit = new URL('../focus-kit/', import.meta.url);
const readAsset = (name: string): string => readFileSync(new URL(name, kit), 'utf8');
const jsonForHtml = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Consumer bounds for the interim generic@1 renderer, not a diagram-core schema implementation.
 * The authoritative DS schema will be pinned when published. Keep the boundary plain JSON. */
function semanticSource(document: Record<string, any>): string {
  const fail = (): never => { throw new Error('Unsupported diagram-core document: expected generic@1 nodes/containers, links and a containment tree without views, geometry or layout hints'); };
  if (!document.documentId?.startsWith('document:') || document.schemaVersion?.major !== 1 || document.schemaVersion?.minor !== 1 ||
      !Number.isInteger(document.revision) || document.revision < 0 || JSON.stringify(document.profileRefs) !== '["generic@1"]' ||
      Object.keys(document).some(k => !['documentId', 'schemaVersion', 'revision', 'profileRefs', 'typeDefinitions', 'entities', 'relations', 'ports', 'resources', 'extensions'].includes(k))) fail();
  for (const key of ['typeDefinitions', 'entities', 'relations', 'ports', 'resources']) {
    if (!document[key] || typeof document[key] !== 'object' || Array.isArray(document[key])) fail();
  }
  if (Object.keys(document.typeDefinitions).length || Object.keys(document.ports).length || Object.keys(document.resources).length ||
      !Array.isArray(document.extensions) || document.extensions.length) fail();
  const entities = Object.entries(document.entities) as [string, any][];
  const relations = Object.entries(document.relations) as [string, any][];
  if (!entities.length || entities.length > 80 || relations.length > 240) fail();
  const ids = new Map(entities.map(([id], i) => [id, `node${i}`]));
  const lines = ['flowchart LR'];
  for (const [id, entity] of entities) {
    if (!id.startsWith('entity:') || entity.id !== id || entity.profile !== 'generic@1' || !['node', 'container'].includes(entity.type) ||
        entity.attributes?.name?.kind !== 'text' || typeof entity.attributes.name.value !== 'string' ||
        Object.keys(entity).some(k => !['id', 'profile', 'type', 'attributes'].includes(k))) fail();
    lines.push(`${ids.get(id)}[${JSON.stringify(entity.attributes.name.value)}]`);
  }
  const parents = new Map<string, string>();
  for (const [id, relation] of relations) {
    if (!id.startsWith('relation:') || relation.id !== id || relation.profile !== 'generic@1' || !['link', 'contains'].includes(relation.type) ||
        !Array.isArray(relation.endpoints) || relation.endpoints.length !== 2 ||
        Object.keys(relation).some(k => !['id', 'profile', 'type', 'endpoints', 'attributes'].includes(k))) fail();
    const roles = relation.type === 'link' ? ['source', 'target'] : ['parent', 'child'];
    const endpoints = roles.map(role => relation.endpoints.find((e: any) => e.role === role)?.target);
    if (endpoints.some(target => !ids.has(target))) fail();
    if (relation.type === 'contains') {
      const [parent, child] = endpoints;
      if (document.entities[parent].type !== 'container' || parents.has(child)) fail();
      parents.set(child, parent);
    } else {
      const label = relation.attributes?.label;
      if (label !== undefined && (label.kind !== 'text' || typeof label.value !== 'string')) fail();
      lines.push(`${ids.get(endpoints[0])} -->|${label?.value.replace(/\|/g, '&#124;') || ' '}| ${ids.get(endpoints[1])}`);
    }
  }
  for (const id of parents.keys()) {
    const visited = new Set<string>();
    for (let current: string | undefined = id; current !== undefined; current = parents.get(current)) {
      if (visited.has(current)) fail();
      visited.add(current);
    }
  }
  return lines.join('\n');
}

/** Deliberately bounded flowchart profile; unsupported syntax refuses at build time. */
function parseFlowchart(source: string, id: string): Record<string, unknown> {
  const lines = source.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
  if (!/^flowchart (LR|TB|TD)$/.test(lines.shift() ?? '')) throw new Error('Unsupported diagram: use ecosystem:<scene> or the documented Mermaid flowchart profile');
  const entities: Record<string, unknown> = {}, relations: Record<string, unknown> = {};
  let edgeCount = 0;
  for (const line of lines) {
    const node = /^([a-z][a-z0-9_-]*)\["([^"<>\n]+)"\]$/.exec(line);
    const edge = /^([a-z][a-z0-9_-]*) -->\|([^|<>\n]+)\| ([a-z][a-z0-9_-]*)$/.exec(line);
    if (node) {
      const entityId = `entity:${node[1]}`;
      if (Object.hasOwn(entities, entityId)) throw new Error(`Duplicate diagram node: ${node[1]}`);
      entities[entityId] = { id: entityId, profile: 'generic@1', type: 'node', attributes: { name: { kind: 'text', value: node[2] } } };
    } else if (edge) {
      const relationId = `relation:${edgeCount++}`;
      relations[relationId] = { id: relationId, profile: 'generic@1', type: 'link',
        endpoints: [{ role: 'source', target: `entity:${edge[1]}` }, { role: 'target', target: `entity:${edge[3]}` }],
        attributes: { label: { kind: 'text', value: edge[2] } } };
    }
    else throw new Error(`Unsupported flowchart line: ${line}`);
  }
  if (!Object.keys(entities).length || Object.keys(entities).length > 80 || edgeCount > 160) throw new Error('Diagram needs 1–80 nodes and at most 160 edges');
  const document = { documentId: `document:${id}`, schemaVersion: { major: 1, minor: 1 }, revision: 0,
    profileRefs: ['generic@1'], typeDefinitions: {}, entities, relations, ports: {}, resources: {}, extensions: [] };
  semanticSource(document);
  return document;
}

export function buildFocusDossier(input: unknown): string {
  // Refuse closed-schema violations before interpreting diagram references.
  const inputDocument = assertDecisionDossierDocument(input);
  const catalog = JSON.parse(readAsset('ecosystem.json'));
  let diagramCount = 0;
  const sections = inputDocument.sections.map(section => {
    if (section.kind !== 'diagram') return section;
    diagramCount++;
    // Supplied semantics are authoritative; source remains a backward-compatible text fallback.
    if (section.scene !== undefined) {
      semanticSource(section.scene);
      return section;
    }
    if (section.syntax !== 'mermaid') throw new Error('Unsupported diagram syntax: use mermaid flowcharts or ecosystem references');
    if (section.source.startsWith('ecosystem:')) {
      const name = section.source.slice('ecosystem:'.length);
      if (!Object.hasOwn(catalog.scenes, name)) throw new Error(`Unknown ecosystem scene: ${name}`);
      // Catalog explanations remain in the text fallback and its readability budget.
      const entry = catalog.scenes[name];
      return { ...section, scene: entry.document, source: semanticSource(entry.document) + '\n' + entry.description.split('\n').map((line: string) => `%% ${line}`).join('\n') };
    }
    return { ...section, scene: parseFlowchart(section.source, section.id) };
  });
  const validated: DecisionDossierDocument = assertDecisionDossierForPresentation({ ...inputDocument, sections });
  if (!diagramCount) throw new Error('A Focus dossier needs an ecosystem diagram; add a diagram section with source ecosystem:overview');
  const renderer = readAsset('renderer.html');
  if (!renderer.includes('<!--FOCUS_PAYLOAD-->') || !renderer.includes('<!--FOCUS_TITLE-->')) throw new Error('Invalid Focus renderer asset; rebuild the kit');
  return renderer.replace('<!--FOCUS_TITLE-->', () => escapeHtml(validated.title))
    .replace('<!--FOCUS_PAYLOAD-->', () => `<script type="application/json" data-focus-document>${jsonForHtml({ document: validated })}</script>`);
}

export function runFocusBuildCli(args: readonly string[], streams = { stdout: process.stdout, stderr: process.stderr }): number {
  const usage = 'Usage: h2a focus build <dossier.json> -o <file.html>\n       h2a focus template -o <dossier.json>\n';
  if (args.includes('--help') || args.includes('-h')) { streams.stdout.write(usage); return 0; }
  const template = args[0] === 'template';
  const offset = template ? 1 : 2;
  if ((!template && args[0] !== 'build') || args.length !== offset + 2 || !['-o', '--output'].includes(args[offset]) || !args[offset + 1] || args[offset + 1].startsWith('-') || (!template && args[1].startsWith('-'))) {
    streams.stderr.write(usage); return 2;
  }
  try {
    const output = resolve(args[offset + 1]);
    if (!template) {
      let existingOutput = output;
      try { existingOutput = realpathSync(output); } catch { /* New output file. */ }
      if (realpathSync(args[1]) === existingOutput) throw new Error('Output must differ from the input dossier');
    }
    const html = template ? readAsset('dossier.template.json') : buildFocusDossier(JSON.parse(readFileSync(args[1], 'utf8')));
    writeFileSync(output, html, 'utf8');
    streams.stdout.write(template ? `Focus template: ${output}\n` : `Focus dossier validated; portable HTML: ${output}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a focus ${args[0]}: ${(error as Error).message}\n`); return 1;
  }
}
