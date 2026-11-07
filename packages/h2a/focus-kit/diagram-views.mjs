/*!
MIT License

Copyright (c) 2026 Fabien Antoine (rhanka)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Bundled third-party code:

@sentropic/design-system-svelte@0.37.0
MIT License

Copyright (c) 2026 Sentropic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// node_modules/@sentropic/design-system-svelte/dist/diagramCardModel.js
var CARD_GEOMETRY = {
  width: 460,
  height: 200,
  borderWidth: 2,
  accentWidth: 8,
  padding: 8,
  /** Card left edge → header icon left edge (accent 8 + padding 8). */
  headerInset: 16,
  iconSize: 70,
  iconTextGap: 6,
  kicker: { size: 22, weight: 400, lineHeight: 1.3, letterSpacingEm: 0.04 },
  title: { size: 32, weight: 700, lineHeight: 1.3 },
  /** Header row → body block. */
  gap: 6,
  body: { size: 24, weight: 400, lineHeight: 1.3 },
  /** Accent-bar left edge → first body glyph. */
  bodyInsetFromBar: 14,
  ruleHeight: 1,
  ruleMargin: 4,
  ruleInsetStart: 16,
  ruleInsetEnd: 10,
  footer: { size: 24, weight: 700, lineHeight: 1.3 },
  /** Footer text-box bottom → inner edge of the bottom border. */
  footerBottomInset: 9.25,
  /**
   * Title/kicker width reservation when the toggle slot is present
   * (hrpn tints.css `header { padding-right: 66px }`: the 66 px the +/−
   * control needs in the header's inline-end).
   */
  toggleAllocation: 66,
  /** The toggle slot box itself: the 32 px DS IconButton (sm) square. */
  toggleBoxSize: 32,
  /**
   * Header text width of a folded card (toggle present, icon present):
   * the owner-pinned 290 px — the hrpn folded-card title width
   * (356 − 66 = 290). Plain cards keep `contentRight − headerTextX`
   * (358 px with the icon).
   */
  foldedHeaderTextWidth: 290,
  /** Card allocations, frozen-box-derived (see module doc). */
  allocatedLines: { kicker: 1, title: 2, body: 2, footer: 1 }
};
function lineBoxHeight(size) {
  return Math.floor(size * 1.3 * 64) / 64;
}
function baselineOf(top, size) {
  return top + (size === 24 ? 22 : size);
}
var CARD_ADVANCES_TITLE = {
  "0": 0.67,
  "1": 0.43,
  "2": 0.63,
  "3": 0.65,
  "4": 0.68,
  "5": 0.62,
  "6": 0.65,
  "7": 0.58,
  "8": 0.65,
  "9": 0.65,
  "\n": 0.24,
  " ": 0.24,
  '"': 0.55,
  "#": 0.65,
  "%": 1.02,
  "&": 0.67,
  "'": 0.34,
  "(": 0.38,
  ")": 0.38,
  "*": 0.56,
  "+": 0.68,
  ",": 0.33,
  "-": 0.47,
  ".": 0.33,
  "/": 0.39,
  ":": 0.33,
  ";": 0.34,
  "<": 0.68,
  "=": 0.68,
  ">": 0.68,
  "@": 1.02,
  "A": 0.75,
  "B": 0.66,
  "C": 0.74,
  "D": 0.72,
  "E": 0.61,
  "F": 0.59,
  "G": 0.75,
  "H": 0.75,
  "I": 0.28,
  "J": 0.58,
  "K": 0.72,
  "L": 0.57,
  "M": 0.93,
  "N": 0.76,
  "O": 0.77,
  "P": 0.65,
  "Q": 0.78,
  "R": 0.66,
  "S": 0.65,
  "T": 0.67,
  "U": 0.73,
  "V": 0.75,
  "W": 1.04,
  "X": 0.74,
  "Y": 0.73,
  "Z": 0.66,
  "[": 0.38,
  "\\": 0.39,
  "]": 0.38,
  "_": 0.48,
  "a": 0.58,
  "b": 0.63,
  "c": 0.59,
  "d": 0.63,
  "e": 0.6,
  "f": 0.4,
  "g": 0.63,
  "h": 0.62,
  "i": 0.27,
  "j": 0.27,
  "k": 0.58,
  "l": 0.27,
  "m": 0.91,
  "n": 0.62,
  "o": 0.61,
  "p": 0.63,
  "q": 0.63,
  "r": 0.41,
  "s": 0.56,
  "t": 0.37,
  "u": 0.62,
  "v": 0.6,
  "w": 0.85,
  "x": 0.58,
  "y": 0.6,
  "z": 0.57,
  "{": 0.47,
  "}": 0.47,
  "\xA7": 0.57,
  "\xAB": 0.66,
  "\xB7": 0.33,
  "\xBB": 0.66,
  "\xC0": 0.75,
  "\xC7": 0.74,
  "\xC8": 0.61,
  "\xC9": 0.61,
  "\xD7": 0.68,
  "\xE0": 0.58,
  "\xE2": 0.58,
  "\xE7": 0.59,
  "\xE8": 0.6,
  "\xE9": 0.6,
  "\xEA": 0.6,
  "\xEE": 0.27,
  "\xF4": 0.61,
  "\xF9": 0.62,
  "\u2013": 0.5,
  "\u2019": 0.31,
  "\u2026": 1,
  "\u2192": 1,
  "\u2194": 1,
  "\u2260": 0.83203,
  "\u2265": 0.83203
};
var CARD_ADVANCES_BODY = {
  "0": 0.59961,
  "1": 0.59961,
  "2": 0.59961,
  "3": 0.59961,
  "4": 0.59961,
  "5": 0.59961,
  "6": 0.59961,
  "7": 0.59961,
  "8": 0.59961,
  "9": 0.59961,
  "\n": 0.2998,
  " ": 0.2998,
  '"': 0.45996,
  "#": 0.59961,
  "%": 0.69922,
  "&": 0.67969,
  "'": 0.2998,
  "(": 0.2998,
  ")": 0.2998,
  "*": 0.59961,
  "+": 0.59961,
  ",": 0.2998,
  "-": 0.2998,
  ".": 0.2998,
  "/": 0.51953,
  ":": 0.2998,
  ";": 0.2998,
  "<": 0.59961,
  "=": 0.59961,
  ">": 0.59961,
  "@": 0.7998,
  "A": 0.55957,
  "B": 0.61914,
  "C": 0.61914,
  "D": 0.65918,
  "E": 0.55957,
  "F": 0.47949,
  "G": 0.65918,
  "H": 0.65918,
  "I": 0.25977,
  "J": 0.39941,
  "K": 0.61914,
  "L": 0.5,
  "M": 0.81934,
  "N": 0.65918,
  "O": 0.65918,
  "P": 0.55957,
  "Q": 0.65918,
  "R": 0.61914,
  "S": 0.61914,
  "T": 0.5,
  "U": 0.63965,
  "V": 0.55957,
  "W": 0.81934,
  "X": 0.53906,
  "Y": 0.55957,
  "Z": 0.53906,
  "[": 0.2998,
  "\\": 0.51953,
  "]": 0.2998,
  "_": 0.5,
  "a": 0.53906,
  "b": 0.53906,
  "c": 0.47949,
  "d": 0.53906,
  "e": 0.53906,
  "f": 0.2998,
  "g": 0.5,
  "h": 0.53906,
  "i": 0.23926,
  "j": 0.21973,
  "k": 0.5,
  "l": 0.23926,
  "m": 0.81934,
  "n": 0.53906,
  "o": 0.53906,
  "p": 0.53906,
  "q": 0.53906,
  "r": 0.31934,
  "s": 0.51953,
  "t": 0.31934,
  "u": 0.53906,
  "v": 0.43945,
  "w": 0.65918,
  "x": 0.43945,
  "y": 0.41992,
  "z": 0.41992,
  "{": 0.2998,
  "}": 0.2998,
  "\xA7": 0.59961,
  "\xAB": 0.39941,
  "\xB7": 0.23926,
  "\xBB": 0.39941,
  "\xC0": 0.55957,
  "\xC7": 0.61914,
  "\xC8": 0.55957,
  "\xC9": 0.55957,
  "\xD7": 0.59961,
  "\xE0": 0.53906,
  "\xE2": 0.53906,
  "\xE7": 0.47949,
  "\xE8": 0.53906,
  "\xE9": 0.53906,
  "\xEA": 0.53906,
  "\xEE": 0.23926,
  "\xF4": 0.53906,
  "\xF9": 0.53906,
  "\u2013": 0.55566,
  "\u2019": 0.22168,
  "\u2026": 1,
  "\u2192": 1,
  "\u2194": 1,
  "\u2260": 0.83203,
  "\u2265": 0.83203
};
function defaultCardMeasure(text, role, availableWidth) {
  const size = role === "kicker" ? CARD_GEOMETRY.kicker.size : role === "title" ? CARD_GEOMETRY.title.size : role === "footer" ? CARD_GEOMETRY.footer.size : CARD_GEOMETRY.body.size;
  const table = role === "title" || role === "footer" ? CARD_ADVANCES_TITLE : CARD_ADVANCES_BODY;
  const letterSpacing = role === "kicker" ? size * CARD_GEOMETRY.kicker.letterSpacingEm : 0;
  const measureString = (value) => {
    if (value.length === 0)
      return 0;
    const normalized = role === "kicker" ? value.toUpperCase() : value;
    let sum = 0;
    for (const char of normalized) {
      sum += (table[char] ?? 0.7) * size + letterSpacing;
    }
    return sum + 2;
  };
  const lines = [];
  let tooWide = false;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = lines.length === 0 ? word : `${lines[lines.length - 1]} ${word}`;
    if (lines.length > 0 && measureString(candidate) <= availableWidth) {
      lines[lines.length - 1] = candidate;
    } else {
      if (measureString(word) > availableWidth)
        tooWide = true;
      lines.push(word);
    }
  }
  return { lines, tooWide, lineWidths: lines.map(measureString) };
}
function firstOverflowDiagnostic(diagnostics) {
  return diagnostics.find((diagnostic) => diagnostic.code === "card-overflow" || diagnostic.code === "zone-overflow");
}
function headerSlotGeometry(opts) {
  const g = CARD_GEOMETRY;
  const kickerHeight = lineBoxHeight(g.kicker.size);
  const titleHeight = lineBoxHeight(g.title.size);
  const contentHeight = (opts.kickerLines > 0 ? kickerHeight : 0) + opts.titleLines * titleHeight;
  const blockHeight = opts.hasIcon ? Math.max(g.iconSize, contentHeight) : contentHeight;
  return {
    kickerHeight,
    titleHeight,
    contentHeight,
    blockHeight,
    textTopOffset: (blockHeight - contentHeight) / 2,
    iconTopOffset: opts.hasIcon ? (blockHeight - g.iconSize) / 2 : 0
  };
}
function layoutCard(props, measure) {
  const g = CARD_GEOMETRY;
  const diagnostics = [];
  const align = props.align ?? "left";
  const bodyMode = props.bodyMode ?? "leaf";
  const contentTop = g.borderWidth + g.padding;
  const contentRight = g.width - g.borderWidth - g.padding;
  const hasIcon = props.icon !== void 0 && props.iconGlyph !== void 0;
  const headerTextX = hasIcon ? g.headerInset + g.iconSize + g.iconTextGap : g.headerInset;
  const toggle = props.toggle !== void 0;
  const headerTextWidth = toggle ? hasIcon ? g.foldedHeaderTextWidth : contentRight - g.toggleAllocation - headerTextX : contentRight - headerTextX;
  const headerAnchor = align === "center" ? "middle" : "start";
  const headerLineX = align === "center" ? headerTextX + headerTextWidth / 2 : headerTextX;
  const pushOverflow = (slot, measured, lineHeight, allocatedLines, availableWidth, text) => {
    if (measured.tooWide) {
      const widest = measured.lineWidths === void 0 ? availableWidth + 1 : Math.max(0, ...measured.lineWidths);
      diagnostics.push({
        code: "card-overflow",
        slot,
        entityId: props.entityId,
        neededPx: widest,
        allocatedPx: availableWidth,
        text
      });
    } else {
      diagnostics.push({
        code: "card-overflow",
        slot,
        entityId: props.entityId,
        neededPx: measured.lines.length * lineHeight,
        allocatedPx: allocatedLines * lineHeight,
        text
      });
    }
  };
  if (props.icon !== void 0 && props.iconGlyph === void 0) {
    diagnostics.push({
      code: "card-icon-unknown",
      slot: "icon",
      entityId: props.entityId,
      neededPx: 1,
      allocatedPx: 0
    });
  }
  const kickerResult = props.kicker === void 0 ? void 0 : measure(props.kicker, "kicker", headerTextWidth, g.allocatedLines.kicker);
  const kickerTexts = kickerResult === void 0 ? [] : [...kickerResult.lines];
  const titleMeasured = measure(props.title, "title", headerTextWidth, g.allocatedLines.title);
  const titleTexts = [...titleMeasured.lines];
  const headerGeo = headerSlotGeometry({
    hasIcon,
    kickerLines: kickerTexts.length,
    titleLines: titleTexts.length
  });
  const kickerHeight = headerGeo.kickerHeight;
  const titleHeight = headerGeo.titleHeight;
  if (kickerResult !== void 0 && (kickerTexts.length > g.allocatedLines.kicker || kickerResult.tooWide)) {
    pushOverflow("kicker", kickerResult, kickerHeight, g.allocatedLines.kicker, headerTextWidth, props.kicker ?? "");
  }
  if (titleTexts.length > g.allocatedLines.title || titleMeasured.tooWide) {
    pushOverflow("title", titleMeasured, titleHeight, g.allocatedLines.title, headerTextWidth, props.title);
  }
  const headerBlockHeight = headerGeo.blockHeight;
  const textTop = contentTop + headerGeo.textTopOffset;
  const iconBox = hasIcon ? { x: g.headerInset, y: contentTop + headerGeo.iconTopOffset, size: g.iconSize } : void 0;
  const bodyHeight = lineBoxHeight(g.body.size);
  const bodyY = contentTop + headerBlockHeight + g.gap;
  const subtitleMode = bodyMode === "subtitle";
  const subtitleMeasure = g.width - 2 * (ZONE_GEOMETRY.collapsedInset + ZONE_GEOMETRY.collapsedSubtitleMarginInline);
  const bodyTextX = subtitleMode ? (g.width - subtitleMeasure) / 2 : g.bodyInsetFromBar;
  const bodyWidth = subtitleMode ? subtitleMeasure : contentRight - bodyTextX;
  const bodyAnchor = subtitleMode || align === "center" ? "middle" : "start";
  const bodyLineX = bodyAnchor === "middle" ? bodyTextX + bodyWidth / 2 : bodyTextX;
  const wrappedBody = [];
  const bodyLineWidths = [];
  let bodyTooWide = false;
  for (const line of props.body) {
    const measured = measure(line, "body", bodyWidth, g.allocatedLines.body);
    wrappedBody.push(...measured.lines);
    bodyLineWidths.push(...measured.lineWidths ?? []);
    bodyTooWide = bodyTooWide || measured.tooWide;
  }
  const bodySlot = subtitleMode ? "collapsed-subtitle" : "body";
  const bodySourceText = props.body.join("\n");
  let bodyOverflowPushed = false;
  if (wrappedBody.length > g.allocatedLines.body || bodyTooWide) {
    pushOverflow(bodySlot, { lines: wrappedBody, tooWide: bodyTooWide, lineWidths: bodyLineWidths }, bodyHeight, g.allocatedLines.body, bodyWidth, bodySourceText);
    bodyOverflowPushed = true;
  }
  const footerHeight = lineBoxHeight(g.footer.size);
  const footerBottom = g.height - g.borderWidth - g.footerBottomInset;
  let footerLines = [];
  let ruleY;
  if (props.footer !== void 0) {
    const footerWidth = subtitleMode ? contentRight - g.headerInset : bodyWidth;
    const footerMeasured = measure(props.footer, "footer", footerWidth, g.allocatedLines.footer);
    const footerTexts = [...footerMeasured.lines];
    if (footerTexts.length > g.allocatedLines.footer || footerMeasured.tooWide) {
      pushOverflow("footer", footerMeasured, footerHeight, g.allocatedLines.footer, footerWidth, props.footer ?? "");
    }
    const footerAnchor = align === "center" ? "middle" : "start";
    const footerLineX = footerAnchor === "middle" ? g.headerInset + footerWidth / 2 : g.headerInset;
    const footerBlockHeight = footerTexts.length * footerHeight;
    footerLines = footerTexts.map((text, index) => ({
      text,
      x: footerLineX,
      baseline: baselineOf(footerBottom - footerBlockHeight + index * footerHeight, g.footer.size),
      size: g.footer.size,
      weight: g.footer.weight,
      secondary: false,
      anchor: footerAnchor
    }));
    ruleY = footerBottom - footerBlockHeight - g.ruleHeight - g.ruleMargin;
  }
  const bodyAreaBottom = ruleY === void 0 ? g.height - g.borderWidth - g.padding : ruleY - g.ruleMargin;
  const bodyBlockHeight = wrappedBody.length * bodyHeight;
  const bodyAreaHeight = bodyAreaBottom - bodyY;
  if (!bodyOverflowPushed && wrappedBody.length > 0 && bodyBlockHeight > bodyAreaHeight) {
    diagnostics.push({
      code: "card-overflow",
      slot: bodySlot,
      entityId: props.entityId,
      neededPx: bodyBlockHeight,
      allocatedPx: bodyAreaHeight,
      text: bodySourceText
    });
  }
  const bodyBlockTop = subtitleMode ? bodyY + Math.max(0, (bodyAreaBottom - bodyY - wrappedBody.length * bodyHeight) / 2) : bodyY;
  const detailStart = wrappedBody.length - (props.detailCount ?? 0);
  const body = wrappedBody.map((text, index) => ({
    text,
    x: bodyLineX,
    baseline: baselineOf(bodyBlockTop + index * bodyHeight, g.body.size),
    size: g.body.size,
    weight: g.body.weight,
    secondary: !subtitleMode && index >= detailStart && (props.detailCount ?? 0) > 0,
    anchor: bodyAnchor
  }));
  const bodyBottom = bodyY + wrappedBody.length * bodyHeight;
  const kicker = kickerTexts.map((text, index) => ({
    text,
    x: headerLineX,
    baseline: baselineOf(textTop + index * kickerHeight, g.kicker.size),
    size: g.kicker.size,
    weight: g.kicker.weight,
    secondary: true,
    anchor: headerAnchor
  }));
  const titleTop = textTop + (kickerTexts.length > 0 ? kickerHeight : 0);
  const title = titleTexts.map((text, index) => ({
    text,
    x: headerLineX,
    baseline: baselineOf(titleTop + index * titleHeight, g.title.size),
    size: g.title.size,
    weight: g.title.weight,
    secondary: false,
    anchor: headerAnchor
  }));
  const toggleBox = props.toggle === void 0 ? void 0 : {
    x: contentRight - g.toggleBoxSize,
    y: contentTop,
    size: g.toggleBoxSize
  };
  return {
    box: { width: g.width, height: g.height },
    contentTop,
    contentRight,
    ...iconBox === void 0 ? {} : { iconBox },
    headerTextX,
    headerTextWidth,
    kicker,
    title,
    headerBlockHeight,
    bodyX: bodyTextX,
    bodyWidth,
    bodyArea: { top: bodyY, bottom: bodyAreaBottom },
    body,
    bodyBottom,
    ...ruleY === void 0 ? {} : { ruleY },
    ruleX1: g.ruleInsetStart,
    ruleX2: g.width - g.ruleInsetEnd,
    footerLines,
    footerBottom,
    ...toggleBox === void 0 ? {} : { toggleBox },
    diagnostics
  };
}
var ZONE_GEOMETRY = {
  radius: 0,
  borderWidth: 1.5,
  // Shared with the atomic card by construction (one geometry source §5.6):
  // every field below aliases CARD_GEOMETRY unless the zone frame differs.
  headerInset: CARD_GEOMETRY.headerInset,
  iconSize: CARD_GEOMETRY.iconSize,
  iconTextGap: CARD_GEOMETRY.iconTextGap,
  kicker: CARD_GEOMETRY.kicker,
  title: CARD_GEOMETRY.title,
  subtitle: CARD_GEOMETRY.body,
  /** Rendered title → subtitle gap: alias of the card `gap` (§6.4). */
  subtitleGap: CARD_GEOMETRY.gap,
  headerRuleGap: 4,
  contentInsetTop: 16,
  contentInsetBottom: 16,
  contentInsetInline: 16,
  ruleHeight: CARD_GEOMETRY.ruleHeight,
  ruleMargin: CARD_GEOMETRY.ruleMargin,
  ruleInsetStart: CARD_GEOMETRY.ruleInsetStart,
  ruleInsetEnd: CARD_GEOMETRY.ruleInsetEnd,
  footer: CARD_GEOMETRY.footer,
  footerBottomInset: CARD_GEOMETRY.footerBottomInset,
  toggleAllocation: CARD_GEOMETRY.toggleAllocation,
  toggleBoxSize: CARD_GEOMETRY.toggleBoxSize,
  /**
   * Expanded toggle top inset: the frozen SVG places every zone toggle at
   * `y + 10` (flush under the frame's top edge), while the header band
   * starts at `y + 16`.
   */
  toggleTopInset: 10,
  /**
   * Expanded header text inset from the frame's left edge: the kit wraps
   * kicker/title at `width − 178` (icon 16 + 70 + gap 6, toggle room, right
   * inset) — 314 px at the PEOPLE width 492.
   */
  headerTextInset: 178,
  collapsedWidth: CARD_GEOMETRY.width,
  collapsedHeight: CARD_GEOMETRY.height,
  collapsedInset: 16,
  collapsedSubtitleMarginInline: 16,
  allocatedLines: { kicker: 1, title: 2, subtitle: 2, footer: 1 }
};
var COLLAPSED_SUBTITLE_MEASURE = ZONE_GEOMETRY.collapsedWidth - 2 * (ZONE_GEOMETRY.collapsedInset + ZONE_GEOMETRY.collapsedSubtitleMarginInline);
function zoneCollapsedCardProps(props) {
  return {
    entityId: props.entityId,
    ...props.kicker === void 0 ? {} : { kicker: props.kicker },
    title: props.title,
    body: props.subtitle === void 0 || props.subtitle === "" ? [] : [props.subtitle],
    ...props.footer === void 0 ? {} : { footer: props.footer },
    ...props.icon === void 0 ? {} : { icon: props.icon },
    ...props.iconGlyph === void 0 ? {} : { iconGlyph: props.iconGlyph },
    ...props.tone === void 0 ? {} : { tone: props.tone },
    ...props.proposed === void 0 ? {} : { proposed: props.proposed },
    ...props.toggleLabel === void 0 ? {} : { toggle: { collapsed: true, label: props.toggleLabel } },
    ...props.align === void 0 ? {} : { align: props.align },
    bodyMode: "subtitle"
  };
}
function childLayoutHeight(child, measure) {
  if (child.kind === "card")
    return CARD_GEOMETRY.height;
  if (child.zone === void 0)
    return ZONE_GEOMETRY.collapsedHeight;
  return layoutZone(child.zone, measure, child.children ?? []).box.height;
}
function layoutZone(props, measure, children = []) {
  const g = ZONE_GEOMETRY;
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const diagnostics = [];
  if (props.collapsed) {
    const card = layoutCard(zoneCollapsedCardProps(props), measure);
    for (const diagnostic of card.diagnostics) {
      diagnostics.push({
        code: diagnostic.code === "card-icon-unknown" ? "zone-icon-unknown" : "zone-overflow",
        slot: diagnostic.slot,
        entityId: diagnostic.entityId,
        neededPx: diagnostic.neededPx,
        allocatedPx: diagnostic.allocatedPx,
        ...diagnostic.text === void 0 ? {} : { text: diagnostic.text }
      });
    }
    return {
      box: { x, y, width: g.collapsedWidth, height: g.collapsedHeight },
      collapsed: true,
      card,
      diagnostics
    };
  }
  const width = props.width ?? g.collapsedWidth;
  const contentRight = x + width - g.contentInsetInline;
  const hasIcon = props.icon !== void 0 && props.iconGlyph !== void 0;
  const headerTextX = hasIcon ? x + g.headerInset + g.iconSize + g.iconTextGap : x + g.headerInset;
  const rightHeaderReserve = props.toggleLabel === void 0 ? g.headerInset : g.headerTextInset - (g.headerInset + g.iconSize + g.iconTextGap);
  const headerTextWidth = Math.max(0, x + width - headerTextX - rightHeaderReserve);
  const align = props.align ?? "left";
  const headerAnchor = align === "center" ? "middle" : "start";
  const headerLineX = align === "center" ? headerTextX + headerTextWidth / 2 : headerTextX;
  const pushOverflow = (slot, measured, lineHeight, allocatedLines, availableWidth, text) => {
    if (measured.tooWide) {
      const widest = measured.lineWidths === void 0 ? availableWidth + 1 : Math.max(0, ...measured.lineWidths);
      diagnostics.push({
        code: "zone-overflow",
        slot,
        entityId: props.entityId,
        neededPx: widest,
        allocatedPx: availableWidth,
        text
      });
    } else {
      diagnostics.push({
        code: "zone-overflow",
        slot,
        entityId: props.entityId,
        neededPx: measured.lines.length * lineHeight,
        allocatedPx: allocatedLines * lineHeight,
        text
      });
    }
  };
  if (props.icon !== void 0 && props.iconGlyph === void 0) {
    diagnostics.push({
      code: "zone-icon-unknown",
      slot: "icon",
      entityId: props.entityId,
      neededPx: 1,
      allocatedPx: 0
    });
  }
  const subtitleLineHeight = g.subtitle.size * g.subtitle.lineHeight;
  const kickerResult = props.kicker === void 0 ? void 0 : measure(props.kicker, "kicker", headerTextWidth, g.allocatedLines.kicker);
  const kickerTexts = kickerResult === void 0 ? [] : [...kickerResult.lines];
  const titleMeasured = measure(props.title, "title", headerTextWidth, g.allocatedLines.title);
  const titleTexts = [...titleMeasured.lines];
  const headerGeo = headerSlotGeometry({
    hasIcon,
    kickerLines: kickerTexts.length,
    titleLines: titleTexts.length
  });
  const kickerHeight = headerGeo.kickerHeight;
  const titleHeight = headerGeo.titleHeight;
  if (kickerResult !== void 0 && (kickerTexts.length > g.allocatedLines.kicker || kickerResult.tooWide)) {
    pushOverflow("kicker", kickerResult, kickerHeight, g.allocatedLines.kicker, headerTextWidth, props.kicker ?? "");
  }
  if (titleTexts.length > g.allocatedLines.title || titleMeasured.tooWide) {
    pushOverflow("title", titleMeasured, titleHeight, g.allocatedLines.title, headerTextWidth, props.title);
  }
  const headerBlockHeight = headerGeo.blockHeight;
  const headerTop = y + g.headerInset;
  const textTop = headerTop + headerGeo.textTopOffset;
  const iconBox = hasIcon ? { x: x + g.headerInset, y: headerTop + headerGeo.iconTopOffset, size: g.iconSize } : void 0;
  const kicker = kickerTexts.map((text, index) => ({
    text,
    x: headerLineX,
    baseline: baselineOf(textTop + index * kickerHeight, g.kicker.size),
    size: g.kicker.size,
    weight: g.kicker.weight,
    secondary: true,
    anchor: headerAnchor
  }));
  const titleTop = textTop + (kickerTexts.length > 0 ? kickerHeight : 0);
  const title = titleTexts.map((text, index) => ({
    text,
    x: headerLineX,
    baseline: baselineOf(titleTop + index * titleHeight, g.title.size),
    size: g.title.size,
    weight: g.title.weight,
    secondary: false,
    anchor: headerAnchor
  }));
  const subtitleX = x + g.headerInset;
  const subtitleWidth = Math.min(width, g.collapsedWidth) - g.ruleInsetStart - g.ruleInsetEnd;
  const subtitleAnchor = align === "center" ? "middle" : "start";
  const subtitleLineX = align === "center" ? subtitleX + subtitleWidth / 2 : subtitleX;
  const subtitleMeasured = props.subtitle === void 0 || props.subtitle === "" ? { lines: [], tooWide: false } : measure(props.subtitle, "body", subtitleWidth, g.allocatedLines.subtitle);
  const subtitleTexts = [...subtitleMeasured.lines];
  if (subtitleTexts.length > g.allocatedLines.subtitle || subtitleMeasured.tooWide) {
    pushOverflow("subtitle", subtitleMeasured, subtitleLineHeight, g.allocatedLines.subtitle, subtitleWidth, props.subtitle ?? "");
  }
  const subtitleTop = headerTop + headerBlockHeight + g.subtitleGap;
  const subtitle = subtitleTexts.map((text, index) => ({
    text,
    x: subtitleLineX,
    baseline: baselineOf(subtitleTop + index * subtitleLineHeight, g.subtitle.size),
    size: g.subtitle.size,
    weight: g.subtitle.weight,
    secondary: false,
    anchor: subtitleAnchor
  }));
  const subtitleBottom = subtitleTexts.length === 0 ? subtitleTop : subtitleTop + (subtitleTexts.length - 1) * subtitleLineHeight + 22 + 8;
  const ruleY = subtitleTexts.length > 0 ? subtitleBottom + g.headerRuleGap : headerTop + headerBlockHeight + g.headerRuleGap;
  const contentTop = ruleY + g.contentInsetTop;
  const footerHeight = lineBoxHeight(g.footer.size);
  const footerX = x + g.contentInsetInline;
  const footerWidth = x + width - g.contentInsetInline - footerX;
  const footerMeasured = props.footer === void 0 ? void 0 : measure(props.footer, "footer", footerWidth, g.allocatedLines.footer);
  const footerTexts = footerMeasured === void 0 ? [] : [...footerMeasured.lines];
  if (footerMeasured !== void 0 && (footerTexts.length > g.allocatedLines.footer || footerMeasured.tooWide)) {
    pushOverflow("footer", footerMeasured, footerHeight, g.allocatedLines.footer, footerWidth, props.footer ?? "");
  }
  const footerBlockHeight = footerTexts.length * footerHeight;
  const childrenBottom = children.reduce((bottom, child) => Math.max(bottom, child.y + childLayoutHeight(child, measure)), y);
  const footerReserve = footerTexts.length === 0 ? 0 : footerBlockHeight + g.ruleHeight + 2 * g.ruleMargin + g.footerBottomInset;
  const requiredHeight = Math.max(childrenBottom, contentTop) + g.contentInsetBottom - y + footerReserve;
  const height = props.height ?? Math.max(g.collapsedHeight, requiredHeight);
  if (props.height !== void 0 && requiredHeight > props.height) {
    diagnostics.push({
      code: "zone-overflow",
      slot: "frame",
      entityId: props.entityId,
      neededPx: requiredHeight,
      allocatedPx: props.height,
      text: props.title
    });
  }
  const toggleBox = props.toggleLabel === void 0 ? void 0 : { x: contentRight - g.toggleBoxSize, y: y + g.toggleTopInset, size: g.toggleBoxSize };
  const footerBottom = y + height - g.borderWidth - g.footerBottomInset;
  let footer = [];
  let footerRuleY;
  if (footerMeasured !== void 0) {
    const footerAnchor = align === "center" ? "middle" : "start";
    const footerLineX = footerAnchor === "middle" ? footerX + footerWidth / 2 : footerX;
    footer = footerTexts.map((text, index) => ({
      text,
      x: footerLineX,
      baseline: baselineOf(footerBottom - footerBlockHeight + index * footerHeight, g.footer.size),
      size: g.footer.size,
      weight: g.footer.weight,
      secondary: false,
      anchor: footerAnchor
    }));
    footerRuleY = footerBottom - footerBlockHeight - g.ruleHeight - g.ruleMargin;
  }
  return {
    box: { x, y, width, height },
    collapsed: false,
    header: {
      ...iconBox === void 0 ? {} : { iconBox },
      headerTextX,
      headerTextWidth,
      kicker,
      title,
      headerBlockHeight,
      subtitle,
      subtitleWidth,
      subtitleBottom,
      ruleY,
      contentTop,
      ...toggleBox === void 0 ? {} : { toggleBox },
      footer,
      ...footerRuleY === void 0 ? {} : { footerRuleY },
      footerBottom
    },
    diagnostics
  };
}

