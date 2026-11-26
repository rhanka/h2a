/** Portable dossier adapter. Focus owns the document and the presentation gate. */
import { readFileSync, writeFileSync, realpathSync, statSync, mkdtempSync, openSync, closeSync, fsyncSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  FOCUS_THEME_MAX_CSS_BYTES,
  extractRootThemeCustomProperties,
  validateThemeCss,
  validateThemeId,
} from '@sentropic/focus';
import type { FocusDocument } from '@sentropic/focus';
import {
  assertFocusArtifact,
  buildDerivedFileEntry,
  buildFocusArtifactManifest,
  buildFocusViewsDocument,
  canonicalJsonString,
  checkFocusArtifact,
  rendererManifestDigest,
  validateFocusArtifactManifest,
  validateFocusViewsDocument,
  type FocusArtifactManifest,
  type FocusDiagramDerivedEntry,
  type FocusManifestFileEntry,
  type FocusManifestRenderer,
  type FocusManifestValidator,
} from '@sentropic/focus/artifact';

// Generated directly from @sentropic/focus/validate; no second validation implementation.
const { assertFocusForPresentation, assertFocusDocument } =
  await import(new URL('../focus-kit/validator.mjs', import.meta.url).href) as typeof import('@sentropic/focus/validate');

// Generated from the shared focus-kit DS bridge (`ds-diagram-bridge.js` via `diagram-views.mjs`).
export interface R7RenderedVariant {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly displayWidth?: number;
  readonly displayScale?: number;
  readonly orientation?: string;
  readonly problems: readonly string[];
  readonly cards: readonly string[];
  readonly zones: readonly string[];
  readonly steps?: readonly string[];
  readonly panels: readonly string[];
  readonly edges: readonly { readonly id: string; readonly from: string; readonly to: string; readonly style: string; readonly label: string }[];
}
export interface R7RenderedDiagram {
  readonly renderer: 'r7';
  readonly profile?: string;
  readonly wide: R7RenderedVariant;
  readonly narrow: R7RenderedVariant;
  readonly phone?: R7RenderedVariant;
  readonly processTable?: string;
}
export interface DiagramViewRefusal { readonly code: string; readonly slot: string; readonly entityId: string; readonly neededPx: number; readonly allocatedPx: number; readonly text?: string }
export class DiagramViewRefusalError extends Error {
  readonly sectionId: string;
  readonly diagnostics: readonly DiagramViewRefusal[];
  constructor(sectionId: string, diagnostics: readonly DiagramViewRefusal[]) {
    super(`Diagram view refused (${sectionId}): ${diagnostics.map(d =>
      `${d.code} ${d.slot} ${d.entityId} needed ${d.neededPx}px > ${d.allocatedPx}px${d.text === undefined ? '' : ` « ${d.text} »`}`).join('; ')}`);
    this.name = 'DiagramViewRefusalError';
    this.sectionId = sectionId;
    this.diagnostics = diagnostics;
  }
}
const {
  renderR7Diagram,
  resolveDossierDiagramScene,
  findLinearChainArchitectureWarning,
} = await import(new URL('../focus-kit/diagram-views.mjs', import.meta.url).href) as {
  renderR7Diagram: (
    scene: Record<string, unknown>,
    options?: {
      id?: string;
      title?: string;
      alt?: string;
      direction?: 'LR' | 'TB' | 'TD';
      enrichment?: { description?: string; ecosystemIcons?: boolean };
    },
  ) =>
    | ({ kind: 'rendered' } & R7RenderedDiagram)
    | { kind: 'refused'; diagnostics: readonly DiagramViewRefusal[] };
  resolveDossierDiagramScene: (
    section: Record<string, unknown>,
    options?: { ecosystemCatalog?: Record<string, unknown> },
  ) => {
    scene: Record<string, unknown>;
    source: string;
    renderedAsArchitecture: boolean;
    direction: 'LR' | 'TB' | 'TD';
    enrichment?: { title?: string; description?: string; ecosystemIcons?: boolean };
  };
  findLinearChainArchitectureWarning: (
    sectionId: string,
    scene: Record<string, unknown>,
  ) => string | undefined;
};

