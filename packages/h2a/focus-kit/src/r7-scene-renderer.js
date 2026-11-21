/**
 * Deterministic `generic@1` -> static r7 offline inline SVG renderer for Focus dossiers.
 *
 * Provenance:
 * - Orthogonal grid placement, nested zone insets, channel widening, orthogonal candidate routing
 *   (straight / L / Z / U / 3-bend), and collision-free edge pill placement adapted from
 *   `simple-diagrams/dossier/archive/v6-svg/figkit/fold-engine.mjs` over the vendored `r7-diagram-kit.js`.
 * - Catalog node body wrapping & ecosystem DS icon mapping ported from `mem7-dossier/diagrams.mjs:1353-1416`.
 * - Strictly polynomial time, deterministic (same input -> identical SVG bytes), zero network calls,
 *   zero runtime dependencies beyond the bundled DS 0.37 pure SVG card/zone painters.
 */
import {
  CARD_W,
  CARD_H,
  EDGE_STYLES,
  PILL_FONT,
  PILL_LINE,
  createR7Kit,
  R7RefusalError,
} from './r7-diagram-kit.js';

const ROW_CHANNEL = 136;
const COL_CHANNEL = 156;
const NARROW_CHANNEL = 128;
const ZONE_PAD = 24;
const ZONE_GAP = 14;
const MAX_COLS = 4;

const ECOSYSTEM_ICONS = {
  'entity:h2a': 'robot',
  'entity:cluster-mesh': 'cluster',
  'entity:llm-gateway': 'api',
  'entity:llm-mesh': 'llm',
  'entity:track': 'check',
  'entity:engram': 'brain',
  'entity:design-system': 'window',
  'entity:sentropic-apps': 'web',
  'entity:codex': 'workstation',
  'entity:claude': 'workstation',
  'entity:vibe': 'workstation',
  'entity:sentropic-cli': 'workstation',
};

const r2 = (v) => Math.round(v * 100) / 100;
const rectOf = (x, y, w, h) => ({ x, y, w, h });
const inflate = (b, d) => rectOf(b.x - d, b.y - d, b.w + 2 * d, b.h + 2 * d);
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
const legRect = (a, b, half = 0) =>
  a[1] === b[1]
    ? rectOf(Math.min(a[0], b[0]), a[1] - half, Math.abs(a[0] - b[0]), 2 * half)
    : rectOf(a[0] - half, Math.min(a[1], b[1]), 2 * half, Math.abs(a[1] - b[1]));
const segLen = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const strictlyInside = (p, b) => p[0] > b.x + 0.5 && p[0] < b.x + b.w - 0.5 && p[1] > b.y + 0.5 && p[1] < b.y + b.h - 0.5;
const headOf = (style) => EDGE_STYLES[style].head;
const lastLegMin = (style) => Math.max(headOf(style) + 8, 20);

function splitLabel(label) {
  const at = label.lastIndexOf(' · ');
  if (at > 0) return [label.slice(0, at), label.slice(at + 3)];
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [label];
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const gap = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function wrapBodyLines(text, ds) {
  if (!text || !String(text).trim()) return [];
  const raw = String(text).trim();
  const explicitLines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const avail = 436;
  const fitsLine = (line) => {
    const m = ds.defaultCardMeasure(line, 'body', avail, 1);
    return !m.tooWide && m.lines.length <= 1;
  };
  if (explicitLines.length <= 2 && explicitLines.every(fitsLine)) return explicitLines;
  const joined = explicitLines.join(' ');
  const m = ds.defaultCardMeasure(joined, 'body', avail, 2);
  if (!m.tooWide && m.lines.length <= 2) return [...m.lines];
  // Balance onto two lines if greedy wrap slightly skewed, otherwise return measured lines so DS validates/refuses cleanly.
  const words = joined.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let i = Math.ceil(words.length / 2); i >= 1; i--) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      if (fitsLine(a) && fitsLine(b)) return [a, b];
    }
  }
  return [...m.lines];
}

function parseCatalogRoles(description) {
  const roles = new Map();
  if (!description) return roles;
  for (const line of String(description).split(/\r?\n/)) {
    const idx = line.indexOf(' : ');
    if (idx > 0) roles.set(line.slice(0, idx).trim(), line.slice(idx + 3).trim());
  }
  return roles;
}

function textAttrValue(entity, field) {
  const attr = entity?.attributes?.[field];
  return attr && attr.kind === 'text' && typeof attr.value === 'string' && attr.value.trim() ? attr.value.trim() : undefined;
}

/** Extract containment tree, nodes, zones and directed links from a generic@1 document. */
function extractModel(document, ds, options = {}) {
  const children = new Map([[null, []]]);
  const parentOf = new Map();
  const links = [];

  for (const rel of Object.values(document.relations ?? {})) {
    if (rel.type === 'contains') {
      const parent = rel.endpoints.find((e) => e.role === 'parent').target;
      const child = rel.endpoints.find((e) => e.role === 'child').target;
      parentOf.set(child, parent);
    } else if (rel.type === 'link') {
      const from = rel.endpoints.find((e) => e.role === 'source').target;
      const to = rel.endpoints.find((e) => e.role === 'target').target;
      const label = textAttrValue(rel, 'label') ?? '';
      links.push({ id: rel.id, from, to, label, style: 'link' });
    }
  }

  for (const entity of Object.values(document.entities ?? {})) {
    const parent = parentOf.get(entity.id) ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity.id);
  }

  const catalogRoles = parseCatalogRoles(options.enrichment?.description);
  const useEcosystemIcons = Boolean(options.enrichment?.ecosystemIcons);

  const nodes = new Map();
  for (const entity of Object.values(document.entities ?? {})) {
    const kids = children.get(entity.id) ?? [];
    const isZone = entity.type === 'container' && kids.length > 0;
    const title = entity.attributes.name.value;
    const kicker = textAttrValue(entity, 'kicker');
    const footer = textAttrValue(entity, 'footer');
    const explicitDesc = textAttrValue(entity, 'description');
    const catalogDesc = catalogRoles.get(title);
    const bodyText = explicitDesc ?? catalogDesc;
    const rawIcon = textAttrValue(entity, 'icon') ?? (useEcosystemIcons ? ECOSYSTEM_ICONS[entity.id] : undefined);
    const icon = rawIcon && ds.DIAGRAM_GLYPHS[rawIcon] ? rawIcon : undefined;

    nodes.set(entity.id, {
      id: entity.id,
      kind: isZone ? 'zone' : 'card',
      parent: parentOf.get(entity.id) ?? null,
      children: kids,
      title,
      kicker,
      footer,
      icon,
      body: isZone ? [] : wrapBodyLines(bodyText, ds),
      subtitle: isZone && bodyText ? bodyText : undefined,
    });
  }

  // Depth of each node in the containment tree.
  const depthOf = (id) => {
    let d = 0;
    for (let cur = parentOf.get(id); cur !== undefined; cur = parentOf.get(cur)) d++;
    return d;
  };
  for (const n of nodes.values()) n.depth = depthOf(n.id);

  return { nodes, children, parentOf, links, root: children.get(null) ?? [] };
}