// node_modules/@sentropic/design-system-svelte/dist/diagram-icons/registry.js
var DIAGRAM_GLYPH_BASE = "M8 53L32 44L56 53L32 62Z";
function glyph(face, line, extra) {
  return {
    base: DIAGRAM_GLYPH_BASE,
    face,
    ...line === void 0 || line === "" ? {} : { line },
    ...extra
  };
}
var DIAGRAM_GLYPHS = {
  // --- radar-immobilier fa8133c2 (19): interiors preserved verbatim, base
  // replaced by the canonical diamond (§9.1, DIF-12) ---
  s3: glyph("M12 18Q32 6 52 18L47 47Q32 58 17 47Z", "M12 18Q32 30 52 18M18 29Q32 38 46 29", {
    text: "S3"
  }),
  postgres: glyph("M12 16Q32 4 52 16V47Q32 59 12 47Z", "M12 16Q32 28 52 16M12 28Q32 40 52 28M12 40Q32 52 52 40"),
  cluster: glyph("M32 7L54 20V44L32 57L10 44V20Z", "M32 19V32M21 26L32 32L43 26M32 32V46M32 32L20 40M32 32L44 40"),
  web: glyph("M8 12H56V49H8Z", "M8 23H56M15 18H17M22 18H24M16 31H30V42H16ZM37 32H48M37 40H48"),
  api: glyph("M8 12H56V50H8Z", "M22 24L15 31L22 38M42 24L49 31L42 38M35 22L29 40"),
  cronjob: glyph("M32 8A24 24 0 1 1 31.9 8Z", "M32 16V32L43 39M17 16L12 21M47 16L52 21"),
  identity: glyph("M32 6L52 14V31Q50 48 32 58Q14 48 12 31V14Z", "M26 29V24A6 6 0 0 1 38 24V29M23 29H41V42H23ZM32 34V37"),
  workstation: glyph("M8 10H56V42H8Z", "M13 15H51V37H13ZM24 43V51M40 43V51M17 53H47M18 23L24 27L18 31M30 31H39"),
  document: glyph("M15 6H37L50 19V57H15Z", "M37 6V19H50M23 28H42M23 36H42M23 44H35"),
  map: glyph("M7 16L24 9L41 16L57 9V49L41 56L24 49L7 56Z", "M24 9V49M41 16V56M13 29L24 25L41 35L51 31"),
  join: glyph("M8 12H24V27H8ZM40 12H56V27H40ZM24 42H40V57H24Z", "M16 27V34H48V27M32 34V42", {
    darkLine: true
  }),
  graph: glyph("M7 10H23V26H7ZM41 10H57V26H41ZM24 42H40V58H24Z", "M23 18H41M15 26L27 42M49 26L37 42", { darkLine: true }),
  check: glyph("M14 8H50V57H14Z", "M23 8V15H41V8M23 35L30 42L43 27"),
  release: glyph("M12 31L32 20L52 31V50L32 61L12 50Z", "M12 31L32 42L52 31M32 42V61M32 5V25M24 13L32 5L40 13"),
  user: glyph("M22 17A10 10 0 1 1 42 17A10 10 0 1 1 22 17ZM12 54V44Q12 31 25 31H39Q52 31 52 44V54Z", "M20 44V54M44 44V54"),
  url: glyph("M32 7A25 25 0 1 1 31.9 7Z", "M7 32H57M12 19H52M12 45H52M32 7C16 19 16 45 32 57C48 45 48 19 32 7Z"),
  llm: glyph("M17 17H47V47H17Z", "M25 25H39V39H25ZM25 8V17M39 8V17M25 47V56M39 47V56M8 25H17M8 39H17M47 25H56M47 39H56"),
  network: glyph("M24 7H40V23H24ZM5 42H21V58H5ZM43 42H59V58H43Z", "M32 23V33M13 42V33H51V42", { darkLine: true }),
  unknown: glyph("M32 6L59 55H5Z", "M32 24V38M32 45V46"),
  // --- sentropic #711 via the hrpolnav kit (9): verbatim geometry on the
  // canonical base, 64-unit viewBox ---
  people: glyph("M22 10a8 8 0 1 1 0 16a8 8 0 1 1 0-16Z M42 14a7 7 0 1 1 0 14a7 7 0 1 1 0-14Z M8 46c0-9 6-15 14-15s14 6 14 15Z M34 46c0-8 4-13 9-13s12 5 12 13Z"),
  window: glyph("M9 11h46v36H9Z", "M9 19h46 M16 28h32 M16 35h22"),
  server: glyph("M14 8h36v14H14Z M14 25h36v14H14Z", "M20 15h10 M20 32h10 M42 15h.1 M42 32h.1"),
  brain: glyph("M32 12c-4-7-15-5-16 3c-8 1-11 11-6 17c-5 8 0 17 8 17c5 5 12 3 14-2c2 5 9 7 14 2c8 0 13-9 8-17c5-6 2-16-6-17c-1-8-12-10-16-3Z", "M32 12v35 M16 15c0 6 4 9 9 9 M10 32c4-4 9-3 12 1 M18 49c-2-5 0-10 5-12 M48 15c0-6-4-9-9-9 M54 32c-4-4-9-3-12 1 M46 49c2-5 0-10-5-12"),
  robot: glyph("M14 16h36v31H14Z M8 25h6v13H8Z M50 25h6v13h-6Z M29 6h6v5h-6Z", "M32 11v5 M23 27h.1 M41 27h.1 M23 38h18"),
  link: glyph("M10 12h16v14H10Z M38 30h16v14H38Z", "M26 19h12v11", { darkLine: true }),
  db: glyph("M14 13c0-4 8-7 18-7s18 3 18 7v29c0 4-8 7-18 7s-18-3-18-7Z", "M14 13c0 4 8 7 18 7s18-3 18-7 M14 27c0 4 8 7 18 7s18-3 18-7"),
  shield: glyph("M32 7l20 7v13c0 12-8 20-20 25C20 47 12 39 12 27V14Z", "M23 29l6 6 12-13"),
  cloud: glyph("M18 44a10 10 0 0 1 0-20a14 14 0 0 1 27-4a11 11 0 0 1 3 24Z")
};
var DIAGRAM_GLYPH_NAMES = Object.keys(DIAGRAM_GLYPHS);

