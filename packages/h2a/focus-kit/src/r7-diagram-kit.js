/**
 * Vendored r7 static inline SVG diagram kit for Focus dossiers (interim renderer until DS FA-D2 + h2a FA-H3).
 *
 * Provenance:
 * - Core kit, connector geometry (`linePath`, `headPolygon`, `edgeSvg`, `pillSvg`), monochrome patterns,
 *   and pure-JS build-time geometry linter (`lint`) ported from the owner-validated `r7` kit
 *   (`mem7-dossier/diagram-kit.mjs`, SHA-256 c5da83cf…).
 * - Centered card body placement (`centreBody`) ported from the owner-validated `r7` Schema 1 centering
 *   fix (`simple-diagrams/dossier/archive/v5/figkit/diagram-kit.mjs` / `CENTRAGE-S1.md`).
 * - Consumes only the pure Design System card/zone SVG renderers already bundled in `focus-kit`
 *   (`@sentropic/design-system-svelte@0.37.0`); zero network calls, zero new runtime dependencies.
 */

const esc = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const CARD_W = 460;
export const CARD_H = 200;
export const PILL_FONT = 22;
export const PILL_LINE = 28;
export const PILL_PAD_X = 20;
export const PILL_PAD_Y = 10;
export const INK = 'var(--st-semantic-text-primary)';
export const PAPER = 'var(--st-semantic-surface-raised)';

// Shapes, never colours: thin, thin dashed, thick, thick dashed, thick double.
export const EDGE_STYLES = {
  link: { width: 3, head: 20, dash: null, radius: 16 },
  dashed: { width: 3, head: 20, dash: '11 8', radius: 16 },
  key: { width: 7, head: 28, dash: null, radius: 16, strong: true },
  shadow: { width: 9, head: 32, dash: '24 12', radius: 16, strong: true },
  journal: { width: 14, head: 38, dash: null, inner: 5, radius: 16, strong: true },
};

const r2 = (v) => Math.round(v * 100) / 100;
const rectOf = (x, y, w, h) => ({ x, y, w, h });
const inflate = (b, d) => rectOf(b.x - d, b.y - d, b.w + 2 * d, b.h + 2 * d);
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const legRect = (a, b, half = 0) =>
  Math.abs(a[1] - b[1]) < 0.05
    ? rectOf(Math.min(a[0], b[0]), a[1] - half, Math.abs(a[0] - b[0]), 2 * half)
    : rectOf(a[0] - half, Math.min(a[1], b[1]), 2 * half, Math.abs(a[1] - b[1]));
const segLen = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const onBorder = (p, b) => {
  const eps = 0.05;
  const inX = p[0] >= b.x - eps && p[0] <= b.x + b.w + eps;
  const inY = p[1] >= b.y - eps && p[1] <= b.y + b.h + eps;
  const onV = Math.abs(p[0] - b.x) < eps || Math.abs(p[0] - (b.x + b.w)) < eps;
  const onH = Math.abs(p[1] - b.y) < eps || Math.abs(p[1] - (b.y + b.h)) < eps;
  return (onV && inY) || (onH && inX);
};
const strictlyInside = (p, b) => p[0] > b.x + 0.5 && p[0] < b.x + b.w - 0.5 && p[1] > b.y + 0.5 && p[1] < b.y + b.h - 0.5;

