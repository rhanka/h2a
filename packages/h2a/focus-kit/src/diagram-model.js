/**
 * Focus dossier diagram rendering module.
 *
 * Delegates scene validation, Mermaid `flowchart` parsing, layout, static inline SVG
 * rendering (`process@1` and `generic@1`), and accessible process tables to the
 * shared pure DS bridge (`./ds-diagram-bridge.js`) backed by `@sentropic/diagram-canvas`
 * and `@sentropic/diagram-core`.
 *
 * Legacy DC-1 2-column grid view exports (`containmentOf`, `projectionOf`, `interimLayout`,
 * `renderDiagramViews`) are preserved for backward compatibility with existing unit tests only.
 */
import {
  renderCardSvg,
  renderZoneSvg,
  renderProcessTable,
} from '@sentropic/diagram-canvas/diagram-render';
import {
  CARD_GEOMETRY,
  ZONE_GEOMETRY,
  cardLineMeasurer,
  defaultCardMeasure,
  sceneCardMeasure,
} from '@sentropic/diagram-canvas/diagramCardModel';
import { layoutScene } from '@sentropic/diagram-canvas/diagramSceneModel';
import { DIAGRAM_GLYPHS } from '@sentropic/diagram-canvas/diagram-icons';
import {
  FOCUS_PHONE_TARGET_WIDTH,
  FOCUS_PROCESS_TARGET_WIDTH,
  createProcessDirectionExtension,
  findLinearChainArchitectureWarning,
  focusSceneBindings,
  focusSceneRegistry,
  foldableGenericProfile,
  parseFlowchartToScene,
  renderDossierDiagram,
  resolveDossierDiagramScene,
  sceneToMermaidFallback,
  validateCheckedFocusScene,
} from './ds-diagram-bridge.js';

export const DS_RENDER_PRIMITIVES = {
  renderCardSvg,
  renderZoneSvg,
  renderProcessTable,
  DIAGRAM_GLYPHS,
  CARD_GEOMETRY,
  ZONE_GEOMETRY,
  cardLineMeasurer,
  defaultCardMeasure,
  sceneCardMeasure,
  layoutScene,
};

/** Render a validated Focus generic@1 or process@1 scene as static offline DS SVG variants. */
export function renderR7Diagram(document, options = {}) {
  return renderDossierDiagram(document, options);
}

export {
  FOCUS_PHONE_TARGET_WIDTH,
  FOCUS_PROCESS_TARGET_WIDTH,
  createProcessDirectionExtension,
  findLinearChainArchitectureWarning,
  focusSceneBindings,
  focusSceneRegistry,
  foldableGenericProfile,
  parseFlowchartToScene,
  renderDossierDiagram,
  resolveDossierDiagramScene,
  sceneToMermaidFallback,
  validateCheckedFocusScene,
  renderCardSvg,
  renderZoneSvg,
  renderProcessTable,
  DIAGRAM_GLYPHS,
  CARD_GEOMETRY,
  ZONE_GEOMETRY,
  cardLineMeasurer,
  defaultCardMeasure,
  sceneCardMeasure,
  layoutScene,
};

// ---------------------------------------------------------------------------
// Legacy DC-1 2-column grid card/zone views (kept for existing unit tests only).
// ---------------------------------------------------------------------------
const CARD = { width: 460, height: 200 };
const ZONE_INSET = 16;
const GRID = { columns: 2, columnGap: 60, rowGap: 50 };