/** Project any node id up to the direct child of `scopeParent` (or null if outside). */
function liftToScope(id, scopeParent, parentOf) {
  let cur = id;
  while (cur !== undefined && cur !== null) {
    const p = parentOf.get(cur) ?? null;
    if (p === scopeParent) return cur;
    cur = p;
  }
  return null;
}

/** Compute a clean deterministic 2D grid for the direct children of `scopeParent`. */
function computeScopeGrid(scopeParent, memberIds, model, direction) {
  if (memberIds.length === 0) return [];
  if (memberIds.length === 1) return [[memberIds[0]]];

  const memberSet = new Set(memberIds);
  const indexMap = new Map(memberIds.map((id, i) => [id, i]));
  const adj = new Map(memberIds.map((id) => [id, []]));
  const inDeg = new Map(memberIds.map((id) => [id, 0]));
  const seenEdge = new Set();

  for (const e of model.links) {
    const u = liftToScope(e.from, scopeParent, model.parentOf);
    const v = liftToScope(e.to, scopeParent, model.parentOf);
    if (!u || !v || u === v || !memberSet.has(u) || !memberSet.has(v)) continue;
    const key = `${u}>${v}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    adj.get(u).push(v);
    inDeg.set(v, inDeg.get(v) + 1);
  }

  // Topological order (Kahn's algorithm, breaking cycles deterministically by original declaration order).
  const remaining = new Set(memberIds);
  const topo = [];
  const deg = new Map(inDeg);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => deg.get(id) === 0).sort((a, b) => indexMap.get(a) - indexMap.get(b));
    const pick = ready.length > 0 ? ready[0] : [...remaining].sort((a, b) => indexMap.get(a) - indexMap.get(b))[0];
    remaining.delete(pick);
    topo.push(pick);
    for (const next of adj.get(pick)) {
      if (remaining.has(next)) deg.set(next, Math.max(0, deg.get(next) - 1));
    }
  }

  // Forward-only DAG edges along topo order for longest-path layering.
  const topoPos = new Map(topo.map((id, i) => [id, i]));
  const rank = new Map(topo.map((id) => [id, 0]));
  const preds = new Map(topo.map((id) => [id, []]));
  for (const u of topo) {
    for (const v of adj.get(u)) {
      if (topoPos.get(u) < topoPos.get(v)) {
        rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
        preds.get(v).push(u);
      }
    }
  }

  const maxRank = Math.max(0, ...rank.values());
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of topo) layers[rank.get(id)].push(id);

  // Order within each layer by barycenter of predecessors to minimize crossings.
  const rowIdx = new Map();
  layers[0].forEach((id, i) => rowIdx.set(id, i));
  for (let r = 1; r < layers.length; r++) {
    layers[r].sort((a, b) => {
      const avg = (id) => {
        const ps = preds.get(id);
        if (!ps.length) return indexMap.get(id);
        return ps.reduce((s, p) => s + (rowIdx.get(p) ?? 0), 0) / ps.length;
      };
      return avg(a) - avg(b) || indexMap.get(a) - indexMap.get(b);
    });
    layers[r].forEach((id, i) => rowIdx.set(id, i));
  }

  const isVertical = direction === 'TB' || direction === 'TD';
  const totalEdges = seenEdge.size;

  // No inter-member edges (e.g. sibling comparison zones or flat items): place side-by-side up to 3 columns.
  if (totalEdges === 0) {
    const cols = memberIds.length <= 3 ? memberIds.length : Math.min(MAX_COLS, Math.ceil(Math.sqrt(memberIds.length)));
    const grid = [];
    for (let i = 0; i < memberIds.length; i += cols) grid.push(memberIds.slice(i, i + cols));
    return grid;
  }

  if (isVertical) {
    // Layers become rows; wrap any overly wide layer at MAX_COLS.
    const grid = [];
    for (const layer of layers) {
      for (let i = 0; i < layer.length; i += MAX_COLS) grid.push(layer.slice(i, i + MAX_COLS));
    }
    return grid;
  }

  // Horizontal LR flow:
  // If long narrow pipeline (> MAX_COLS layers and average <= 1.5 nodes/layer), wrap in serpentine rows of MAX_COLS
  // so every chain step is adjacent and card legibility stays high (~0.5 scale on 1440px screens).
  const avgPerLayer = memberIds.length / layers.length;
  if (layers.length > MAX_COLS && avgPerLayer <= 1.5) {
    const cols = MAX_COLS;
    const rows = Math.ceil(topo.length / cols);
    const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let i = 0; i < topo.length; i++) {
      const r = Math.floor(i / cols);
      const offset = i % cols;
      const c = r % 2 === 0 ? offset : cols - 1 - offset;
      grid[r][c] = topo[i];
    }
    return grid;
  }

  // Wide multi-layer DAG with > MAX_COLS layers (e.g. ecosystem:overview with 5 layers):
  // Keep up to 5 columns when every layer is compact so left-to-right reading stays crystal clear.
  const maxLayerHeight = Math.max(...layers.map((l) => l.length));
  const grid = Array.from({ length: maxLayerHeight }, () => Array(layers.length).fill(null));
  for (let c = 0; c < layers.length; c++) {
    const layer = layers[c];
    for (let r = 0; r < layer.length; r++) grid[r][c] = layer[r];
  }
  return grid;
}

/** Deterministic topological sequence for the single-column narrow layout, respecting zone grouping. */
function computeNarrowOrder(scopeParent, model) {
  const memberIds = scopeParent === null ? model.root : model.nodes.get(scopeParent).children;
  if (memberIds.length <= 1) return [...memberIds];
  const memberSet = new Set(memberIds);
  const indexMap = new Map(memberIds.map((id, i) => [id, i]));
  const adj = new Map(memberIds.map((id) => [id, []]));
  const deg = new Map(memberIds.map((id) => [id, 0]));
  const seen = new Set();
  for (const e of model.links) {
    const u = liftToScope(e.from, scopeParent, model.parentOf);
    const v = liftToScope(e.to, scopeParent, model.parentOf);
    if (!u || !v || u === v || !memberSet.has(u) || !memberSet.has(v)) continue;
    const key = `${u}>${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    adj.get(u).push(v);
    deg.set(v, deg.get(v) + 1);
  }
  const remaining = new Set(memberIds);
  const out = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => deg.get(id) === 0).sort((a, b) => indexMap.get(a) - indexMap.get(b));
    const pick = ready.length > 0 ? ready[0] : [...remaining].sort((a, b) => indexMap.get(a) - indexMap.get(b))[0];
    remaining.delete(pick);
    out.push(pick);
    for (const next of adj.get(pick)) if (remaining.has(next)) deg.set(next, Math.max(0, deg.get(next) - 1));
  }
  return out;
}