export class R7RefusalError extends Error {
  constructor(diagnostics) {
    super('R7 diagram view refused');
    this.name = 'R7RefusalError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Center the card body horizontally and vertically inside `layout.bodyArea`
 * (owner-validated r7 Schema 1 tweak, `CENTRAGE-S1.md`).
 */
function centreBody(svg, layout) {
  if (!layout.body.length) return svg;
  const lineH = Math.floor(24 * 1.3 * 64) / 64;
  const { top, bottom } = layout.bodyArea;
  const blockTop = top + Math.max(0, (bottom - top - layout.body.length * lineH) / 2);
  const cx = r2(layout.bodyX + layout.bodyWidth / 2);
  let out = svg;
  layout.body.forEach((line, i) => {
    const before = `x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor}"`;
    const after = `x="${cx}" y="${r2(blockTop + i * lineH + 22)}" text-anchor="middle"`;
    out = out.replace(before, after);
  });
  return out;
}

/**
 * Vertically center a title-only card (no body, no kicker, no footer) inside the 460x200 frame
 * so minimal flowchart nodes look balanced rather than jammed in the top-left corner.
 */
function centreTitleOnly(svg, layout) {
  if (layout.body.length || layout.kicker.length || layout.footerLines.length || !layout.title.length) return svg;
  const titleH = Math.floor(32 * 1.3 * 64) / 64;
  const blockH = layout.title.length * titleH;
  const cardInnerTop = 10;
  const cardInnerBottom = CARD_H - 10;
  const targetTop = cardInnerTop + (cardInnerBottom - cardInnerTop - blockH) / 2;
  const currentTop = layout.title[0].baseline - 32;
  const dy = r2(targetTop - currentTop);
  if (Math.abs(dy) < 0.5) return svg;
  let out = svg;
  for (const line of layout.title) {
    const before = `x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor}"`;
    const after = `x="${line.x}" y="${r2(line.baseline + dy)}" text-anchor="${line.anchor}"`;
    out = out.replace(before, after);
  }
  if (layout.iconBox) {
    const beforeIcon = `transform="translate(${layout.iconBox.x} ${layout.iconBox.y})`;
    const afterIcon = `transform="translate(${layout.iconBox.x} ${r2(layout.iconBox.y + dy)})`;
    out = out.replace(beforeIcon, afterIcon);
  }
  return out;
}

export function createR7Kit({ ds }) {
  const measureUnwrapped = (text, role, refSize, size) => {
    if (!text) return 0;
    const m = ds.defaultCardMeasure(String(text), role, 100000);
    const width = Math.max(0, ...(m.lineWidths ?? [0]));
    return width * (size / refSize);
  };
  const boldWidth = (text, size) => measureUnwrapped(text, 'title', 32, size);
  const plainWidth = (text, size) => measureUnwrapped(text, 'body', 24, size) * 1.06;

  function scene({ n = 1, key = 'diagram', variant = 'wide', width, title = '', description = '', instance = 1 }) {
    const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '-');
    const uid = `r7-${safeKey}-${n}${instance > 1 ? 'x' + instance : ''}-${variant}`;
    const boxes = new Map();
    const zones = [];
    const cards = [];
    const panels = [];
    const edges = [];
    const extras = [];
    const texts = [];
    const tight = [];
    const problemsEarly = [];
    const labels = [];
    let maxY = 0;
    const grow = (b) => {
      maxY = Math.max(maxY, b.y + b.h);
    };
    const say = (text, from = 'scene') => {
      if (text) labels.push({ text, from });
    };

    const api = {
      n,
      key,
      variant,
      uid,
      width,
      labels,
      box: (id) => {
        const b = boxes.get(id);
        if (!b) throw new Error(`${uid}: unknown box ${id}`);
        return b;
      },
      at(id, side, t = 0.5) {
        const b = api.box(id);
        if (side === 'l') return [b.x, r2(b.y + b.h * t)];
        if (side === 'r') return [b.x + b.w, r2(b.y + b.h * t)];
        if (side === 't') return [r2(b.x + b.w * t), b.y];
        if (side === 'b') return [r2(b.x + b.w * t), b.y + b.h];
        throw new Error(`Unknown side ${side}`);
      },
      fx: (id, x) => (x - api.box(id).x) / api.box(id).w,
      fy: (id, y) => (y - api.box(id).y) / api.box(id).h,

      zone(id, { x, y, w, h, kicker, title: zoneTitle, subtitle, footer, icon, proposed, emphasis, from }) {
        const glyph = icon ? ds.DIAGRAM_GLYPHS[icon] : undefined;
        if (icon && !glyph) throw new Error(`${uid}: unknown icon ${icon}`);
        const res = ds.renderZoneSvg(
          {
            entityId: id,
            ...(kicker ? { kicker } : {}),
            title: zoneTitle,
            ...(subtitle ? { subtitle } : {}),
            ...(footer ? { footer } : {}),
            ...(icon ? { icon, iconGlyph: glyph } : {}),
            ...(proposed ? { proposed: true } : {}),
            collapsed: false,
            x: 0,
            y: 0,
            width: w,
            height: h,
          },
          { children: [] },
        );
        if (res.kind !== 'rendered' || res.diagnostics.length) {
          throw new R7RefusalError(res.diagnostics);
        }
        for (const t of [kicker, zoneTitle, subtitle, footer]) say(t, from);
        const header = res.layout.header;
        const textBoxes = [];
        const addLines = (lines, role) => {
          for (const line of lines) {
            const m = ds.defaultCardMeasure(line.text, role, 100000);
            const wText = Math.max(0, ...m.lineWidths);
            const left = line.anchor === 'middle' ? line.x - wText / 2 : line.x;
            textBoxes.push(rectOf(x + left, y + line.baseline - line.size, wText, line.size * 1.3));
          }
        };
        addLines(header.kicker, 'kicker');
        addLines(header.title, 'title');
        addLines(header.subtitle, 'body');
        addLines(header.footer, 'footer');
        const b = {
          id,
          kind: 'zone',
          x,
          y,
          w,
          h,
          contentTop: y + Math.ceil(header.contentTop),
          contentBottom: y + h - 16 - (footer ? 50 : 0),
          svg: res.svg,
          texts: textBoxes,
          emphasis: Boolean(emphasis),
          proposed: Boolean(proposed),
        };
        boxes.set(id, b);
        zones.push(b);
        grow(b);
        return b;
      },

      zoneContentTop({ w, kicker, title: zoneTitle, subtitle, icon, entityId = 'probe' }) {
        const glyph = icon ? ds.DIAGRAM_GLYPHS[icon] : undefined;
        const res = ds.renderZoneSvg(
          {
            entityId,
            ...(kicker ? { kicker } : {}),
            title: zoneTitle,
            ...(subtitle ? { subtitle } : {}),
            ...(icon ? { icon, iconGlyph: glyph } : {}),
            collapsed: false,
            x: 0,
            y: 0,
            width: w,
          },
          { children: [] },
        );
        if (res.kind !== 'rendered') throw new R7RefusalError(res.diagnostics);
        return Math.ceil(res.layout.header.contentTop);
      },

      card(id, { x, y, icon, kicker, title: cardTitle, body = [], footer, proposed, emphasis, zone, align, from }) {
        const glyph = icon ? ds.DIAGRAM_GLYPHS[icon] : undefined;
        if (icon && !glyph) throw new Error(`${uid}: unknown icon ${icon}`);
        const effectiveAlign = align ?? (body.length === 0 && !kicker && !footer ? 'center' : 'left');
        const props = {
          entityId: id,
          ...(kicker ? { kicker } : {}),
          title: cardTitle,
          body,
          ...(footer ? { footer } : {}),
          ...(icon ? { icon, iconGlyph: glyph } : {}),
          ...(proposed ? { proposed: true } : {}),
          ...(effectiveAlign === 'center' ? { align: 'center' } : {}),
        };
        const res = ds.renderCardSvg(props);
        if (res.kind !== 'rendered' || res.diagnostics.length) {
          throw new R7RefusalError(res.diagnostics);
        }
        for (const t of [kicker, cardTitle, ...body, footer]) say(t, from);
        let svg = centreBody(res.svg, res.layout);
        svg = centreTitleOnly(svg, res.layout);
        const b = {
          id,
          kind: 'card',
          x,
          y,
          w: CARD_W,
          h: CARD_H,
          svg,
          emphasis: Boolean(emphasis),
          proposed: Boolean(proposed),
          zone: zone ?? null,
          label: cardTitle,
        };
        boxes.set(id, b);
        cards.push(b);
        grow(b);
        return b;
      },

      edge(id, { from, to, via = [], label, labelAt, style = 'link', heads = 'end', bundle, name, labelFrom }) {
        const start = api.at(...from);
        const end = api.at(...to);
        const points = [start];
        let cur = start;
        for (const [dir, value] of via) {
          cur = dir === 'h' ? [value, cur[1]] : [cur[0], value];
          points.push(cur);
        }
        points.push(end);
        const lineList = label === undefined || label === null || label === '' ? null : Array.isArray(label) ? label : [label];
        let pill = null;
        if (lineList && lineList.length) {
          for (const l of lineList) say(l, labelFrom);
          const w = Math.ceil(Math.max(...lineList.map((l) => boldWidth(l, PILL_FONT))) * 1.04 + 2 * PILL_PAD_X);
          const h = lineList.length * PILL_LINE + 2 * PILL_PAD_Y;
          let segIndex;
          let t = 0.5;
          if (labelAt) [segIndex, t] = labelAt;
          else {
            segIndex = 0;
            for (let i = 1; i < points.length - 1; i++) {
              if (segLen(points[i], points[i + 1]) > segLen(points[segIndex], points[segIndex + 1])) segIndex = i;
            }
          }
          const a = points[segIndex];
          const b = points[segIndex + 1];
          const cx = a[0] + (b[0] - a[0]) * t;
          const cy = a[1] + (b[1] - a[1]) * t;
          pill = { lines: lineList, x: r2(cx - w / 2), y: r2(cy - h / 2), w, h, segIndex };
        }
        const e = {
          id,
          from: from[0],
          to: to[0],
          points,
          pill,
          style,
          heads,
          bundle: bundle ?? null,
          name: name ?? (lineList ? lineList.join(' ') : ''),
        };
        if (!EDGE_STYLES[style]) throw new Error(`${uid}: unknown edge style ${style}`);
        if (edges.some((o) => o.id === id)) throw new Error(`${uid}: duplicate edge ${id}`);
        edges.push(e);
        for (const p of points) maxY = Math.max(maxY, p[1]);
        if (pill) grow(pill);
        return e;
      },

      boldWidth,
      plainWidth,

      lint(height, { allowPerpendicularCrossings = false } = {}) {
        const problems = [...tight, ...problemsEarly];
        const bad = (message) => problems.push(`${uid}: ${message}`);
        const canvas = rectOf(4, 4, width - 8, height - 8);
        const outline = rectOf(1, 1, width - 2, height - 2);
        const solid = [...cards, ...panels];
        const zoneById = new Map(zones.map((z) => [z.id, z]));
        const isAncestorZone = (ancestorId, zoneId) => {
          const a = zoneById.get(ancestorId);
          const b = zoneById.get(zoneId);
          return Boolean(a && b && a !== b && contains(a, b));
        };

        for (const z of zones) {
          if (!contains(canvas, z)) bad(`zone ${z.id} leaves the canvas`);
          if (z.emphasis && !contains(outline, inflate(z, 9))) bad(`outline of zone ${z.id} leaves the canvas`);
        }
        for (const c of cards) {
          if (c.emphasis && !contains(outline, inflate(c, 9))) bad(`outline of card ${c.id} leaves the canvas`);
        }
        for (const c of solid) {
          if (!contains(canvas, c)) bad(`${c.kind} ${c.id} leaves the canvas`);
          if (c.zone) {
            const z = api.box(c.zone);
            const inner = rectOf(z.x + 12, z.contentTop - 2, z.w - 24, z.contentBottom - z.contentTop + 6);
            if (!contains(inner, c)) bad(`${c.kind} ${c.id} leaves the content area of ${c.zone}`);
          } else {
            for (const z of zones) if (intersects(inflate(c, 8), z)) bad(`free ${c.kind} ${c.id} overlaps zone ${z.id}`);
          }
        }
        for (const z of zones) {
          for (const t of z.texts) {
            if (!contains(inflate(z, -4), t)) bad(`a text of zone ${z.id} leaves its frame`);
            for (const c of solid) if (intersects(inflate(t, 4), c)) bad(`${c.kind} ${c.id} covers a text of zone ${z.id}`);
          }
        }
        for (let i = 0; i < solid.length; i++) {
          for (let j = i + 1; j < solid.length; j++) {
            if (intersects(inflate(solid[i], 10), solid[j])) bad(`${solid[i].id} and ${solid[j].id} overlap`);
          }
        }
        for (let i = 0; i < zones.length; i++) {
          for (let j = i + 1; j < zones.length; j++) {
            if (isAncestorZone(zones[i].id, zones[j].id) || isAncestorZone(zones[j].id, zones[i].id)) continue;
            if (intersects(inflate(zones[i], 10), zones[j])) bad(`zones ${zones[i].id} and ${zones[j].id} overlap`);
          }
        }
        const pills = edges.filter((e) => e.pill).map((e) => ({ ...e.pill, edge: e }));
        for (const e of edges) {
          const style = EDGE_STYLES[e.style];
          const src = api.box(e.from);
          const dst = api.box(e.to);
          const pts = e.points;
          if (!onBorder(pts[0], src)) bad(`edge ${e.id} does not start on the border of ${e.from}`);
          if (!onBorder(pts.at(-1), dst)) bad(`edge ${e.id} does not end on the border of ${e.to}`);
          if (strictlyInside(pts[1], src)) bad(`edge ${e.id} starts inward`);
          if (strictlyInside(pts.at(-2), dst)) bad(`edge ${e.id} ends from inside`);
          for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            if (Math.abs(a[0] - b[0]) > 0.05 && Math.abs(a[1] - b[1]) > 0.05) bad(`edge ${e.id} leg ${i} is not axis-aligned`);
            const min = i === pts.length - 2 || (i === 0 && e.heads === 'both') ? style.head + 8 : 14;
            if (segLen(a, b) < min - 0.1) bad(`edge ${e.id} leg ${i} too short (${r2(segLen(a, b))} < ${min})`);
            for (const c of solid) {
              if (intersects(legRect(a, b, style.width / 2), inflate(c, -1))) bad(`edge ${e.id} leg ${i} crosses ${c.kind} ${c.id}`);
            }
            for (const z of zones) {
              for (const t of z.texts) {
                if (intersects(legRect(a, b, style.width / 2 + 6), t)) bad(`edge ${e.id} leg ${i} crosses a text of zone ${z.id}`);
              }
            }
            for (const p of pills) {
              if (p.edge === e) continue;
              if (e.bundle && p.edge.bundle === e.bundle) continue;
              if (intersects(legRect(a, b, style.width / 2 + 2), p)) bad(`edge ${e.id} leg ${i} runs under the label of ${p.edge.id}`);
            }
          }
          for (const other of edges) {
            if (other === e || edges.indexOf(other) < edges.indexOf(e)) continue;
            if (e.bundle && other.bundle === e.bundle) continue;
            for (let i = 0; i < pts.length - 1; i++) {
              const aHoriz = Math.abs(pts[i][1] - pts[i + 1][1]) < 0.05;
              for (let j = 0; j < other.points.length - 1; j++) {
                const bHoriz = Math.abs(other.points[j][1] - other.points[j + 1][1]) < 0.05;
                if (allowPerpendicularCrossings && aHoriz !== bHoriz) continue;
                const A = legRect(pts[i], pts[i + 1], style.width / 2 + 3);
                const B = legRect(other.points[j], other.points[j + 1], EDGE_STYLES[other.style].width / 2 + 3);
                if (intersects(A, B)) bad(`edges ${e.id} and ${other.id} touch or cross`);
              }
            }
          }
        }
        for (const p of pills) {
          const e = p.edge;
          if (!contains(canvas, p)) bad(`label of ${e.id} leaves the canvas`);
          for (const c of solid) if (intersects(inflate(p, 6), c)) bad(`label of ${e.id} overlaps ${c.kind} ${c.id}`);
          for (const z of zones) {
            for (const t of z.texts) if (intersects(inflate(p, 6), t)) bad(`label of ${e.id} overlaps a text of zone ${z.id}`);
            const crossesBorder = intersects(p, z) && !contains(z, p);
            if (crossesBorder) bad(`label of ${e.id} straddles the border of zone ${z.id}`);
          }
          for (const q of pills) {
            if (q === p || pills.indexOf(q) < pills.indexOf(p)) continue;
            if (intersects(inflate(p, 8), q)) bad(`labels of ${e.id} and ${q.edge.id} overlap`);
          }
          const a = e.points[p.segIndex];
          const b = e.points[p.segIndex + 1];
          const horizontal = Math.abs(a[1] - b[1]) < 0.05;
          const along = horizontal ? p.w : p.h;
          const lo = horizontal ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
          const hi = horizontal ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
          const pLo = horizontal ? p.x : p.y;
          const pHi = pLo + along;
          const head = EDGE_STYLES[e.style].head;
          const first = p.segIndex === 0;
          const last = p.segIndex === e.points.length - 2;
          const forward = horizontal ? b[0] > a[0] : b[1] > a[1];
          const startStub = forward ? pLo - lo : hi - pHi;
          const endStub = forward ? hi - pHi : pLo - lo;
          const needStart = first ? (e.heads === 'both' ? head + 14 : 20) : 6;
          const needEnd = last && e.heads !== 'none' ? head + 14 : last ? 20 : 6;
          if (startStub < needStart - 0.5) bad(`label of ${e.id} hides the start of its line (${r2(startStub)} < ${needStart})`);
          if (endStub < needEnd - 0.5) bad(`label of ${e.id} hides the end of its line (${r2(endStub)} < ${needEnd})`);
        }
        return problems;
      },

      render(height, lintOptions) {
        const H = height ?? Math.ceil(maxY + 20);
        const parts = [];
        const pattern = (name, w, h, rotate, body) =>
          `<pattern id="${uid}-${name}" width="${w}" height="${h}"${rotate ? ` patternTransform="rotate(${rotate})"` : ''} patternUnits="userSpaceOnUse">` +
          `<rect width="${w}" height="${h}" fill="${PAPER}"/>${body}</pattern>`;
        parts.push(
          `<defs>` +
            pattern('hatch', 14, 14, 45, `<line x1="0" y1="0" x2="0" y2="14" stroke="${INK}" stroke-width="5"/>`) +
            pattern('fine', 9, 9, -45, `<line x1="0" y1="0" x2="0" y2="9" stroke="${INK}" stroke-width="1.6"/>`) +
            pattern('dots', 14, 14, 0, `<circle cx="7" cy="7" r="2.6" fill="${INK}"/>`) +
            pattern('rows', 12, 12, 0, `<line x1="0" y1="6" x2="12" y2="6" stroke="${INK}" stroke-width="2.4"/>`) +
            `</defs>`,
        );
        for (const z of zones) {
          parts.push(
            `<g data-id="${esc(z.id)}" data-zone="${esc(z.id)}"${z.emphasis ? ' data-emphasis="true"' : ''} transform="translate(${z.x} ${z.y})">` +
              z.svg +
              (z.proposed
                ? `<rect data-dashed-frame="true" x="0" y="0" width="${z.w}" height="${z.h}" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="14 10"/>`
                : '') +
              (z.emphasis
                ? `<rect data-emphasis-frame="true" x="-7" y="-7" width="${z.w + 14}" height="${z.h + 14}" fill="none" stroke="${INK}" stroke-width="4"/>`
                : '') +
              `</g>`,
          );
        }
        for (const c of cards) {
          parts.push(
            `<g data-id="${esc(c.id)}" data-card="${esc(c.id)}"${c.emphasis ? ' data-emphasis="true"' : ''}${c.proposed ? ' data-proposed="true"' : ''} transform="translate(${c.x} ${c.y})">` +
              (c.emphasis
                ? `<rect data-emphasis-frame="true" x="-7" y="-7" width="${CARD_W + 14}" height="${CARD_H + 14}" fill="none" stroke="${INK}" stroke-width="4"/>`
                : '') +
              c.svg +
              (c.proposed
                ? `<rect data-dashed-frame="true" x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="14 10"/>`
                : '') +
              `</g>`,
          );
        }
        for (const p of panels) {
          parts.push(`<g data-id="${esc(p.id)}" data-panel="${esc(p.id)}" transform="translate(${p.x} ${p.y})">${p.svg}</g>`);
        }
        for (const x of extras) parts.push(`<g data-drawing="${esc(x.id)}">${x.svg}</g>`);
        for (const t of texts) parts.push(`<g data-free-text="true">${t.svg}</g>`);
        for (const e of edges) parts.push(edgeSvg(e));
        for (const e of edges) if (e.pill) parts.push(pillSvg(e));
        const lintProblems = api.lint(H, lintOptions);
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" class="ds-diagram-svg" data-diagram="${esc(key)}" data-variant="${variant}" ` +
          `viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-labelledby="${uid}-title ${uid}-desc" ` +
          `style="font-family:var(--st-font-sans, system-ui, sans-serif)">` +
          `<title id="${uid}-title">${esc(title || description || key)}</title><desc id="${uid}-desc">${esc(description || title || key)}</desc>` +
          parts.join('') +
          `</svg>`;
        return {
          svg,
          width,
          height: H,
          problems: lintProblems,
          cards: cards.map((c) => c.id),
          zones: zones.map((z) => z.id),
          panels: panels.map((p) => p.id),
          edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, style: e.style, label: e.name })),
          labels,
        };
      },
    };

    function headPolygon(tip, from, len, half) {
      const dx = Math.sign(tip[0] - from[0]);
      const dy = Math.sign(tip[1] - from[1]);
      const bx = tip[0] - dx * len;
      const by = tip[1] - dy * len;
      const p1 = [bx - dy * half, by + dx * half];
      const p2 = [bx + dy * half, by - dx * half];
      return `M ${r2(tip[0])} ${r2(tip[1])} L ${r2(p1[0])} ${r2(p1[1])} L ${r2(p2[0])} ${r2(p2[1])} Z`;
    }

    function linePath(points, trimStart, trimEnd, cornerRadius = 16) {
      const pts = points.map((p) => [...p]);
      const trim = (index, toward, amount) => {
        const dx = Math.sign(pts[toward][0] - pts[index][0]);
        const dy = Math.sign(pts[toward][1] - pts[index][1]);
        pts[index] = [pts[index][0] + dx * amount, pts[index][1] + dy * amount];
      };
      if (trimStart) trim(0, 1, trimStart);
      if (trimEnd) trim(pts.length - 1, pts.length - 2, trimEnd);
      let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (i === pts.length - 1) {
          d += ` L ${r2(p[0])} ${r2(p[1])}`;
          break;
        }
        const prev = pts[i - 1];
        const next = pts[i + 1];
        const radius = Math.min(cornerRadius, segLen(prev, p) / 2, segLen(p, next) / 2);
        const inX = p[0] - Math.sign(p[0] - prev[0]) * radius;
        const inY = p[1] - Math.sign(p[1] - prev[1]) * radius;
        const outX = p[0] + Math.sign(next[0] - p[0]) * radius;
        const outY = p[1] + Math.sign(next[1] - p[1]) * radius;
        d += ` L ${r2(inX)} ${r2(inY)} Q ${r2(p[0])} ${r2(p[1])} ${r2(outX)} ${r2(outY)}`;
      }
      return d;
    }

    function edgeSvg(e) {
      const style = EDGE_STYLES[e.style];
      const pts = e.points;
      const both = e.heads === 'both';
      const none = e.heads === 'none';
      const trimEnd = none ? 0 : style.head - 2;
      const trimStart = both ? style.head - 2 : 0;
      const d = linePath(pts, trimStart, trimEnd, style.radius ?? 16);
      const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
      let out =
        `<g data-relation-connector="true" data-edge="${esc(e.id)}" data-source="${esc(e.from)}" data-target="${esc(e.to)}" ` +
        `data-line-style="${e.style}"${e.bundle ? ` data-bundle="${esc(e.bundle)}"` : ''}>` +
        `<title>${esc(e.name)}</title>` +
        `<path data-connector-part="line" d="${d}" fill="none" stroke="${INK}" stroke-width="${style.width}" stroke-linejoin="round"${dash}/>`;
      if (style.inner) {
        out += `<path data-connector-inner="true" d="${d}" fill="none" stroke="${PAPER}" stroke-width="${style.inner}" stroke-linejoin="round"/>`;
      }
      if (!none) {
        out += `<path data-connector-part="head" d="${headPolygon(pts.at(-1), pts.at(-2), style.head, style.head * 0.42)}" fill="${INK}"/>`;
      }
      if (both) {
        out += `<path data-connector-part="head" d="${headPolygon(pts[0], pts[1], style.head, style.head * 0.42)}" fill="${INK}"/>`;
      }
      return out + `</g>`;
    }

    function pillSvg(e) {
      const p = e.pill;
      const strong = Boolean(EDGE_STYLES[e.style].strong);
      const text = p.lines
        .map(
          (line, i) =>
            `<text x="${r2(p.w / 2)}" y="${PILL_PAD_Y + 21 + i * PILL_LINE}" text-anchor="middle" font-size="${PILL_FONT}" font-weight="${strong ? 700 : 600}" fill="${INK}">${esc(line)}</text>`,
        )
        .join('');
      return (
        `<g class="diagram-edge-pill" data-pill-for="${esc(e.id)}"${e.bundle ? ` data-bundle="${esc(e.bundle)}"` : ''} transform="translate(${p.x} ${p.y})">` +
        `<rect x="0" y="0" width="${p.w}" height="${p.h}" rx="9" fill="${PAPER}" stroke="${INK}" stroke-width="${strong ? 3.5 : 1.5}"${e.style === 'shadow' ? ' stroke-dasharray="10 6"' : ''}/>` +
        text +
        `</g>`
      );
    }

    return api;
  }

  return { scene, esc, INK, PAPER, boldWidth, plainWidth };
}