/** @deprecated Legacy DC-1 helper; default Focus builds use `renderR7Diagram`. */
export function containmentOf(document) {
  const children = new Map([[undefined, []]]);
  const parents = new Map();
  for (const relation of Object.values(document.relations)) {
    if (relation.type !== 'contains') continue;
    const parent = relation.endpoints.find((e) => e.role === 'parent').target;
    const child = relation.endpoints.find((e) => e.role === 'child').target;
    parents.set(child, parent);
  }
  for (const entity of Object.values(document.entities)) {
    const parent = parents.get(entity.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  return { children, parents };
}

/** @deprecated Legacy DC-1 projection; default Focus builds use `renderR7Diagram`. */
export function projectionOf(entity) {
  return { entityId: entity.id, kicker: entity.type, title: entity.attributes.name.value };
}

/** @deprecated Legacy DC-1 2-column placement; default Focus builds use `renderR7Diagram`. */
export function interimLayout(document) {
  const { children, parents } = containmentOf(document);
  const zones = new Set(
    Object.values(document.entities)
      .filter((entity) => entity.type === 'container' && (children.get(entity.id)?.length ?? 0) > 0)
      .map((entity) => entity.id),
  );
  const widths = new Map();
  const widthOf = (entityId) => {
    if (widths.has(entityId)) return widths.get(entityId);
    let width = CARD.width;
    if (zones.has(entityId)) {
      const siblings = children.get(entityId) ?? [];
      let max = CARD.width + 2 * ZONE_INSET;
      let row = ZONE_INSET;
      const flush = () => {
        max = Math.max(max, row + ZONE_INSET);
      };
      for (const [index, sibling] of siblings.entries()) {
        if (index % GRID.columns === 0 && index) {
          flush();
          row = ZONE_INSET;
        }
        row += (row > ZONE_INSET ? GRID.columnGap : 0) + widthOf(sibling.id);
      }
      flush();
      width = max;
    }
    widths.set(entityId, width);
    return width;
  };
  const refusals = [];
  const contentTops = new Map();
  for (const zoneId of zones) {
    const probe = renderZoneSvg(
      { ...projectionOf(document.entities[zoneId]), collapsed: false, x: 0, y: 0, width: widthOf(zoneId) },
      { children: [] },
    );
    if (probe.kind === 'refused') refusals.push(...probe.diagnostics);
    else contentTops.set(zoneId, probe.layout.header.contentTop);
  }
  const nodes = [];
  const boxes = new Map();
  if (refusals.length === 0) place(undefined);
  function place(parentId) {
    const siblings = children.get(parentId) ?? [];
    const parented = parentId !== undefined;
    let rowY = parented ? contentTops.get(parentId) : 0;
    let rowHeight = 0;
    let x = parented ? ZONE_INSET : 0;
    for (const [index, entity] of siblings.entries()) {
      const size = zones.has(entity.id)
        ? { width: widthOf(entity.id), height: place(entity.id).height }
        : CARD;
      if (zones.has(entity.id)) boxes.set(entity.id, size);
      if (index % GRID.columns === 0 && index) {
        rowY += rowHeight + GRID.rowGap;
        x = parented ? ZONE_INSET : 0;
        rowHeight = 0;
      }
      nodes.push({
        id: entity.id,
        type: 'ecosystem',
        position: { x, y: rowY },
        ...(parented ? { parentId, extent: 'parent' } : {}),
        ...(zones.has(entity.id) ? { style: `width: ${size.width}px; height: ${size.height}px;` } : {}),
        data: { label: entity.attributes.name.value, container: zones.has(entity.id) },
      });
      x += size.width + GRID.columnGap;
      rowHeight = Math.max(rowHeight, size.height);
    }
    return { height: rowY + rowHeight + ZONE_INSET };
  }
  const depth = (id) => {
    let n = 0;
    for (; parents.has(id); id = parents.get(id)) n++;
    return n;
  };
  nodes.sort((a, b) => depth(a.id) - depth(b.id));
  return { nodes, boxes, contentTops, refusals };
}

/** @deprecated Legacy DC-1 per-entity SVG view renderer; default Focus builds use `renderR7Diagram`. */
export function renderDiagramViews(document, options = {}) {
  const layout = interimLayout(document);
  if (layout.refusals.length) return { kind: 'refused', diagnostics: layout.refusals };
  const align = options.align === 'center' ? { align: 'center' } : {};
  const views = {};
  const refusals = [];
  for (const entity of Object.values(document.entities)) {
    const props = { ...projectionOf(entity), ...align };
    if (!layout.boxes.has(entity.id)) {
      const card = renderCardSvg({ ...props, body: [] });
      if (card.kind === 'refused') refusals.push(...card.diagnostics);
      else views[entity.id] = { kind: 'card', svg: card.svg };
      continue;
    }
    const { width, height } = layout.boxes.get(entity.id);
    const expanded = renderZoneSvg({ ...props, collapsed: false, x: 0, y: 0, width, height }, { children: [] });
    const folded = expanded.kind === 'rendered'
      ? renderZoneSvg({ ...props, collapsed: true, x: 0, y: 0, toggleLabel: `Déplier : ${entity.attributes.name.value}` }, { children: [] })
      : null;
    if (expanded.kind === 'refused' || folded?.kind === 'refused') {
      refusals.push(...(expanded.kind === 'refused' ? expanded.diagnostics : []));
      if (folded?.kind === 'refused') refusals.push(...folded.diagnostics);
    } else {
      views[entity.id] = { kind: 'zone', svg: expanded.svg, foldedSvg: folded.svg };
    }
  }
  return refusals.length ? { kind: 'refused', diagnostics: refusals } : { kind: 'rendered', views };
}