/** Greedy crossing-minimizing rail assignment for narrow single-column layout (strictly polynomial). */
function assignNarrowRails(seq, links, leftRailStart, rightRailStart, railStep) {
  const idx = new Map(seq.map((id, i) => [id, i]));
  const longEdges = [];
  for (const e of links) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > 1) longEdges.push({ id: e.id, lo: Math.min(a, b), hi: Math.max(a, b) });
  }
  // Sort shortest spans first so inner rails stay close to the card column.
  longEdges.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo);

  const leftTracks = []; // array of arrays of intervals
  const rightTracks = [];
  const lanes = new Map();

  const fitsTrack = (track, item) => track.every((other) => other.hi <= item.lo || item.hi <= other.lo);
  const placeOnSide = (tracks, item) => {
    for (let t = 0; t < tracks.length; t++) {
      if (fitsTrack(tracks[t], item)) {
        tracks[t].push(item);
        return t;
      }
    }
    tracks.push([item]);
    return tracks.length - 1;
  };

  for (const item of longEdges) {
    // Prefer right side first, balancing with left side to keep total rail depth minimal.
    let bestSide = 'r';
    let bestTrack = rightTracks.findIndex((tr) => fitsTrack(tr, item));
    const leftFit = leftTracks.findIndex((tr) => fitsTrack(tr, item));
    if (bestTrack < 0 && leftFit >= 0) {
      bestSide = 'l';
      bestTrack = leftFit;
    } else if (bestTrack < 0 && leftFit < 0) {
      bestSide = rightTracks.length <= leftTracks.length ? 'r' : 'l';
    } else if (leftFit >= 0 && leftFit < bestTrack) {
      bestSide = 'l';
      bestTrack = leftFit;
    }
    if (bestSide === 'r') {
      const t = placeOnSide(rightTracks, item);
      lanes.set(item.id, { side: 'r', track: t, x: rightRailStart + t * railStep });
    } else {
      const t = placeOnSide(leftTracks, item);
      lanes.set(item.id, { side: 'l', track: t, x: leftRailStart - t * railStep });
    }
  }
  return { lanes, leftCount: leftTracks.length, rightCount: rightTracks.length };
}

