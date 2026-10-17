/** Portable dossier adapter. Focus owns the document and the presentation gate. */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DecisionDossierDocument } from '@sentropic/focus';

// Generated directly from @sentropic/focus/validate; no second validation implementation.
const { assertDecisionDossierForPresentation, assertDecisionDossierDocument } =
  await import(new URL('../focus-kit/validator.mjs', import.meta.url).href) as typeof import('@sentropic/focus/validate');

interface Scene {
  title: string;
  nodes: { id: string; label: string; detail?: string; position: { x: number; y: number } }[];
  edges: { source: string; target: string; label: string }[];
}
const kit = new URL('../focus-kit/', import.meta.url);
const readAsset = (name: string): string => readFileSync(new URL(name, kit), 'utf8');
const jsonForHtml = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Catalog macros expand to ordinary Mermaid in the embedded canonical document. */
function sceneSource(scene: Scene): string {
  const nodeIds = new Map(scene.nodes.map((n, i) => [n.id, `node${i}`]));
  return ['flowchart LR', ...scene.nodes.map(n => `${nodeIds.get(n.id)}["${n.label}"]`),
    ...scene.edges.map(e => `${nodeIds.get(e.source)} -->|${e.label}| ${nodeIds.get(e.target)}`)].join('\n');
}

/** Deliberately bounded flowchart profile; unsupported syntax refuses at build time. */
function parseFlowchart(source: string, title: string): Scene {
  const lines = source.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
  if (!/^flowchart (LR|TB|TD)$/.test(lines.shift() ?? '')) throw new Error('Unsupported diagram: use ecosystem:<scene> or the documented Mermaid flowchart profile');
  const nodes: Scene['nodes'] = [], edges: Scene['edges'] = [];
  const horizontal = source.trim().startsWith('flowchart LR');
  for (const line of lines) {
    const node = /^([a-z][a-z0-9_-]*)\["([^"<>\n]+)"\]$/.exec(line);
    const edge = /^([a-z][a-z0-9_-]*) -->\|([^|<>\n]+)\| ([a-z][a-z0-9_-]*)$/.exec(line);
    if (node) {
      if (nodes.some(n => n.id === node[1])) throw new Error(`Duplicate diagram node: ${node[1]}`);
      const i = nodes.length;
      nodes.push({ id: node[1], label: node[2], position: { x: horizontal ? i * 280 : 0, y: horizontal ? 0 : i * 140 } });
    } else if (edge) edges.push({ source: edge[1], target: edge[3], label: edge[2] });
    else throw new Error(`Unsupported flowchart line: ${line}`);
  }
  if (!nodes.length || nodes.length > 80 || edges.length > 160) throw new Error('Diagram needs 1–80 nodes and at most 160 edges');
  for (const e of edges) if (!nodes.some(n => n.id === e.source) || !nodes.some(n => n.id === e.target)) throw new Error('Unresolved diagram edge');
  return { title, nodes, edges };
}

export function buildFocusDossier(input: unknown): string {
  // Refuse closed-schema violations before interpreting diagram references.
  const inputDocument = assertDecisionDossierDocument(input);
  const catalog = JSON.parse(readAsset('ecosystem.json')) as { scenes: Record<string, Scene> };
  const scenes: Record<string, Scene> = Object.create(null);
  const sections = inputDocument.sections.map(section => {
    if (section.kind !== 'diagram') return section;
    if (section.syntax !== 'mermaid') throw new Error('Unsupported diagram syntax: use mermaid flowcharts or ecosystem references');
    if (section.source.startsWith('ecosystem:')) {
      const name = section.source.slice('ecosystem:'.length);
      if (!Object.hasOwn(catalog.scenes, name)) throw new Error(`Unknown ecosystem scene: ${name}`);
      scenes[section.id] = catalog.scenes[name];
      // Readability includes the human-visible node explanations too.
      return { ...section, source: sceneSource(catalog.scenes[name]) + '\n' + catalog.scenes[name].nodes.map(n => `%% ${n.detail ?? ''}`).join('\n') };
    } else scenes[section.id] = parseFlowchart(section.source, section.alt);
    return section;
  });
  const validated: DecisionDossierDocument = assertDecisionDossierForPresentation({ ...inputDocument, sections });
  if (!Object.keys(scenes).length) throw new Error('A Focus dossier needs an ecosystem diagram; add a diagram section with source ecosystem:overview');
  const renderer = readAsset('renderer.html');
  if (!renderer.includes('<!--FOCUS_PAYLOAD-->') || !renderer.includes('<!--FOCUS_TITLE-->')) throw new Error('Invalid Focus renderer asset; rebuild the kit');
  return renderer.replace('<!--FOCUS_TITLE-->', () => escapeHtml(validated.title))
    .replace('<!--FOCUS_PAYLOAD-->', () => `<script type="application/json" data-focus-document>${jsonForHtml({ document: validated, scenes })}</script>`);
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