const kit = new URL('../focus-kit/', import.meta.url);
const readAsset = (name: string): string => readFileSync(new URL(name, kit), 'utf8');
export function readFocusTemplateJson(kind: 'dossier' | 'evidence'): unknown {
  return JSON.parse(readAsset(kind === 'evidence' ? 'dossier.evidence.template.json' : 'dossier.template.json')) as unknown;
}
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const jsonForHtml = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface FocusBuildOptions {
  /** Host-owned opt-in. Dossier fields cannot select executable code. */
  readonly renderer?: 'svelte' | 'vue';
  /** Report is a read-only presentation of the same validated dossier. */
  readonly mode?: 'decision' | 'report';
  /**
   * Output shell. `document` (default) emits the full standalone HTML document
   * for `file://` use, with the offline CSP meta in `<head>`. `artifact`
   * emits a shell-safe fragment (`<title>` + `<style>` + body content, no
   * doctype/html/head/body): claude.ai artifacts wrap pages in their own shell,
   * where a nested document shell breaks rendering and the CSP meta in `<body>`
   * is ignored. The artifact host owns the CSP; see docs/focus/portable-dossiers.md.
   */
  readonly target?: 'document' | 'artifact';
  /** Validated theme CSS text inlined into `<style data-focus-theme>` after base styles. */
  readonly themeCss?: string;
  /** Optional theme identifier set as `data-theme="<id>"` on the document root. */
  readonly themeId?: string;
}

/** Shell-safe fragment for artifact publishing: `<title>` + `<style>` + body content. */
function toArtifactFragment(html: string, themeId?: string, themeStyleBlocks = ''): string {
  const titleStart = html.indexOf('<title>'), titleEnd = html.indexOf('</title>');
  const headEnd = html.indexOf('</head>');
  const styleStart = html.indexOf('<style>');
  const styleEnd = headEnd >= 0 ? html.lastIndexOf('</style>', headEnd) : html.indexOf('</style>');
  const bodyStart = headEnd >= 0 ? html.indexOf('<body>', headEnd) : -1;
  const bodyEnd = html.lastIndexOf('</body>');
  if ([titleStart, titleEnd, headEnd, styleStart, styleEnd, bodyStart, bodyEnd].some(i => i < 0) ||
    !(titleStart < titleEnd && titleEnd < styleStart && styleStart < styleEnd && styleEnd < headEnd && headEnd < bodyStart && bodyStart < bodyEnd)) {
    throw new Error('Invalid Focus renderer asset for artifact target; rebuild the kit');
  }
  const body = html.slice(bodyStart + '<body>'.length, bodyEnd);
  const wrappedBody = themeId !== undefined ? `<div data-theme="${escapeHtml(themeId)}">${body}</div>` : body;
  return `${html.slice(titleStart, titleEnd + '</title>'.length)}\n${html.slice(styleStart, styleEnd + '</style>'.length)}${themeStyleBlocks}\n${wrappedBody}`;
}

export interface FocusBuildOutcome {
  readonly html: string;
  readonly warnings: readonly string[];
}

export interface FocusReleaseBundleOptions extends FocusBuildOptions {
  /** Whether to emit the standalone/fragment HTML output (`true` when writing local `.html`). */
  readonly includeHtml?: boolean;
  /** Whether to assemble the `focus-dossier/1` release JSONs (`dossier.json`, `focus.manifest.json`, `views.json`). */
  readonly includeArtifact?: boolean;
  /** Optional prior `focus.manifest.json` object for R3/R4 revision verification. */
  readonly previousManifest?: unknown;
  /** Optional ISO-8601 timestamp override for manifest revision metadata (tests). */
  readonly createdAt?: string;
}

export interface FocusReleaseArtifactBundle {
  readonly bindingName: string;
  readonly documentDigest: string;
  readonly documentJson: string;
  readonly manifestJson: string;
  readonly viewsJson?: string;
}

export interface FocusReleaseBundleOutcome {
  readonly html?: string;
  readonly warnings: readonly string[];
  readonly artifact?: FocusReleaseArtifactBundle;
}