function createRouter(kit, ctx, { allowPerpendicularCrossings = false } = {}) {
  const { solids, zoneFrames, zoneTexts, canvasW } = ctx;
  const placed = [];
  const pills = [];

  const pillSize = (lines) => ({
    w: Math.ceil(Math.max(...lines.map((l) => kit.boldWidth(l, PILL_FONT))) * 1.04 + 40),
    h: lines.length * PILL_LINE + 20,
  });

  const legOk = (a, b, style, bundle, selfId) => {
    const w = EDGE_STYLES[style].width;
    const L0 = legRect(a, b, w / 2);
    for (const c of solids) if (intersects(L0, inflate(c, -1))) return false;
    const Lt = legRect(a, b, w / 2 + 6);
    for (const t of zoneTexts) if (intersects(Lt, t)) return false;
    const aHoriz = Math.abs(a[1] - b[1]) < 0.05;
    const Le = legRect(a, b, w / 2 + 3);
    for (const o of placed) {
      if (o.id === selfId) continue;
      if (bundle && o.bundle === bundle) continue;
      const ow = EDGE_STYLES[o.style].width;
      for (let j = 0; j < o.points.length - 1; j++) {
        const bHoriz = Math.abs(o.points[j][1] - o.points[j + 1][1]) < 0.05;
        if (allowPerpendicularCrossings && aHoriz !== bHoriz) continue;
        if (intersects(Le, legRect(o.points[j], o.points[j + 1], ow / 2 + 3))) return false;
      }
    }
    const Lp = legRect(a, b, w / 2 + 2);
    for (const p of pills) {
      if (bundle && p.bundle === bundle) continue;
      if (intersects(Lp, p)) return false;
    }
    if (canvasW && (Math.min(a[0], b[0]) < 6 || Math.max(a[0], b[0]) > canvasW - 6)) return false;
    if (Math.min(a[1], b[1]) < 6) return false;
    return true;
  };

  const pillOk = (p, bundle) => {
    if (p.x < 6 || p.y < 6) return false;
    if (canvasW && p.x + p.w > canvasW - 6) return false;
    for (const c of solids) if (intersects(inflate(p, 6), c)) return false;
    for (const t of zoneTexts) if (intersects(inflate(p, 6), t)) return false;
    for (const z of zoneFrames) if (intersects(p, z) && !contains(z, p)) return false;
    for (const q of pills) {
      if (bundle && q.bundle === bundle) continue;
      if (intersects(inflate(p, 8), q)) return false;
    }
    for (const o of placed) {
      if (bundle && o.bundle === bundle) continue;
      const ow = EDGE_STYLES[o.style].width;
      for (let j = 0; j < o.points.length - 1; j++) {
        if (intersects(legRect(o.points[j], o.points[j + 1], ow / 2 + 2), p)) return false;
      }
    }
    return true;
  };

  const placePill = (pts, style, label, bundle) => {
    if (!label) return null;
    const variants = [[label]];
    const two = splitLabel(label);
    if (two.length === 2) variants.push(two);
    const order = pts
      .slice(0, -1)
      .map((p, i) => ({ i, len: segLen(p, pts[i + 1]) }))
      .sort((a, b) => b.len - a.len || a.i - b.i);
    const head = headOf(style);
    for (const lines of variants) {
      const size = pillSize(lines);
      for (const { i } of order) {
        const a = pts[i];
        const b = pts[i + 1];
        const horizontal = Math.abs(a[1] - b[1]) < 0.05;
        const along = horizontal ? size.w : size.h;
        const len = segLen(a, b);
        const first = i === 0;
        const last = i === pts.length - 2;
        const needStart = first ? 20 : 6;
        const needEnd = last ? head + 14 : 6;
        if (len < along + needStart + needEnd + 1) continue;
        const cMin = needStart + 0.5 + along / 2;
        const cMax = len - needEnd - 0.5 - along / 2;
        const ts = new Set();
        const mid = Math.min(Math.max(len / 2, cMin), cMax);
        ts.add(mid / len);
        for (let k = 0; k <= 16; k++) ts.add((cMin + ((cMax - cMin) * k) / 16) / len);
        const tList = [...ts].sort((p, q) => Math.abs(p - 0.5) - Math.abs(q - 0.5));
        for (const t of tList) {
          const cx = a[0] + (b[0] - a[0]) * t;
          const cy = a[1] + (b[1] - a[1]) * t;
          const p = { x: r2(cx - size.w / 2), y: r2(cy - size.h / 2), w: size.w, h: size.h };
          const forward = horizontal ? b[0] > a[0] : b[1] > a[1];
          const lo = horizontal ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
          const hi = horizontal ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
          const pLo = horizontal ? p.x : p.y;
          const pHi = pLo + along;
          const startStub = forward ? pLo - lo : hi - pHi;
          const endStub = forward ? hi - pHi : pLo - lo;
          if (startStub < needStart + 0.5 || endStub < needEnd + 0.5) continue;
          if (!pillOk(p, bundle)) continue;
          return { segIndex: i, t, lines, rect: p };
        }
      }
    }
    return null;
  };

  const routeOk = (pts, e, src, dst) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05) return false;
      const min = i === pts.length - 2 ? lastLegMin(e.style) : 14;
      if (segLen(a, b) < min) return false;
      if (!legOk(a, b, e.style, e.bundle, e.id)) return false;
    }
    if (strictlyInside(pts[1], src) || strictlyInside(pts.at(-2), dst)) return false;
    for (let i = 1; i < pts.length - 1; i++) {
      const d1 = [Math.sign(pts[i][0] - pts[i - 1][0]), Math.sign(pts[i][1] - pts[i - 1][1])];
      const d2 = [Math.sign(pts[i + 1][0] - pts[i][0]), Math.sign(pts[i + 1][1] - pts[i][1])];
      if (d1[0] === -d2[0] && d1[1] === -d2[1]) return false;
      if (d1[0] === d2[0] && d1[1] === d2[1]) return false;
    }
    return true;
  };

  const port = (b, side, t) => {
    if (side === 'l') return [b.x, r2(b.y + b.h * t)];
    if (side === 'r') return [b.x + b.w, r2(b.y + b.h * t)];
    if (side === 't') return [r2(b.x + b.w * t), b.y];
    return [r2(b.x + b.w * t), b.y + b.h];
  };
  const outward = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
  const H = (s) => s === 'l' || s === 'r';
  const T = [0.5, 0.3, 0.7, 0.4, 0.6, 0.2, 0.8];
  const TDEEP = [0.5, 0.3, 0.7, 0.2, 0.8];
  const FINE = [0.5, 0.35, 0.65, 0.25, 0.75, 0.42, 0.58, 0.18, 0.82];

  function candidates(e, src, dst, deep) {
    const out = [];
    const lane = ctx.lanes?.get(e.id);
    const XS = lane !== undefined ? [lane.x, ...ctx.xs.filter((x) => x !== lane.x)] : ctx.xs;
    const add = (pts, sides, k, tA, tB) => {
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) len += segLen(pts[i], pts[i + 1]);
      const cost = len + k * 260 + (Math.abs(tA - 0.5) + Math.abs(tB - 0.5)) * 120;
      out.push({ pts, sides, k, cost, tA, tB });
    };

    if (deep) {
      const sides = ['l', 'r', 't', 'b'];
      for (const sa of sides) {
        for (const sb of sides) {
          if (H(sa) === H(sb)) continue;
          for (const tA of TDEEP) {
            for (const tB of TDEEP) {
              const A = port(src, sa, tA);
              const B = port(dst, sb, tB);
              const oa = outward[sa];
              const ob = outward[sb];
              if (H(sa)) {
                for (const x of XS) {
                  if ((x - A[0]) * oa[0] < 14) continue;
                  for (const y of ctx.ys) {
                    if ((y - B[1]) * ob[1] < lastLegMin(e.style)) continue;
                    add([A, [x, A[1]], [x, y], [B[0], y], B], [sa, sb], 3, tA, tB);
                  }
                }
              } else {
                for (const y of ctx.ys) {
                  if ((y - A[1]) * oa[1] < 14) continue;
                  for (const x of XS) {
                    if ((x - B[0]) * ob[0] < lastLegMin(e.style)) continue;
                    add([A, [A[0], y], [x, y], [x, B[1]], B], [sa, sb], 3, tA, tB);
                  }
                }
              }
            }
          }
        }
      }
      out.sort((a, b) => a.cost - b.cost);
      return out;
    }

    // k = 0: straight facing connectors.
    const ov = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
    if (src.x + src.w <= dst.x || dst.x + dst.w <= src.x) {
      const [lo, hi] = ov(src.y, src.y + src.h, dst.y, dst.y + dst.h);
      if (hi - lo > 20) {
        const right = src.x + src.w <= dst.x;
        for (const f of FINE) {
          const y = r2(lo + (hi - lo) * f);
          const a = [right ? src.x + src.w : src.x, y];
          const b = [right ? dst.x : dst.x + dst.w, y];
          add([a, b], right ? ['r', 'l'] : ['l', 'r'], 0, (y - src.y) / src.h, (y - dst.y) / dst.h);
        }
      }
    }
    if (src.y + src.h <= dst.y || dst.y + dst.h <= src.y) {
      const [lo, hi] = ov(src.x, src.x + src.w, dst.x, dst.x + dst.w);
      if (hi - lo > 20) {
        const down = src.y + src.h <= dst.y;
        for (const f of FINE) {
          const x = r2(lo + (hi - lo) * f);
          const a = [x, down ? src.y + src.h : src.y];
          const b = [x, down ? dst.y : dst.y + dst.h];
          add([a, b], down ? ['b', 't'] : ['t', 'b'], 0, (x - src.x) / src.w, (x - dst.x) / dst.w);
        }
      }
    }

    const sides = ['l', 'r', 't', 'b'];
    for (const sa of sides) {
      for (const sb of sides) {
        for (const tA of T) {
          for (const tB of T) {
            const A = port(src, sa, tA);
            const B = port(dst, sb, tB);
            const oa = outward[sa];
            const ob = outward[sb];
            if (H(sa) !== H(sb)) {
              const corner = H(sa) ? [B[0], A[1]] : [A[0], B[1]];
              if ((corner[0] - A[0]) * oa[0] + (corner[1] - A[1]) * oa[1] > 0 && (corner[0] - B[0]) * ob[0] + (corner[1] - B[1]) * ob[1] > 0) {
                add([A, corner, B], [sa, sb], 1, tA, tB);
              }
            } else if (H(sa)) {
              for (const x of XS) {
                if ((x - A[0]) * oa[0] <= 0 || (x - B[0]) * ob[0] <= 0) continue;
                if (Math.abs(A[1] - B[1]) < 0.05) continue;
                add([A, [x, A[1]], [x, B[1]], B], [sa, sb], 2, tA, tB);
              }
            } else {
              for (const y of ctx.ys) {
                if ((y - A[1]) * oa[1] <= 0 || (y - B[1]) * ob[1] <= 0) continue;
                if (Math.abs(A[0] - B[0]) < 0.05) continue;
                add([A, [A[0], y], [B[0], y], B], [sa, sb], 2, tA, tB);
              }
            }
          }
        }
      }
    }
    out.sort((a, b) => a.cost - b.cost);
    return out;
  }

  function route(e, src, dst) {
    for (const deep of [false, true]) {
      for (const c of candidates(e, src, dst, deep)) {
        if (!routeOk(c.pts, e, src, dst)) continue;
        let pill = null;
        if (e.label) {
          pill = placePill(c.pts, e.style, e.label, e.bundle);
          if (!pill) continue;
        }
        return { pts: c.pts, pill, sides: c.sides };
      }
    }
    return null;
  }

  return {
    placed,
    pills,
    add(e, pts, pill) {
      placed.push({ id: e.id, style: e.style, bundle: e.bundle, points: pts });
      if (pill) pills.push({ ...pill.rect, bundle: e.bundle, edge: e.id });
    },
    route,
  };
}