// node_modules/@sentropic/design-system-svelte/dist/diagram-render/renderCardSvg.js
function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
var FONT_STACK = "var(--st-font-sans, system-ui, sans-serif)";
function iconGroupFor(name, glyph2, x, y, size) {
  if (glyph2 === void 0)
    return "";
  const scale = size / 64;
  const lineStroke = glyph2.darkLine === true ? "var(--st-component-diagramIcon-lineDarkStroke, var(--st-semantic-feedback-info))" : "var(--st-component-diagramIcon-lineStroke, var(--st-semantic-surface-raised))";
  return `<g class="st-diagramCard-icon" data-diagram-icon="${escapeXml(name)}" transform="translate(${x} ${y}) scale(${scale})" aria-hidden="true"><path d="${DIAGRAM_GLYPH_BASE}" fill="var(--st-component-diagramIcon-baseFill, color-mix(in srgb, var(--st-semantic-feedback-info) 18%, var(--st-semantic-surface-raised)))"/><path d="${escapeXml(glyph2.face)}" fill="var(--st-component-diagramIcon-faceFill, color-mix(in srgb, var(--st-semantic-feedback-info) 75%, var(--st-semantic-surface-raised)))" stroke="var(--st-component-diagramIcon-faceStroke, var(--st-semantic-feedback-info))" stroke-width="1.5" stroke-linejoin="round"/>` + (glyph2.line === void 0 ? "" : `<path d="${escapeXml(glyph2.line)}" fill="none" stroke="${lineStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`) + (glyph2.text === void 0 ? "" : `<text x="32" y="47" text-anchor="middle" fill="var(--st-component-diagramIcon-lineStroke, var(--st-semantic-surface-raised))" font-size="13" font-weight="750">${escapeXml(glyph2.text)}</text>`) + `</g>`;
}
function textLines(lines, className, fill, extra) {
  return lines.map((line) => `<text class="${className}" x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor === "middle" ? "middle" : "start"}" font-size="${line.size}" font-weight="${line.weight}" fill="${fill}"${extra}>${escapeXml(line.text)}</text>`).join("");
}
function renderCardContent(props, measure = defaultCardMeasure) {
  const g = CARD_GEOMETRY;
  const layout = layoutCard(props, measure);
  const parts = [];
  parts.push(`<rect x="1" y="1" width="${g.width - 2}" height="${g.height - 2}" fill="var(--st-component-diagramCard-surface, var(--st-semantic-surface-raised))" stroke="var(--st-component-diagramCard-border, var(--st-semantic-border-strong))" stroke-width="${g.borderWidth}"${props.proposed === true ? ` stroke-dasharray="var(--st-component-diagramCard-proposedDashArray, 4 5)"` : ""}/>`);
  parts.push(`<rect x="0" y="0" width="${g.accentWidth}" height="${g.height}" fill="var(--st-component-diagramCard-accent, var(--st-semantic-data-category1))"/>`);
  if (layout.iconBox !== void 0 && props.icon !== void 0) {
    parts.push(iconGroupFor(props.icon, props.iconGlyph, layout.iconBox.x, layout.iconBox.y, layout.iconBox.size));
  }
  if (layout.kicker.length > 0) {
    parts.push(textLines(layout.kicker, "st-diagramCard-kicker", "var(--st-component-diagramCard-secondaryText, var(--st-semantic-text-secondary))", ` letter-spacing="0.04em" style="text-transform:uppercase"`));
  }
  if (layout.title.length > 0) {
    parts.push(textLines(layout.title, "st-diagramCard-title", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
  }
  if (layout.body.length > 0) {
    const secondary = layout.body.filter((line) => line.secondary);
    const primary = layout.body.filter((line) => !line.secondary);
    if (primary.length > 0) {
      parts.push(textLines(primary, "st-diagramCard-body", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
    }
    if (secondary.length > 0) {
      parts.push(textLines(secondary, "st-diagramCard-detail", "var(--st-component-diagramCard-secondaryText, var(--st-semantic-text-secondary))", ""));
    }
  }
  if (layout.ruleY !== void 0) {
    parts.push(`<line class="st-diagramCard-rule" x1="${layout.ruleX1}" x2="${layout.ruleX2}" y1="${layout.ruleY}" y2="${layout.ruleY}" stroke="var(--st-component-diagramCard-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
  }
  if (layout.footerLines.length > 0) {
    parts.push(textLines(layout.footerLines, "st-diagramCard-footer", "var(--st-component-diagramCard-text, var(--st-semantic-text-primary))", ""));
  }
  if (layout.toggleBox !== void 0 && props.toggle !== void 0) {
    parts.push(toggleGlyph(props.toggle, layout.toggleBox));
  }
  return { content: parts.join(""), layout };
}
function toggleGlyph(toggle, box) {
  const center = box.size / 2;
  const arm = 7;
  const glyph2 = toggle.collapsed ? `<path d="M ${center - arm} ${center} H ${center + arm} M ${center} ${center - arm} V ${center + arm}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>` : `<path d="M ${center - arm} ${center} H ${center + arm}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  return `<g class="st-diagramCard-toggle" data-toggle="true" data-collapsed="${toggle.collapsed ? "true" : "false"}" transform="translate(${box.x} ${box.y})" color="var(--st-semantic-text-primary)" aria-hidden="true"><title>${escapeXml(toggle.label)}</title><rect width="${box.size}" height="${box.size}" fill="transparent"/>${glyph2}</g>`;
}
function renderCardSvg(props, measure = defaultCardMeasure) {
  const g = CARD_GEOMETRY;
  const { content, layout } = renderCardContent(props, measure);
  const refused = firstOverflowDiagnostic(layout.diagnostics);
  if (refused !== void 0) {
    return { kind: "refused", diagnostics: layout.diagnostics, layout };
  }
  const overflowSlots = layout.diagnostics.filter((diagnostic) => diagnostic.code === "card-overflow").map((diagnostic) => diagnostic.slot);
  const unknownIcon = layout.diagnostics.some((diagnostic) => diagnostic.code === "card-icon-unknown");
  const firstOverflow = overflowSlots.length === 0 ? void 0 : overflowSlots[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="st-diagramCard" data-entity="${escapeXml(props.entityId)}"${props.tone === void 0 ? "" : ` data-tone="${escapeXml(props.tone)}"`}${props.proposed === true ? ' data-proposed="true"' : ""}${firstOverflow === void 0 ? "" : ` data-card-overflow="${firstOverflow}"`}${unknownIcon ? ` data-card-icon-unknown=""` : ""} width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${escapeXml(props.title)}" style="font-family:${FONT_STACK}"><title>${escapeXml(props.title)}</title>` + content + `</svg>`;
  return {
    kind: "rendered",
    svg,
    diagnostics: layout.diagnostics,
    layout
  };
}

// node_modules/@sentropic/design-system-svelte/dist/diagram-render/renderZoneSvg.js
function escapeXml2(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
var FONT_STACK2 = "var(--st-font-sans, system-ui, sans-serif)";
function textLines2(lines, className, fill, extra) {
  return lines.map((line) => `<text class="${className}" x="${line.x}" y="${line.baseline}" text-anchor="${line.anchor === "middle" ? "middle" : "start"}" font-size="${line.size}" font-weight="${line.weight}" fill="${fill}"${extra}>${escapeXml2(line.text)}</text>`).join("");
}
function childContent(child, measure) {
  if (child.kind === "card") {
    if (child.card === void 0)
      throw new Error("fixture-error: card child without card props");
    const { content, layout } = renderCardContent(child.card, measure);
    const diagnostics = layout.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      slot: diagnostic.slot,
      entityId: diagnostic.entityId,
      neededPx: diagnostic.neededPx,
      allocatedPx: diagnostic.allocatedPx,
      ...diagnostic.text === void 0 ? {} : { text: diagnostic.text }
    }));
    return { content, diagnostics };
  }
  if (child.zone === void 0)
    throw new Error("fixture-error: zone child without zone props");
  const rendered = zoneContent(child.zone, child.children ?? [], measure);
  return { content: rendered.content, diagnostics: rendered.diagnostics };
}
function zoneContent(props, children, measure) {
  const g = ZONE_GEOMETRY;
  const layout = layoutZone(props, measure, children);
  const x = layout.box.x;
  const y = layout.box.y;
  const parts = [];
  const descendantDiagnostics = [];
  if (layout.collapsed) {
    const cardProps = zoneCollapsedCardProps(props);
    const { content } = renderCardContent(cardProps, measure);
    parts.push(content);
    return { content: parts.join(""), layout, diagnostics: layout.diagnostics };
  }
  const header = layout.header;
  if (header === void 0)
    throw new Error("fixture-error: expanded zone without header layout");
  const width = layout.box.width;
  const height = layout.box.height;
  parts.push(`<rect class="st-diagramZone-frame" x="0" y="0" width="${width}" height="${height}" rx="${g.radius}" fill="var(--st-component-diagramZone-surface, var(--st-semantic-surface-raised))" stroke="var(--st-component-diagramZone-border, var(--st-semantic-border-strong))" stroke-width="${g.borderWidth}"${props.proposed === true ? ` stroke-dasharray="var(--st-component-diagramZone-proposedDashArray, 4 5)"` : ""}/>`);
  if (header.iconBox !== void 0 && props.icon !== void 0) {
    parts.push(iconGroupFor(props.icon, props.iconGlyph, header.iconBox.x - x, header.iconBox.y - y, header.iconBox.size));
  }
  if (header.kicker.length > 0) {
    parts.push(textLines2(header.kicker.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-kicker", "var(--st-component-diagramZone-secondaryText, var(--st-semantic-text-secondary))", ` letter-spacing="0.04em" style="text-transform:uppercase"`));
  }
  if (header.title.length > 0) {
    parts.push(textLines2(header.title.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-title", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  if (header.subtitle.length > 0) {
    parts.push(textLines2(header.subtitle.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-subtitle", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  parts.push(`<line class="st-diagramZone-rule" x1="${g.ruleInsetStart}" x2="${width - g.ruleInsetEnd}" y1="${header.ruleY - y}" y2="${header.ruleY - y}" stroke="var(--st-component-diagramZone-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
  if (header.toggleBox !== void 0 && props.toggleLabel !== void 0) {
    parts.push(toggleGlyph({ collapsed: false, label: props.toggleLabel }, { x: header.toggleBox.x - x, y: header.toggleBox.y - y, size: header.toggleBox.size }));
  }
  if (header.footer.length > 0) {
    if (header.footerRuleY !== void 0) {
      parts.push(`<line class="st-diagramZone-footerRule" x1="${g.ruleInsetStart}" x2="${width - g.ruleInsetEnd}" y1="${header.footerRuleY - y}" y2="${header.footerRuleY - y}" stroke="var(--st-component-diagramZone-rule, var(--st-semantic-border-subtle))" stroke-width="${g.ruleHeight}" vector-effect="non-scaling-stroke"/>`);
    }
    parts.push(textLines2(header.footer.map((line) => ({ ...line, x: line.x - x, baseline: line.baseline - y })), "st-diagramZone-footer", "var(--st-component-diagramZone-text, var(--st-semantic-text-primary))", ""));
  }
  for (const child of children) {
    const rendered = childContent(child, measure);
    descendantDiagnostics.push(...rendered.diagnostics);
    parts.push(`<g class="st-diagramZone-child" data-child-kind="${child.kind}" transform="translate(${child.x - x} ${child.y - y})">${rendered.content}</g>`);
  }
  return {
    content: parts.join(""),
    layout,
    diagnostics: [...layout.diagnostics, ...descendantDiagnostics]
  };
}
function renderZoneSvg(props, opts = {}) {
  const measure = opts.measure ?? defaultCardMeasure;
  const children = opts.children ?? [];
  const { content, layout, diagnostics } = zoneContent(props, children, measure);
  if (firstOverflowDiagnostic(diagnostics) !== void 0) {
    return { kind: "refused", diagnostics, layout };
  }
  const { x, y, width, height } = layout.box;
  const overflowSlots = diagnostics.filter((diagnostic) => diagnostic.code === "zone-overflow").map((diagnostic) => diagnostic.slot);
  const unknownIcon = diagnostics.some((diagnostic) => diagnostic.code === "zone-icon-unknown");
  const firstOverflow = overflowSlots.length === 0 ? void 0 : overflowSlots[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="st-diagramZoneSvg" width="${x + width}" height="${y + height}" viewBox="0 0 ${x + width} ${y + height}" role="img" aria-label="${escapeXml2(props.title)}" style="font-family:${FONT_STACK2}"><title>${escapeXml2(props.title)}</title><g class="st-diagramZone${layout.collapsed ? " st-diagramZone--collapsed" : " st-diagramZone--expanded"}" data-entity="${escapeXml2(props.entityId)}" data-collapsed="${layout.collapsed ? "true" : "false"}"${props.tone === void 0 ? "" : ` data-tone="${escapeXml2(props.tone)}"`}${props.proposed === true ? ' data-proposed="true"' : ""}${firstOverflow === void 0 ? "" : ` data-zone-overflow="${firstOverflow}"`}${unknownIcon ? ` data-zone-icon-unknown=""` : ""} transform="translate(${x} ${y})">` + content + `</g></svg>`;
  return { kind: "rendered", svg, diagnostics, layout };
}

// src/diagram-model.js
var CARD = { width: 460, height: 200 };
var ZONE_INSET = 16;
var GRID = { columns: 2, columnGap: 60, rowGap: 50 };
function containmentOf(document) {
  const children = /* @__PURE__ */ new Map([[void 0, []]]);
  const parents = /* @__PURE__ */ new Map();
  for (const relation of Object.values(document.relations)) {
    if (relation.type !== "contains") continue;
    const parent = relation.endpoints.find((e) => e.role === "parent").target;
    const child = relation.endpoints.find((e) => e.role === "child").target;
    parents.set(child, parent);
  }
  for (const entity of Object.values(document.entities)) {
    const parent = parents.get(entity.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  return { children, parents };
}
function projectionOf(entity) {
  return { entityId: entity.id, kicker: entity.type, title: entity.attributes.name.value };
}
function interimLayout(document) {
  const { children, parents } = containmentOf(document);
  const zones = new Set(Object.values(document.entities).filter((entity) => entity.type === "container" && (children.get(entity.id)?.length ?? 0) > 0).map((entity) => entity.id));
  const widths = /* @__PURE__ */ new Map();
  const widthOf = (entityId) => {
    if (widths.has(entityId)) return widths.get(entityId);
    let width = CARD.width;
    if (zones.has(entityId)) {
      const siblings = children.get(entityId) ?? [];
      let max = CARD.width + 2 * ZONE_INSET, row = ZONE_INSET;
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
  const contentTops = /* @__PURE__ */ new Map();
  for (const zoneId of zones) {
    const probe = renderZoneSvg({ ...projectionOf(document.entities[zoneId]), collapsed: false, x: 0, y: 0, width: widthOf(zoneId) }, { children: [] });
    if (probe.kind === "refused") refusals.push(...probe.diagnostics);
    else contentTops.set(zoneId, probe.layout.header.contentTop);
  }
  const nodes = [];
  const boxes = /* @__PURE__ */ new Map();
  if (refusals.length === 0) place(void 0);
  function place(parentId) {
    const siblings = children.get(parentId) ?? [];
    const parented = parentId !== void 0;
    let rowY = parented ? contentTops.get(parentId) : 0;
    let rowHeight = 0, x = parented ? ZONE_INSET : 0;
    for (const [index, entity] of siblings.entries()) {
      const size = zones.has(entity.id) ? { width: widthOf(entity.id), height: place(entity.id).height } : CARD;
      if (zones.has(entity.id)) boxes.set(entity.id, size);
      if (index % GRID.columns === 0 && index) {
        rowY += rowHeight + GRID.rowGap;
        x = parented ? ZONE_INSET : 0;
        rowHeight = 0;
      }
      nodes.push({
        id: entity.id,
        type: "ecosystem",
        position: { x, y: rowY },
        ...parented ? { parentId, extent: "parent" } : {},
        ...zones.has(entity.id) ? { style: `width: ${size.width}px; height: ${size.height}px;` } : {},
        data: { label: entity.attributes.name.value, container: zones.has(entity.id) }
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
function interimNodes(document) {
  const layout = interimLayout(document);
  if (layout.refusals.length) {
    throw new Error(`Diagram placement refused: ${layout.refusals.map((d) => `${d.code} ${d.slot} ${d.entityId}`).join("; ")}`);
  }
  return layout.nodes;
}
function renderDiagramViews(document, options = {}) {
  const layout = interimLayout(document);
  if (layout.refusals.length) return { kind: "refused", diagnostics: layout.refusals };
  const align = options.align === "center" ? { align: "center" } : {};
  const views = {};
  const refusals = [];
  for (const entity of Object.values(document.entities)) {
    const props = { ...projectionOf(entity), ...align };
    if (!layout.boxes.has(entity.id)) {
      const card = renderCardSvg({ ...props, body: [] });
      if (card.kind === "refused") refusals.push(...card.diagnostics);
      else views[entity.id] = { kind: "card", svg: card.svg };
      continue;
    }
    const { width, height } = layout.boxes.get(entity.id);
    const expanded = renderZoneSvg({ ...props, collapsed: false, x: 0, y: 0, width, height }, { children: [] });
    const folded = expanded.kind === "rendered" ? renderZoneSvg({ ...props, collapsed: true, x: 0, y: 0, toggleLabel: `D\xE9plier : ${entity.attributes.name.value}` }, { children: [] }) : null;
    if (expanded.kind === "refused" || folded?.kind === "refused") {
      refusals.push(...expanded.kind === "refused" ? expanded.diagnostics : []);
      if (folded?.kind === "refused") refusals.push(...folded.diagnostics);
    } else {
      views[entity.id] = { kind: "zone", svg: expanded.svg, foldedSvg: folded.svg };
    }
  }
  return refusals.length ? { kind: "refused", diagnostics: refusals } : { kind: "rendered", views };
}
export {
  containmentOf,
  interimLayout,
  interimNodes,
  projectionOf,
  renderDiagramViews
};