import { extractFocusRefusals, type FocusExtractedRefusal } from './runtime/mcp/focus-refusals.js';
export { extractFocusRefusals, type FocusExtractedRefusal } from './runtime/mcp/focus-refusals.js';

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildFocusReleaseBundle(
  input: unknown,
  options: FocusReleaseBundleOptions = {}
): FocusReleaseBundleOutcome {
  const includeHtml = options.includeHtml !== false;
  const includeArtifact = options.includeArtifact === true;
  const backend = options.renderer ?? 'svelte';
  if (!['svelte', 'vue'].includes(backend)) throw new Error('Unknown Focus renderer');
  if (options.mode !== undefined && !['decision', 'report'].includes(options.mode)) throw new Error('Unknown Focus presentation mode');
  if (backend !== 'vue' && options.mode === 'report') throw new Error('Report presentation requires the opt-in Vue renderer');
  const target = options.target ?? 'document';
  if (!['document', 'artifact'].includes(target)) throw new Error('Unknown Focus build target');
  const themeId = options.themeId !== undefined ? validateThemeId(options.themeId) : undefined;
  const themeCss = options.themeCss !== undefined ? validateThemeCss(options.themeCss) : undefined;

  let inputDocument: FocusDocument;
  let canonicalDocumentDigest: string;
  let canonicalDocumentJson = '';
  let checkedBindingName = '';
  if (includeArtifact) {
    const checked = checkFocusArtifact(
      input,
      options.previousManifest !== undefined
        ? { previousManifest: options.previousManifest as FocusArtifactManifest }
        : undefined
    );
    if (!checked.ok) {
      const summary = checked.issues.map((i) => `${i.path} ${i.code}: ${i.message}`).join('; ');
      const err = new Error(`invalid DecisionDossierDocument: ${summary}`);
      (err as unknown as { issues: unknown }).issues = checked.issues;
      throw err;
    }
    inputDocument = checked.document;
    canonicalDocumentDigest = checked.documentDigest;
    canonicalDocumentJson = checked.canonicalJson;
    checkedBindingName = checked.bindingName;
  } else {
    // Refuse closed-schema, R2/R5/R6 anchor, doc.ref and bindingName violations before interpreting
    // diagram references, and compute the canonical documentDigest BEFORE any section enrichment.
    // BLOCKED(FA-H1 step 4): enforcing the 1 048 576-byte ceiling inside buildFocusDossier contradicts
    // frozen CI tests in .github/workflows/focus-dossier.yml:
    //   - packages/h2a/focus-kit/test/evidence-browser.test.mjs:122 (8 122 984 bytes via evidence-harness.mjs:13)
    //   - packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs:19-32 (> 30 MB large corpus & 1 596 479-byte doubled corpus, SHA-256 frozen in fixtures/evidence-performance-policy.v1.json)
    // Stopped here without deciding the design; checkFocusArtifact / h2a focus check / h2a_focus_check enforce 1 048 576 bytes by default.
    const artifactChecked = assertFocusArtifact(input, { maxDocumentBytes: null, skipReadability: true });
    inputDocument = artifactChecked.document;
    canonicalDocumentDigest = artifactChecked.documentDigest;
  }

  const catalog = JSON.parse(readAsset('ecosystem.json'));
  const diagramDirections = new Map<string, 'LR' | 'TB' | 'TD'>();
  const diagramEnrichments = new Map<string, { title?: string; description?: string; ecosystemIcons?: boolean }>();
  const architectureRenderedIds = new Set<string>();
  let diagramCount = 0;
  const sections = inputDocument.sections.map(section => {
    if (section.kind !== 'diagram') return section;
    diagramCount++;
    const resolved = resolveDossierDiagramScene(section as unknown as Record<string, unknown>, {
      ecosystemCatalog: catalog,
    });
    diagramDirections.set(section.id, resolved.direction);
    if (resolved.enrichment) diagramEnrichments.set(section.id, resolved.enrichment);
    if (resolved.renderedAsArchitecture) architectureRenderedIds.add(section.id);
    if (section.scene !== undefined) {
      return { ...section, syntax: 'mermaid' as const, source: resolved.source };
    }
    return { ...section, scene: resolved.scene, source: resolved.source };
  });
  const validated: FocusDocument = assertFocusForPresentation({ ...inputDocument, sections });
  if (!diagramCount && !('kind' in validated && validated.kind === 'report')) throw new Error('A Focus dossier needs an ecosystem diagram; add a diagram section with source ecosystem:overview');
  const warnings: string[] = [];
  for (const section of validated.sections) {
    if (section.kind !== 'diagram' || section.scene === undefined) continue;
    if (!architectureRenderedIds.has(section.id)) continue;
    const warning = findLinearChainArchitectureWarning(section.id, section.scene as Record<string, unknown>);
    if (warning !== undefined) warnings.push(warning);
  }
  // Static DS inline SVGs (wide + narrow + optional phone) are rendered here once and reused
  // across both portable HTML emission and derived views.json creation.
  const diagrams: Record<string, R7RenderedDiagram> = Object.create(null);
  for (const section of validated.sections) {
    if (backend === 'vue') break;
    if (section.kind !== 'diagram' || section.scene === undefined) continue;
    const enrichment = diagramEnrichments.get(section.id);
    const outcome = renderR7Diagram(section.scene as Record<string, unknown>, {
      id: section.id,
      title: enrichment?.title ?? section.alt,
      alt: section.alt,
      direction: diagramDirections.get(section.id) ?? 'LR',
      ...(enrichment ? { enrichment: { description: enrichment.description, ecosystemIcons: enrichment.ecosystemIcons } } : {}),
    });
    if (outcome.kind !== 'rendered') throw new DiagramViewRefusalError(section.id, outcome.diagnostics);
    diagrams[section.id] = {
      renderer: outcome.renderer,
      ...(outcome.profile ? { profile: outcome.profile } : {}),
      wide: outcome.wide,
      narrow: outcome.narrow,
      ...(outcome.phone ? { phone: outcome.phone } : {}),
      ...(outcome.processTable ? { processTable: outcome.processTable } : {}),
    };
  }

  let renderer = '';
  let manifest: Record<string, any> = {};
  const validatorText = readAsset('validator.mjs');
  if (backend === 'vue') {
    try { renderer = readAsset('renderer-vue.html'); manifest = JSON.parse(readAsset('renderer-vue-manifest.json')); }
    catch { throw new Error('Vue renderer unavailable: the qualified DS dependency closure and portable assets must be supplied before activation'); }
    if (manifest.backend !== 'vue' || manifest.html !== digest(renderer) || manifest.validator !== digest(validatorText)) {
      throw new Error('Vue renderer integrity mismatch');
    }
  } else if (includeHtml || includeArtifact) {
    manifest = JSON.parse(readAsset('renderer-manifest.json'));
    if (includeHtml) renderer = readAsset('renderer.html');
  }

  let finalHtml: string | undefined;
  if (includeHtml) {
    if (!renderer.includes('<!--FOCUS_PAYLOAD-->') || !renderer.includes('<!--FOCUS_TITLE-->')) throw new Error('Invalid Focus renderer asset; rebuild the kit');
    const build = {
      increment: manifest.increment,
      formats: manifest.formats,
      capabilities: manifest.capabilities,
      rendererVersion: manifest.rendererVersion,
      validatorVersion: manifest.validatorVersion,
      documentDigest: canonicalDocumentDigest,
      envelopeSha256: digest(JSON.stringify(validated)),
      rendererSha256: digest(renderer),
      validatorSha256: digest(validatorText),
    };
    let html = renderer.replace('<!--FOCUS_TITLE-->', () => escapeHtml(validated.title))
      .replace('<!--FOCUS_PAYLOAD-->', () => `<script type="application/json" data-focus-document>${jsonForHtml({ document: validated, diagrams, build, target,
        ...(backend === 'vue' ? { mode: options.mode ?? 'decision' } : {}) })}</script>`);
    if (themeId !== undefined && !html.includes('<html lang="fr">')) {
      throw new Error('Invalid Focus renderer asset: missing root <html> element');
    }
    let themeStyleBlocks = '';
    if (themeCss !== undefined) {
      const rootProps = extractRootThemeCustomProperties(themeCss, themeId);
      const bridgeSelector = themeId !== undefined ? `[data-theme="${themeId}"] [data-st-theme]` : ':root [data-st-theme]';
      const bridgeStyle = rootProps.length > 0
        ? `<style data-focus-theme-bridge>${bridgeSelector}{${rootProps.map(prop => `${prop}:inherit`).join(';')}}</style>`
        : '';
      themeStyleBlocks = `${bridgeStyle}<style data-focus-theme>${themeCss}</style>`;
    }
    if (target === 'artifact') {
      finalHtml = toArtifactFragment(html, themeId, themeStyleBlocks);
    } else {
      if (themeId !== undefined) {
        html = html.replace('<html lang="fr">', () => `<html lang="fr" data-theme="${escapeHtml(themeId)}">`);
      }
      if (themeStyleBlocks !== '') {
        const headCloseIndex = html.indexOf('</head>');
        if (headCloseIndex < 0) {
          throw new Error('Invalid Focus renderer asset: missing </head>');
        }
        html = `${html.slice(0, headCloseIndex)}${themeStyleBlocks}${html.slice(headCloseIndex)}`;
      }
      finalHtml = html;
    }
  }

  let artifact: FocusReleaseArtifactBundle | undefined;
  if (includeArtifact) {
    const htmlAssetName = backend === 'vue' ? 'renderer-vue.html' : 'renderer.html';
    const htmlAssetText = includeHtml ? renderer : readAsset(htmlAssetName);
    const diagramViewsText = backend === 'vue' ? undefined : readAsset('diagram-views.mjs');
    const rendererFiles: FocusManifestFileEntry[] = [
      { path: htmlAssetName, digest: `sha256:${digest(htmlAssetText)}`, bytes: Buffer.byteLength(htmlAssetText, 'utf8') },
      { path: 'validator.mjs', digest: `sha256:${digest(validatorText)}`, bytes: Buffer.byteLength(validatorText, 'utf8') },
      ...(diagramViewsText !== undefined
        ? [{ path: 'diagram-views.mjs', digest: `sha256:${digest(diagramViewsText)}`, bytes: Buffer.byteLength(diagramViewsText, 'utf8') }]
        : []),
    ];
    const staticDigest = rendererManifestDigest(manifest as Readonly<Record<string, unknown>>);
    const rendererSpec: FocusManifestRenderer = {
      name: backend === 'vue' ? '@sentropic/h2a-focus-kit-vue' : '@sentropic/h2a-focus-kit',
      version: typeof manifest.rendererVersion === 'string' && manifest.rendererVersion.length > 0 ? manifest.rendererVersion : readPackageVersion(),
      entry: htmlAssetName,
      digest: staticDigest,
      files: rendererFiles,
      capabilities: Array.isArray(manifest.capabilities)
        ? manifest.capabilities.filter((cap): cap is string => typeof cap === 'string')
        : [],
    };
    const validatorSpec: FocusManifestValidator = {
      name: '@sentropic/focus',
      version: typeof manifest.validatorVersion === 'string' && manifest.validatorVersion.length > 0 ? manifest.validatorVersion : '0.6.0',
      digest: `sha256:${digest(validatorText)}`,
    };
    const generatorSpec = {
      name: '@sentropic/h2a',
      version: readPackageVersion(),
    };

    const viewDiagrams: Record<string, FocusDiagramDerivedEntry> = Object.create(null);
    for (const section of validated.sections) {
      if (section.kind !== 'diagram' || section.scene === undefined) continue;
      const rendered = diagrams[section.id];
      if (!rendered) continue;
      viewDiagrams[section.id] = JSON.parse(
        JSON.stringify({
          scene: section.scene,
          views: rendered,
        })
      ) as FocusDiagramDerivedEntry;
    }

    let viewsJson: string | undefined;
    const derived = [] as ReturnType<typeof buildDerivedFileEntry>[];
    if (Object.keys(viewDiagrams).length > 0) {
      const viewsDoc = buildFocusViewsDocument({
        documentDigest: canonicalDocumentDigest,
        rendererDigest: staticDigest,
        diagrams: viewDiagrams,
      });
      const viewsCheck = validateFocusViewsDocument(viewsDoc, {
        documentDigest: canonicalDocumentDigest,
        rendererDigest: staticDigest,
      });
      if (!viewsCheck.ok) {
        const err = new Error(`invalid derived views.json: ${viewsCheck.issues.map((i) => `${i.path} ${i.code}: ${i.message}`).join('; ')}`);
        (err as unknown as { issues: unknown }).issues = viewsCheck.issues;
        throw err;
      }
      viewsJson = canonicalJsonString(viewsDoc);
      derived.push(buildDerivedFileEntry('views.json', viewsDoc, 'application/json'));
    }

    const manifestDoc = buildFocusArtifactManifest({
      document: inputDocument,
      renderer: rendererSpec,
      validator: validatorSpec,
      generator: generatorSpec,
      derived,
      ...(options.previousManifest !== undefined ? { previousManifest: options.previousManifest as FocusArtifactManifest } : {}),
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
    const manifestCheck = validateFocusArtifactManifest(manifestDoc);
    if (!manifestCheck.ok) {
      const err = new Error(`invalid focus.manifest.json: ${manifestCheck.issues.map((i) => `${i.path} ${i.code}: ${i.message}`).join('; ')}`);
      (err as unknown as { issues: unknown }).issues = manifestCheck.issues;
      throw err;
    }

    artifact = {
      bindingName: checkedBindingName,
      documentDigest: canonicalDocumentDigest,
      documentJson: canonicalDocumentJson,
      manifestJson: canonicalJsonString(manifestDoc),
      ...(viewsJson !== undefined ? { viewsJson } : {}),
    };
  }

  return {
    ...(finalHtml !== undefined ? { html: finalHtml } : {}),
    warnings,
    ...(artifact !== undefined ? { artifact } : {}),
  };
}

export function buildFocusDossierWithDiagnostics(input: unknown, options: FocusBuildOptions = {}): FocusBuildOutcome {
  const outcome = buildFocusReleaseBundle(input, { ...options, includeHtml: true, includeArtifact: false });
  return {
    html: outcome.html!,
    warnings: outcome.warnings,
  };
}

export function buildFocusDossier(input: unknown, options: FocusBuildOptions = {}): string {
  return buildFocusDossierWithDiagnostics(input, options).html;
}

/** Same-directory atomic rename is the only write point; failures preserve the previous file. */
export function writeFocusArtifactFile(output: string, content: string): void {
  const staging = mkdtempSync(join(dirname(output), '.focus-build-'));
  try {
    const pending = join(staging, 'artifact'), fd = openSync(pending, 'wx', 0o600);
    try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(pending, output);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function runFocusCheckSubcommand(args: readonly string[], streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream }): number {
  const usage = 'Usage: h2a focus check <dossier.json> [--previous-manifest <manifest.json>]\n';
  if (args.includes('--help') || args.includes('-h')) { streams.stdout.write(usage); return 0; }
  const input = args[1];
  if (!input || input.startsWith('-')) { streams.stderr.write(usage); return 2; }
  let previousManifestPath: string | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--previous-manifest') {
      const value = args[++i];
      if (previousManifestPath !== undefined || !value || value.startsWith('-')) { streams.stderr.write(usage); return 2; }
      previousManifestPath = value;
    } else {
      streams.stderr.write(usage); return 2;
    }
  }
  try {
    const document = JSON.parse(readFileSync(resolve(input), 'utf8')) as unknown;
    const previousManifest = previousManifestPath !== undefined
      ? JSON.parse(readFileSync(resolve(previousManifestPath), 'utf8')) as unknown
      : undefined;
    const result = checkFocusArtifact(document, previousManifest !== undefined ? { previousManifest } : undefined);
    if (!result.ok) {
      const error = `invalid DecisionDossierDocument: ${result.issues.map(i => `${i.path} ${i.code}: ${i.message}`).join('; ')}`;
      streams.stdout.write(`${JSON.stringify({ ok: false, error, refusals: result.issues })}\n`);
      streams.stderr.write(`h2a focus check: ${error}\n`);
      return 1;
    }
    streams.stdout.write(`${JSON.stringify({
      ok: true,
      documentType: result.documentType,
      schemaId: result.schemaId,
      bindingName: result.bindingName,
      documentDigest: result.documentDigest,
      bytes: result.bytes,
      anchors: result.anchors,
      retiredRefs: result.retiredRefs,
      revisionSeq: result.revisionSeq,
    })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stdout.write(`${JSON.stringify({ ok: false, error: message, refusals: [{ code: 'invalid_json', message }] })}\n`);
    streams.stderr.write(`h2a focus check: ${message}\n`);
    return 1;
  }
}

export function runFocusBuildCli(args: readonly string[], streams = { stdout: process.stdout, stderr: process.stderr }): number {
  const usage = 'Usage: h2a focus build <dossier.json> -o <file.html> [--renderer svelte|vue] [--mode decision|report] [--target document|artifact] [--theme-css <path>] [--theme-id <id>]\n       h2a focus check <dossier.json> [--previous-manifest <manifest.json>]\n       h2a focus template [--evidence] -o <dossier.json>\n';
  if (args[0] === 'check') return runFocusCheckSubcommand(args, streams);
  if (args.includes('--help') || args.includes('-h')) { streams.stdout.write(usage); return 0; }
  const template = args[0] === 'template';
  const buildOptions: { renderer?: 'svelte' | 'vue'; mode?: 'decision' | 'report'; target?: 'document' | 'artifact'; themeId?: string; themeCss?: string } = {};
  let themeCssPath: string | undefined;
  if (!template) {
    const parsed: { renderer?: 'svelte' | 'vue'; mode?: 'decision' | 'report'; target?: 'document' | 'artifact'; themeCssPath?: string; themeId?: string } = {};
    const remaining: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === '--renderer' || flag === '--mode' || flag === '--target' || flag === '--theme-css' || flag === '--theme-id') {
        const key = flag === '--renderer' ? 'renderer'
          : flag === '--mode' ? 'mode'
          : flag === '--target' ? 'target'
          : flag === '--theme-css' ? 'themeCssPath'
          : 'themeId';
        const value = args[++i];
        if (parsed[key] !== undefined || !value || value.startsWith('-')) { streams.stderr.write(usage); return 2; }
        if (key === 'renderer' || key === 'mode' || key === 'target') {
          const allowed = key === 'renderer' ? ['svelte', 'vue'] : key === 'mode' ? ['decision', 'report'] : ['document', 'artifact'];
          if (!allowed.includes(value)) { streams.stderr.write(usage); return 2; }
        }
        Object.assign(parsed, { [key]: value });
      } else remaining.push(flag);
    }
    themeCssPath = parsed.themeCssPath;
    if (parsed.renderer !== undefined) buildOptions.renderer = parsed.renderer;
    if (parsed.mode !== undefined) buildOptions.mode = parsed.mode;
    if (parsed.target !== undefined) buildOptions.target = parsed.target;
    if (parsed.themeId !== undefined) buildOptions.themeId = parsed.themeId;
    args = remaining;
  }
  const evidenceTemplate = template && args[1] === '--evidence';
  if (evidenceTemplate) args = [args[0], ...args.slice(2)];
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
      if (themeCssPath !== undefined) {
        const resolvedCss = resolve(themeCssPath);
        const cssRealPath = realpathSync(resolvedCss);
        if (cssRealPath === existingOutput) throw new Error('Output must differ from the theme CSS file');
        const cssStat = statSync(cssRealPath);
        if (!cssStat.isFile()) throw new Error(`Theme CSS path is not a regular file: ${themeCssPath}`);
        if (cssStat.size > FOCUS_THEME_MAX_CSS_BYTES) {
          throw new Error(`Theme CSS exceeds maximum size of ${FOCUS_THEME_MAX_CSS_BYTES} bytes (256 KiB): got ${cssStat.size} bytes.`);
        }
        buildOptions.themeCss = readFileSync(cssRealPath, 'utf8');
      }
    }
    let html: string;
    let warnings: readonly string[] = [];
    if (template) {
      html = readAsset(evidenceTemplate ? 'dossier.evidence.template.json' : 'dossier.template.json');
    } else {
      const outcome = buildFocusDossierWithDiagnostics(JSON.parse(readFileSync(args[1], 'utf8')), buildOptions);
      html = outcome.html;
      warnings = outcome.warnings;
    }
    writeFocusArtifactFile(output, html);
    for (const warning of warnings) {
      streams.stderr.write(`h2a focus build: warning: ${warning}\n`);
    }
    streams.stdout.write(template ? `Focus template: ${output}\n` : `Focus dossier validated; portable HTML: ${output}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a focus ${args[0]}: ${(error as Error).message}\n`); return 1;
  }
}
