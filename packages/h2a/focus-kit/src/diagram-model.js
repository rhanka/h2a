/** DC-1 diagram views for the Focus dossier: the design-system card/zone renderers turn
 * every diagram entity into an embedded SVG at build time; the view only places them.
 * One source for both sides, so the frame the build renders into SVG is the exact box the
 * renderer applies at view time. Cards are fixed 460x200 and refuse instead of truncating;
 * containers with children are zones, and their folded form is rendered here for DC-3.
 * The interim grid keeps the Focus engine numbers: 2 columns, 60px gutter, 50px row gap. */
import { renderCardSvg, renderZoneSvg } from '@sentropic/design-system-svelte/diagram-render';

const CARD = { width: 460, height: 200 };
const ZONE_INSET = 16;
const GRID = { columns: 2, columnGap: 60, rowGap: 50 };

export function containmentOf(document) {
  const children = new Map([[undefined, []]]);
  const parents = new Map();
  for (const relation of Object.values(document.relations)) {
    if (relation.type !== 'contains') continue;
    const parent = relation.endpoints.find(e => e.role === 'parent').target;
    const child = relation.endpoints.find(e => e.role === 'child').target;
    parents.set(child, parent);
  }
  for (const entity of Object.values(document.entities)) {
    const parent = parents.get(entity.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  return { children, parents };
}

/** DC-1 projection of a generic@1 element: the element kind is the kicker, the name the
 * title. No other slot: no invented icon, footer, tone or subtitle. */
export function projectionOf(entity) {
  return { entityId: entity.id, kicker: entity.type, title: entity.attributes.name.value };
}

/** Interim placement: xyflow nodes plus the DC-1 frame sizes. Zone headers are measured
 * by the design-system renderer itself (the probe layout), never by a hand-tuned inset.
 * A refused probe (for example a title too wide even for two lines) aborts placement. */
export function interimLayout(document) {
  const { children, parents } = containmentOf(document);
  const zones = new Set(Object.values(document.entities)
    .filter(entity => entity.type === 'container' && (children.get(entity.id)?.length ?? 0) > 0)
    .map(entity => entity.id));
  const widths = new Map();
  const widthOf = (entityId) => {
    if (widths.has(entityId)) return widths.get(entityId);
    let width = CARD.width;
    if (zones.has(entityId)) {
      const siblings = children.get(entityId) ?? [];
      let max = CARD.width + 2 * ZONE_INSET, row = ZONE_INSET;
      const flush = () => { max = Math.max(max, row + ZONE_INSET); };
      for (const [index, sibling] of siblings.entries()) {
        if (index % GRID.columns === 0 && index) { flush(); row = ZONE_INSET; }
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
    const probe = renderZoneSvg({ ...projectionOf(document.entities[zoneId]), collapsed: false, x: 0, y: 0, width: widthOf(zoneId) }, { children: [] });
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
    let rowHeight = 0, x = parented ? ZONE_INSET : 0;
    for (const [index, entity] of siblings.entries()) {
      const size = zones.has(entity.id)
        ? { width: widthOf(entity.id), height: place(entity.id).height }
        : CARD;
      if (zones.has(entity.id)) boxes.set(entity.id, size);
      if (index % GRID.columns === 0 && index) { rowY += rowHeight + GRID.rowGap; x = parented ? ZONE_INSET : 0; rowHeight = 0; }
      nodes.push({ id: entity.id, type: 'ecosystem', position: { x, y: rowY },
        ...(parented ? { parentId, extent: 'parent' } : {}),
        ...(zones.has(entity.id) ? { style: `width: ${size.width}px; height: ${size.height}px;` } : {}),
        data: { label: entity.attributes.name.value, container: zones.has(entity.id) } });
      x += size.width + GRID.columnGap;
      rowHeight = Math.max(rowHeight, size.height);
    }
    return { height: rowY + rowHeight + ZONE_INSET };
  }
  const depth = (id) => { let n = 0; for (; parents.has(id); id = parents.get(id)) n++; return n; };
  nodes.sort((a, b) => depth(a.id) - depth(b.id));
  return { nodes, boxes, contentTops, refusals };
}

export function interimNodes(document) {
  const layout = interimLayout(document);
  if (layout.refusals.length) {
    throw new Error(`Diagram placement refused: ${layout.refusals.map(d => `${d.code} ${d.slot} ${d.entityId}`).join('; ')}`);
  }
  return layout.nodes;
}

/** Every diagram entity as an embedded DC-1 view, or a typed refusal. Nodes and childless
 * containers are cards; containers with children are zones with their folded card face. */
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