/**
 * Render a `generic@1` diagram document into static r7 offline inline SVGs (`wide` + `narrow`).
 * Returns `{ kind: 'rendered', renderer: 'r7', wide, narrow }` or `{ kind: 'refused', diagnostics }`.
 */
export function renderR7Diagram(document, ds, options = {}) {
  const kit = createR7Kit({ ds });
  const model = extractModel(document, ds, options);
  const direction = options.direction ?? 'LR';
  const key = options.id ?? document.documentId ?? 'diagram';
  const title = options.title ?? options.alt ?? key;
  const description = options.alt ?? options.description ?? title;

  const pillSize = (lines) => ({
    w: Math.ceil(Math.max(...lines.map((l) => kit.boldWidth(l, PILL_FONT))) * 1.04 + 40),
    h: lines.length * PILL_LINE + 20,
  });

  const headerCache = new Map();
  const headerOf = (node, w) => {
    const cacheKey = `${node.id}|${w}`;
    if (!headerCache.has(cacheKey)) {
      const probe = kit.scene({ key: 'probe', variant: 'probe', width: 2000, title: '', description: '' });
      headerCache.set(
        cacheKey,
        probe.zoneContentTop({
          entityId: node.id,
          w,
          kicker: node.kicker,
          title: node.title,
          subtitle: node.subtitle,
          icon: node.icon,
        }) + 4,
      );
    }
    return headerCache.get(cacheKey);
  };

  // Pre-build recursive grids for wide mode.
  const scopeGrids = new Map();
  scopeGrids.set(null, computeScopeGrid(null, model.root, model, direction));
  for (const n of model.nodes.values()) {
    if (n.kind === 'zone') scopeGrids.set(n.id, computeScopeGrid(n.id, n.children, model, direction));
  }

  function placeWide(extra) {
    const ext = new Map();
    const local = new Map();
    const extent = (id) => {
      if (ext.has(id)) return ext.get(id);
      const n = model.nodes.get(id);
      if (n.kind !== 'zone') {
        ext.set(id, { rows: 1, cols: 1 });
        return ext.get(id);
      }
      const e = measure(id);
      ext.set(id, e);
      return e;
    };
    const measure = (id) => {
      const g = scopeGrids.get(id) ?? [];
      const nR = Math.max(1, g.length);
      const nC = Math.max(1, ...g.map((row) => row.length));
      const rowSpan = Array(nR).fill(1);
      const colSpan = Array(nC).fill(1);
      const cells = [];
      g.forEach((row, i) =>
        row.forEach((cellId, j) => {
          if (!cellId) return;
          cells.push({ id: cellId, i, j });
          const e = extent(cellId);
          rowSpan[i] = Math.max(rowSpan[i], e.rows);
          colSpan[j] = Math.max(colSpan[j], e.cols);
        }),
      );
      local.set(id, { rowSpan, colSpan, cells });
      return { rows: rowSpan.reduce((a, b) => a + b, 0), cols: colSpan.reduce((a, b) => a + b, 0) };
    };

    const rootExt = measure(null);
    const cell = new Map();
    const span = new Map();
    const place = (id, r0, c0) => {
      const { rowSpan, colSpan, cells } = local.get(id);
      const rowStart = [];
      const colStart = [];
      rowSpan.reduce((acc, s, i) => ((rowStart[i] = acc), acc + s), 0);
      colSpan.reduce((acc, s, j) => ((colStart[j] = acc), acc + s), 0);
      for (const c of cells) {
        const e = extent(c.id);
        const r = r0 + rowStart[c.i];
        const col = c0 + colStart[c.j];
        const n = model.nodes.get(c.id);
        if (n.kind === 'zone') {
          span.set(c.id, { r0: r, r1: r + e.rows - 1, c0: col, c1: col + e.cols - 1 });
          place(c.id, r, col);
        } else {
          cell.set(c.id, { r, c: col });
        }
      }
    };
    place(null, 0, 0);

    const R = rootExt.rows;
    const C = rootExt.cols;
    const zoneIds = [...span.keys()].sort((a, b) => model.nodes.get(a).depth - model.nodes.get(b).depth);
    const childZones = (id) => zoneIds.filter((z) => model.nodes.get(z).parent === id);
    const inset = new Map();
    const insetOf = (id) => {
      if (inset.has(id)) return inset.get(id);
      const s = span.get(id);
      const kids = childZones(id);
      const node = model.nodes.get(id);
      const head = headerOf(node, 1000);
      const v = {
        top: head + ZONE_GAP + Math.max(0, ...kids.filter((k) => span.get(k).r0 === s.r0).map((k) => insetOf(k).top)),
        bottom: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).r1 === s.r1).map((k) => insetOf(k).bottom)),
        left: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).c0 === s.c0).map((k) => insetOf(k).left)),
        right: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).c1 === s.c1).map((k) => insetOf(k).right)),
      };
      inset.set(id, v);
      return v;
    };
    zoneIds.forEach(insetOf);

    const stack = (pick, pred) => Math.max(0, ...zoneIds.filter(pred).map((z) => insetOf(z)[pick]));
    const topStack = (r) => stack('top', (z) => span.get(z).r0 === r);
    const bottomStack = (r) => stack('bottom', (z) => span.get(z).r1 === r);
    const leftStack = (c) => stack('left', (z) => span.get(z).c0 === c);
    const rightStack = (c) => stack('right', (z) => span.get(z).c1 === c);

    const rowChannel = Array(R).fill(ROW_CHANNEL);
    const colChannel = Array(C).fill(COL_CHANNEL);

    // Widen channels between adjacent cells so facing edge labels fit cleanly without colliding.
    const colNeed = new Map();
    const rowNeed = new Map();
    for (const e of model.links) {
      const a = cell.get(e.from);
      const b = cell.get(e.to);
      if (!a || !b || !e.label) continue;
      const two = splitLabel(e.label);
      const size1 = pillSize([e.label]);
      const size2 = pillSize(two);
      const pillW = Math.min(size1.w, size2.w);
      const pillH = Math.min(size1.h, size2.h);
      const need = headOf(e.style) + 18;
      if (a.r === b.r && Math.abs(a.c - b.c) === 1) {
        const hi = Math.max(a.c, b.c);
        const cur = colNeed.get(hi) ?? 0;
        colNeed.set(hi, Math.max(cur, pillW + 24 + need + 16));
      } else if (a.c === b.c && Math.abs(a.r - b.r) === 1) {
        const hi = Math.max(a.r, b.r);
        const cur = rowNeed.get(hi) ?? 0;
        rowNeed.set(hi, Math.max(cur, pillH + 24 + need + 16));
      }
    }
    for (const [hi, req] of colNeed) colChannel[hi] = Math.max(colChannel[hi], req);
    for (const [hi, req] of rowNeed) rowChannel[hi] = Math.max(rowChannel[hi], req);

    const grow = extra.all ?? 0;
    const margin = 44 + Math.min(grow, 120);
    const rowY = [];
    const colX = [];
    for (let r = 0; r < R; r++) {
      rowY[r] = r === 0 ? margin + topStack(0) : rowY[r - 1] + CARD_H + bottomStack(r - 1) + rowChannel[r] + grow + topStack(r);
    }
    for (let c = 0; c < C; c++) {
      colX[c] = c === 0 ? margin + leftStack(0) : colX[c - 1] + CARD_W + rightStack(c - 1) + colChannel[c] + grow + leftStack(c);
    }

    const rects = new Map();
    for (const [id, p] of cell) rects.set(id, rectOf(colX[p.c], rowY[p.r], CARD_W, CARD_H));
    for (const id of zoneIds) {
      const s = span.get(id);
      const ins = insetOf(id);
      const x = colX[s.c0] - ins.left;
      const y = rowY[s.r0] - ins.top;
      rects.set(id, rectOf(x, y, colX[s.c1] + CARD_W + ins.right - x, rowY[s.r1] + CARD_H + ins.bottom - y));
    }

    const xs = new Set();
    const ys = new Set();
    const lanes = (lo, hi, set) => {
      if (hi - lo < 24) return;
      const n = 5;
      for (let k = 0; k <= n; k++) set.add(Math.round(lo + 12 + ((hi - lo - 24) * k) / n));
    };
    for (let c = 1; c < C; c++) lanes(colX[c - 1] + CARD_W + rightStack(c - 1), colX[c] - leftStack(c), xs);
    for (let r = 1; r < R; r++) lanes(rowY[r - 1] + CARD_H + bottomStack(r - 1), rowY[r] - topStack(r), ys);
    for (let c = 0; c < C; c++) for (const f of [0.25, 0.5, 0.75]) xs.add(Math.round(colX[c] + CARD_W * f));
    for (let r = 0; r < R; r++) for (const f of [0.25, 0.5, 0.75]) ys.add(Math.round(rowY[r] + CARD_H * f));
    const minX = Math.min(...[...rects.values()].map((b) => b.x));
    const minY = Math.min(...[...rects.values()].map((b) => b.y));
    const right = Math.max(...[...rects.values()].map((b) => b.x + b.w));
    const bottom = Math.max(...[...rects.values()].map((b) => b.y + b.h));
    for (const d of [24, 52]) {
      if (minX - d >= 10) xs.add(Math.round(minX - d));
      if (minY - d >= 10) ys.add(Math.round(minY - d));
    }
    for (const d of [36, 72, 108, 144]) xs.add(Math.round(right + d));
    for (const d of [36, 72, 108, 144, 180]) ys.add(Math.round(bottom + d));
    return { rects, zoneIds, xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b), canvasW: null };
  }

  function placeNarrow(extra) {
    const seq = [];
    const opens = new Map();
    const closes = new Map();
    const maxZoneDepth = Math.max(-1, ...[...model.nodes.values()].filter((n) => n.kind === 'zone').map((n) => n.depth));
    const zoneLevels = maxZoneDepth + 1;

    const walk = (scopeParent, depth) => {
      for (const id of computeNarrowOrder(scopeParent, model)) {
        const n = model.nodes.get(id);
        if (n.kind === 'zone') {
          const start = seq.length;
          walk(id, depth + 1);
          const end = seq.length - 1;
          if (end >= start) {
            if (!opens.has(start)) opens.set(start, []);
            opens.get(start).push({ id, depth });
            if (!closes.has(end)) closes.set(end, []);
            closes.get(end).push({ id, depth });
          }
        } else {
          seq.push(id);
        }
      }
    };
    walk(null, 0);

    const railStep = 18;
    const zonePadStep = 16;
    const outerZonePad = zoneLevels * zonePadStep;
    // Estimate needed rails first so canvas width fits comfortably (640px default, widens smoothly if >3 concurrent rails).
    const prelimRails = assignNarrowRails(seq, model.links, 0, 0, railStep);
    const leftRailsW = Math.max(3, prelimRails.leftCount) * railStep + 22;
    const rightRailsW = Math.max(3, prelimRails.rightCount) * railStep + 22;
    const nx = Math.max(90, leftRailsW + outerZonePad);
    const narrowW = Math.max(640, nx + CARD_W + outerZonePad + rightRailsW);

    const leftRailStart = nx - outerZonePad - 18;
    const rightRailStart = nx + CARD_W + outerZonePad + 18;
    const railPlan = assignNarrowRails(seq, model.links, leftRailStart, rightRailStart, railStep);

    const zoneWidthForDepth = (depth) => CARD_W + 2 * (zoneLevels - depth) * zonePadStep;
    const zoneXForDepth = (depth) => nx - (zoneLevels - depth) * zonePadStep;
    const headOfZone = (z) => headerOf(model.nodes.get(z.id), zoneWidthForDepth(z.depth));
    const topStack = (i) => (opens.get(i) ?? []).reduce((s, z) => s + headOfZone(z) + ZONE_GAP, 0);
    const bottomStack = (i) => (closes.get(i) ?? []).reduce((s) => s + ZONE_PAD, 0);

    const channel = Array(seq.length).fill(NARROW_CHANNEL);
    const perGap = new Map();
    for (const e of model.links) {
      const ia = seq.indexOf(e.from);
      const ib = seq.indexOf(e.to);
      if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1 || !e.label) continue;
      const hi = Math.max(ia, ib);
      if (!perGap.has(hi)) perGap.set(hi, []);
      perGap.get(hi).push(e);
    }
    for (const [hi, list] of perGap) {
      const pillsH = list.reduce((sum, e) => sum + pillSize(splitLabel(e.label)).h + 16, 0);
      const head = Math.max(...list.map((e) => headOf(e.style) + 18));
      const req = pillsH + Math.max(0, 22 - bottomStack(hi - 1)) + Math.max(0, head - topStack(hi)) + (list.length > 1 ? 24 : 0);
      channel[hi] = Math.max(channel[hi], req);
    }

    const grow = extra.all ?? 0;
    const yOf = [];
    for (let i = 0; i < seq.length; i++) {
      yOf[i] = i === 0 ? 20 + topStack(0) : yOf[i - 1] + CARD_H + bottomStack(i - 1) + channel[i] + grow + topStack(i);
    }
    const rects = new Map();
    seq.forEach((id, i) => rects.set(id, rectOf(nx, yOf[i], CARD_W, CARD_H)));

    const zoneIds = [];
    for (const [first, list] of opens) {
      for (const z of list) {
        let last = first;
        for (const [end, cl] of closes) if (cl.some((c) => c.id === z.id)) last = end;
        const outerOpens = opens.get(first) ?? [];
        const innerTop = outerOpens.filter((o) => o.depth > z.depth).reduce((s, o) => s + headOfZone(o) + ZONE_GAP, 0);
        const innerClose = (closes.get(last) ?? []).filter((c) => c.depth > z.depth).length * ZONE_PAD;
        const top = yOf[first] - innerTop - headOfZone(z) - ZONE_GAP;
        const bottom = yOf[last] + CARD_H + innerClose + ZONE_PAD;
        rects.set(z.id, rectOf(zoneXForDepth(z.depth), top, zoneWidthForDepth(z.depth), bottom - top));
        zoneIds.push(z.id);
      }
    }
    zoneIds.sort((a, b) => model.nodes.get(a).depth - model.nodes.get(b).depth);

    const xsSet = new Set();
    for (let t = 0; t < Math.max(3, railPlan.leftCount + 1); t++) {
      const rx = leftRailStart - t * railStep;
      if (rx >= 10) xsSet.add(rx);
    }
    for (let t = 0; t < Math.max(3, railPlan.rightCount + 1); t++) {
      const rx = rightRailStart + t * railStep;
      if (rx <= narrowW - 10) xsSet.add(rx);
    }
    for (const f of [0.25, 0.5, 0.75]) xsSet.add(Math.round(nx + CARD_W * f));

    const ysSet = new Set();
    for (let i = 1; i < seq.length; i++) {
      const lo = yOf[i - 1] + CARD_H + bottomStack(i - 1);
      const hi = yOf[i] - topStack(i);
      if (hi - lo >= 24) {
        for (let k = 0; k <= 5; k++) ysSet.add(Math.round(lo + 12 + ((hi - lo - 24) * k) / 5));
      }
    }
    const bottom = Math.max(0, ...[...rects.values()].map((b) => b.y + b.h));
    for (const d of [36, 72, 108, 144]) ysSet.add(Math.round(bottom + d));
    return { rects, zoneIds, xs: [...xsSet].sort((a, b) => a - b), ys: [...ysSet].sort((a, b) => a - b), lanes: railPlan.lanes, canvasW: narrowW };
  }

  function buildVariant(variant) {
    const wide = variant === 'wide';
    const attemptWith = (extra, allowPerpendicularCrossings) => {
      const priority = [];
      let last = null;
      const maxAttempts = Math.min(model.links.length + 2, 12);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const lay = wide ? placeWide(extra) : placeNarrow(extra);
        const { rects, zoneIds } = lay;
        const probe = kit.scene({ key, variant: 'probe', width: 100000, title: '', description: '' });
        const zoneTexts = [];
        const zoneFrames = [];
        for (const id of zoneIds) {
          const r = rects.get(id);
          const n = model.nodes.get(id);
          const z = probe.zone(id, { x: r.x, y: r.y, w: r.w, h: r.h, kicker: n.kicker, title: n.title, subtitle: n.subtitle, icon: n.icon });
          zoneTexts.push(...z.texts);
          if (n.icon) zoneTexts.push(rectOf(r.x + 16, r.y + 16, 70, 70));
          zoneFrames.push(r);
        }
        const leaves = [...model.nodes.values()].filter((n) => n.kind === 'card').map((n) => n.id);
        const solids = leaves.map((id) => rects.get(id));
        const ctx = { solids, zoneFrames, zoneTexts, xs: lay.xs, ys: lay.ys, lanes: lay.lanes ?? null, canvasW: lay.canvasW };
        const rt = createRouter(kit, ctx, { allowPerpendicularCrossings });

        const routes = new Map();
        const failures = [];
        const order = [...model.links].sort((a, b) => {
          const pa = priority.indexOf(a.id);
          const pb = priority.indexOf(b.id);
          return (pa < 0 ? 1e9 : pa) - (pb < 0 ? 1e9 : pb);
        });

        for (const e of order) {
          const src = rects.get(e.from);
          const dst = rects.get(e.to);
          if (!src || !dst) continue;
          const res = rt.route(e, src, dst);
          if (!res) {
            failures.push(e.id);
            continue;
          }
          rt.add(e, res.pts, res.pill);
          routes.set(e.id, res);
        }

        if (failures.length === 0) {
          const allBoxes = [
            ...rects.values(),
            ...rt.pills,
            ...rt.placed.flatMap((p) => p.points.map((q) => rectOf(q[0], q[1], 0, 0))),
          ];
          const W = wide ? Math.ceil(Math.max(CARD_W + 40, ...allBoxes.map((b) => b.x + b.w)) + 28) : lay.canvasW;
          const H = Math.ceil(Math.max(CARD_H + 40, ...allBoxes.map((b) => b.y + b.h)) + 28);
          const s = kit.scene({ key, variant, width: W, title, description });
          for (const id of zoneIds) {
            const r = rects.get(id);
            const n = model.nodes.get(id);
            s.zone(id, { x: r.x, y: r.y, w: r.w, h: r.h, kicker: n.kicker, title: n.title, subtitle: n.subtitle, icon: n.icon });
          }
          for (const id of leaves) {
            const r = rects.get(id);
            const n = model.nodes.get(id);
            s.card(id, {
              x: r.x,
              y: r.y,
              zone: n.parent,
              icon: n.icon,
              kicker: n.kicker,
              title: n.title,
              body: n.body,
              footer: n.footer,
            });
          }
          for (const e of model.links) {
            const r = routes.get(e.id);
            if (!r) continue;
            const pts = r.pts;
            const src = rects.get(e.from);
            const dst = rects.get(e.to);
            const sideOf = (p, b) =>
              Math.abs(p[0] - b.x) < 0.05 ? 'l' : Math.abs(p[0] - (b.x + b.w)) < 0.05 ? 'r' : Math.abs(p[1] - b.y) < 0.05 ? 't' : 'b';
            const fracOf = (p, b, side) => (side === 'l' || side === 'r' ? (p[1] - b.y) / b.h : (p[0] - b.x) / b.w);
            const sa = sideOf(pts[0], src);
            const sb = sideOf(pts.at(-1), dst);
            const via = [];
            for (let i = 1; i < pts.length - 1; i++) {
              via.push(Math.abs(pts[i][1] - pts[i - 1][1]) < 0.05 ? ['h', pts[i][0]] : ['v', pts[i][1]]);
            }
            s.edge(e.id, {
              from: [e.from, sa, fracOf(pts[0], src, sa)],
              to: [e.to, sb, fracOf(pts.at(-1), dst, sb)],
              via,
              style: e.style,
              ...(r.pill ? { label: r.pill.lines.length === 1 ? r.pill.lines[0] : r.pill.lines, labelAt: [r.pill.segIndex, r.pill.t] } : {}),
              name: e.label || `${model.nodes.get(e.from)?.title ?? e.from} → ${model.nodes.get(e.to)?.title ?? e.to}`,
            });
          }
          return { ok: true, out: s.render(H, { allowPerpendicularCrossings }) };
        }
        last = { ok: false, failures };
        const bumped = failures.find((id) => !priority.includes(id));
        if (!bumped) break;
        priority.unshift(bumped);
      }
      return last ?? { ok: false, failures: ['layout'] };
    };

    // Pass 1: strictly crossing-free routing with dynamic channel widening.
    for (let step = 0; step < 5; step++) {
      const res = attemptWith({ all: step * 60 }, false);
      if (res.ok) return res.out;
    }
    // Pass 2: allow perpendicular edge crossings on non-planar graphs (still zero box/text/pill overlap).
    for (let step = 0; step < 4; step++) {
      const res = attemptWith({ all: step * 80 }, true);
      if (res.ok) return res.out;
    }
    throw new Error(`r7 diagram ${key}-${variant}: could not find non-overlapping orthogonal layout`);
  }

  try {
    const wide = buildVariant('wide');
    const narrow = buildVariant('narrow');
    return {
      kind: 'rendered',
      renderer: 'r7',
      wide,
      narrow,
    };
  } catch (error) {
    if (error instanceof R7RefusalError) {
      return { kind: 'refused', diagnostics: error.diagnostics };
    }
    throw error;
  }
}
