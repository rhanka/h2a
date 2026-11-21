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

// src/r7-diagram-kit.js
var esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
var CARD_W = 460;
var CARD_H = 200;
var PILL_FONT = 22;
var PILL_LINE = 28;
var PILL_PAD_X = 20;
var PILL_PAD_Y = 10;
var INK = "var(--st-semantic-text-primary)";
var PAPER = "var(--st-semantic-surface-raised)";
var EDGE_STYLES = {
  link: { width: 3, head: 20, dash: null, radius: 16 },
  dashed: { width: 3, head: 20, dash: "11 8", radius: 16 },
  key: { width: 7, head: 28, dash: null, radius: 16, strong: true },
  shadow: { width: 9, head: 32, dash: "24 12", radius: 16, strong: true },
  journal: { width: 14, head: 38, dash: null, inner: 5, radius: 16, strong: true }
};
var r2 = (v) => Math.round(v * 100) / 100;
var rectOf = (x, y, w, h) => ({ x, y, w, h });
var inflate = (b, d) => rectOf(b.x - d, b.y - d, b.w + 2 * d, b.h + 2 * d);
var intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
var legRect = (a, b, half = 0) => Math.abs(a[1] - b[1]) < 0.05 ? rectOf(Math.min(a[0], b[0]), a[1] - half, Math.abs(a[0] - b[0]), 2 * half) : rectOf(a[0] - half, Math.min(a[1], b[1]), 2 * half, Math.abs(a[1] - b[1]));
var segLen = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
var onBorder = (p, b) => {
  const eps = 0.05;
  const inX = p[0] >= b.x - eps && p[0] <= b.x + b.w + eps;
  const inY = p[1] >= b.y - eps && p[1] <= b.y + b.h + eps;
  const onV = Math.abs(p[0] - b.x) < eps || Math.abs(p[0] - (b.x + b.w)) < eps;
  const onH = Math.abs(p[1] - b.y) < eps || Math.abs(p[1] - (b.y + b.h)) < eps;
  return onV && inY || onH && inX;
};
var strictlyInside = (p, b) => p[0] > b.x + 0.5 && p[0] < b.x + b.w - 0.5 && p[1] > b.y + 0.5 && p[1] < b.y + b.h - 0.5;
var R7RefusalError = class extends Error {
  constructor(diagnostics) {
    super("R7 diagram view refused");
    this.name = "R7RefusalError";
    this.diagnostics = diagnostics;
  }
};
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
function createR7Kit({ ds }) {
  const measureUnwrapped = (text, role, refSize, size) => {
    if (!text) return 0;
    const m = ds.defaultCardMeasure(String(text), role, 1e5);
    const width = Math.max(0, ...m.lineWidths ?? [0]);
    return width * (size / refSize);
  };
  const boldWidth = (text, size) => measureUnwrapped(text, "title", 32, size);
  const plainWidth = (text, size) => measureUnwrapped(text, "body", 24, size) * 1.06;
  function scene({ n = 1, key = "diagram", variant = "wide", width, title = "", description = "", instance = 1 }) {
    const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, "-");
    const uid = `r7-${safeKey}-${n}${instance > 1 ? "x" + instance : ""}-${variant}`;
    const boxes = /* @__PURE__ */ new Map();
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
    const say = (text, from = "scene") => {
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
        if (side === "l") return [b.x, r2(b.y + b.h * t)];
        if (side === "r") return [b.x + b.w, r2(b.y + b.h * t)];
        if (side === "t") return [r2(b.x + b.w * t), b.y];
        if (side === "b") return [r2(b.x + b.w * t), b.y + b.h];
        throw new Error(`Unknown side ${side}`);
      },
      fx: (id, x) => (x - api.box(id).x) / api.box(id).w,
      fy: (id, y) => (y - api.box(id).y) / api.box(id).h,
      zone(id, { x, y, w, h, kicker, title: zoneTitle, subtitle, footer, icon, proposed, emphasis, from }) {
        const glyph2 = icon ? ds.DIAGRAM_GLYPHS[icon] : void 0;
        if (icon && !glyph2) throw new Error(`${uid}: unknown icon ${icon}`);
        const res = ds.renderZoneSvg(
          {
            entityId: id,
            ...kicker ? { kicker } : {},
            title: zoneTitle,
            ...subtitle ? { subtitle } : {},
            ...footer ? { footer } : {},
            ...icon ? { icon, iconGlyph: glyph2 } : {},
            ...proposed ? { proposed: true } : {},
            collapsed: false,
            x: 0,
            y: 0,
            width: w,
            height: h
          },
          { children: [] }
        );
        if (res.kind !== "rendered" || res.diagnostics.length) {
          throw new R7RefusalError(res.diagnostics);
        }
        for (const t of [kicker, zoneTitle, subtitle, footer]) say(t, from);
        const header = res.layout.header;
        const textBoxes = [];
        const addLines = (lines, role) => {
          for (const line of lines) {
            const m = ds.defaultCardMeasure(line.text, role, 1e5);
            const wText = Math.max(0, ...m.lineWidths);
            const left = line.anchor === "middle" ? line.x - wText / 2 : line.x;
            textBoxes.push(rectOf(x + left, y + line.baseline - line.size, wText, line.size * 1.3));
          }
        };
        addLines(header.kicker, "kicker");
        addLines(header.title, "title");
        addLines(header.subtitle, "body");
        addLines(header.footer, "footer");
        const b = {
          id,
          kind: "zone",
          x,
          y,
          w,
          h,
          contentTop: y + Math.ceil(header.contentTop),
          contentBottom: y + h - 16 - (footer ? 50 : 0),
          svg: res.svg,
          texts: textBoxes,
          emphasis: Boolean(emphasis),
          proposed: Boolean(proposed)
        };
        boxes.set(id, b);
        zones.push(b);
        grow(b);
        return b;
      },
      zoneContentTop({ w, kicker, title: zoneTitle, subtitle, icon, entityId = "probe" }) {
        const glyph2 = icon ? ds.DIAGRAM_GLYPHS[icon] : void 0;
        const res = ds.renderZoneSvg(
          {
            entityId,
            ...kicker ? { kicker } : {},
            title: zoneTitle,
            ...subtitle ? { subtitle } : {},
            ...icon ? { icon, iconGlyph: glyph2 } : {},
            collapsed: false,
            x: 0,
            y: 0,
            width: w
          },
          { children: [] }
        );
        if (res.kind !== "rendered") throw new R7RefusalError(res.diagnostics);
        return Math.ceil(res.layout.header.contentTop);
      },
      card(id, { x, y, icon, kicker, title: cardTitle, body = [], footer, proposed, emphasis, zone, align, from }) {
        const glyph2 = icon ? ds.DIAGRAM_GLYPHS[icon] : void 0;
        if (icon && !glyph2) throw new Error(`${uid}: unknown icon ${icon}`);
        const effectiveAlign = align ?? (body.length === 0 && !kicker && !footer ? "center" : "left");
        const props = {
          entityId: id,
          ...kicker ? { kicker } : {},
          title: cardTitle,
          body,
          ...footer ? { footer } : {},
          ...icon ? { icon, iconGlyph: glyph2 } : {},
          ...proposed ? { proposed: true } : {},
          ...effectiveAlign === "center" ? { align: "center" } : {}
        };
        const res = ds.renderCardSvg(props);
        if (res.kind !== "rendered" || res.diagnostics.length) {
          throw new R7RefusalError(res.diagnostics);
        }
        for (const t of [kicker, cardTitle, ...body, footer]) say(t, from);
        let svg = centreBody(res.svg, res.layout);
        svg = centreTitleOnly(svg, res.layout);
        const b = {
          id,
          kind: "card",
          x,
          y,
          w: CARD_W,
          h: CARD_H,
          svg,
          emphasis: Boolean(emphasis),
          proposed: Boolean(proposed),
          zone: zone ?? null,
          label: cardTitle
        };
        boxes.set(id, b);
        cards.push(b);
        grow(b);
        return b;
      },
      edge(id, { from, to, via = [], label, labelAt, style = "link", heads = "end", bundle, name, labelFrom }) {
        const start = api.at(...from);
        const end = api.at(...to);
        const points = [start];
        let cur = start;
        for (const [dir, value] of via) {
          cur = dir === "h" ? [value, cur[1]] : [cur[0], value];
          points.push(cur);
        }
        points.push(end);
        const lineList = label === void 0 || label === null || label === "" ? null : Array.isArray(label) ? label : [label];
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
          name: name ?? (lineList ? lineList.join(" ") : "")
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
            const min = i === pts.length - 2 || i === 0 && e.heads === "both" ? style.head + 8 : 14;
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
          const needStart = first ? e.heads === "both" ? head + 14 : 20 : 6;
          const needEnd = last && e.heads !== "none" ? head + 14 : last ? 20 : 6;
          if (startStub < needStart - 0.5) bad(`label of ${e.id} hides the start of its line (${r2(startStub)} < ${needStart})`);
          if (endStub < needEnd - 0.5) bad(`label of ${e.id} hides the end of its line (${r2(endStub)} < ${needEnd})`);
        }
        return problems;
      },
      render(height, lintOptions) {
        const H = height ?? Math.ceil(maxY + 20);
        const parts = [];
        const pattern = (name, w, h, rotate, body) => `<pattern id="${uid}-${name}" width="${w}" height="${h}"${rotate ? ` patternTransform="rotate(${rotate})"` : ""} patternUnits="userSpaceOnUse"><rect width="${w}" height="${h}" fill="${PAPER}"/>${body}</pattern>`;
        parts.push(
          `<defs>` + pattern("hatch", 14, 14, 45, `<line x1="0" y1="0" x2="0" y2="14" stroke="${INK}" stroke-width="5"/>`) + pattern("fine", 9, 9, -45, `<line x1="0" y1="0" x2="0" y2="9" stroke="${INK}" stroke-width="1.6"/>`) + pattern("dots", 14, 14, 0, `<circle cx="7" cy="7" r="2.6" fill="${INK}"/>`) + pattern("rows", 12, 12, 0, `<line x1="0" y1="6" x2="12" y2="6" stroke="${INK}" stroke-width="2.4"/>`) + `</defs>`
        );
        for (const z of zones) {
          parts.push(
            `<g data-id="${esc(z.id)}" data-zone="${esc(z.id)}"${z.emphasis ? ' data-emphasis="true"' : ""} transform="translate(${z.x} ${z.y})">` + z.svg + (z.proposed ? `<rect data-dashed-frame="true" x="0" y="0" width="${z.w}" height="${z.h}" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="14 10"/>` : "") + (z.emphasis ? `<rect data-emphasis-frame="true" x="-7" y="-7" width="${z.w + 14}" height="${z.h + 14}" fill="none" stroke="${INK}" stroke-width="4"/>` : "") + `</g>`
          );
        }
        for (const c of cards) {
          parts.push(
            `<g data-id="${esc(c.id)}" data-card="${esc(c.id)}"${c.emphasis ? ' data-emphasis="true"' : ""}${c.proposed ? ' data-proposed="true"' : ""} transform="translate(${c.x} ${c.y})">` + (c.emphasis ? `<rect data-emphasis-frame="true" x="-7" y="-7" width="${CARD_W + 14}" height="${CARD_H + 14}" fill="none" stroke="${INK}" stroke-width="4"/>` : "") + c.svg + (c.proposed ? `<rect data-dashed-frame="true" x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="14 10"/>` : "") + `</g>`
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
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="ds-diagram-svg" data-diagram="${esc(key)}" data-variant="${variant}" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-labelledby="${uid}-title ${uid}-desc" style="font-family:var(--st-font-sans, system-ui, sans-serif)"><title id="${uid}-title">${esc(title || description || key)}</title><desc id="${uid}-desc">${esc(description || title || key)}</desc>` + parts.join("") + `</svg>`;
        return {
          svg,
          width,
          height: H,
          problems: lintProblems,
          cards: cards.map((c) => c.id),
          zones: zones.map((z) => z.id),
          panels: panels.map((p) => p.id),
          edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, style: e.style, label: e.name })),
          labels
        };
      }
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
      const both = e.heads === "both";
      const none = e.heads === "none";
      const trimEnd = none ? 0 : style.head - 2;
      const trimStart = both ? style.head - 2 : 0;
      const d = linePath(pts, trimStart, trimEnd, style.radius ?? 16);
      const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
      let out = `<g data-relation-connector="true" data-edge="${esc(e.id)}" data-source="${esc(e.from)}" data-target="${esc(e.to)}" data-line-style="${e.style}"${e.bundle ? ` data-bundle="${esc(e.bundle)}"` : ""}><title>${esc(e.name)}</title><path data-connector-part="line" d="${d}" fill="none" stroke="${INK}" stroke-width="${style.width}" stroke-linejoin="round"${dash}/>`;
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
      const text = p.lines.map(
        (line, i) => `<text x="${r2(p.w / 2)}" y="${PILL_PAD_Y + 21 + i * PILL_LINE}" text-anchor="middle" font-size="${PILL_FONT}" font-weight="${strong ? 700 : 600}" fill="${INK}">${esc(line)}</text>`
      ).join("");
      return `<g class="diagram-edge-pill" data-pill-for="${esc(e.id)}"${e.bundle ? ` data-bundle="${esc(e.bundle)}"` : ""} transform="translate(${p.x} ${p.y})"><rect x="0" y="0" width="${p.w}" height="${p.h}" rx="9" fill="${PAPER}" stroke="${INK}" stroke-width="${strong ? 3.5 : 1.5}"${e.style === "shadow" ? ' stroke-dasharray="10 6"' : ""}/>` + text + `</g>`;
    }
    return api;
  }
  return { scene, esc, INK, PAPER, boldWidth, plainWidth };
}

// src/r7-scene-renderer.js
var ROW_CHANNEL = 136;
var COL_CHANNEL = 156;
var NARROW_CHANNEL = 128;
var ZONE_PAD = 24;
var ZONE_GAP = 14;
var MAX_COLS = 4;
var ECOSYSTEM_ICONS = {
  "entity:h2a": "robot",
  "entity:cluster-mesh": "cluster",
  "entity:llm-gateway": "api",
  "entity:llm-mesh": "llm",
  "entity:track": "check",
  "entity:engram": "brain",
  "entity:design-system": "window",
  "entity:sentropic-apps": "web",
  "entity:codex": "workstation",
  "entity:claude": "workstation",
  "entity:vibe": "workstation",
  "entity:sentropic-cli": "workstation"
};
var r22 = (v) => Math.round(v * 100) / 100;
var rectOf2 = (x, y, w, h) => ({ x, y, w, h });
var inflate2 = (b, d) => rectOf2(b.x - d, b.y - d, b.w + 2 * d, b.h + 2 * d);
var intersects2 = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var contains2 = (o, i) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
var legRect2 = (a, b, half = 0) => a[1] === b[1] ? rectOf2(Math.min(a[0], b[0]), a[1] - half, Math.abs(a[0] - b[0]), 2 * half) : rectOf2(a[0] - half, Math.min(a[1], b[1]), 2 * half, Math.abs(a[1] - b[1]));
var segLen2 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
var strictlyInside2 = (p, b) => p[0] > b.x + 0.5 && p[0] < b.x + b.w - 0.5 && p[1] > b.y + 0.5 && p[1] < b.y + b.h - 0.5;
var headOf = (style) => EDGE_STYLES[style].head;
var lastLegMin = (style) => Math.max(headOf(style) + 8, 20);
function splitLabel(label) {
  const at = label.lastIndexOf(" \xB7 ");
  if (at > 0) return [label.slice(0, at), label.slice(at + 3)];
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [label];
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const gap = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}
function wrapBodyLines(text, ds) {
  if (!text || !String(text).trim()) return [];
  const raw = String(text).trim();
  const explicitLines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const avail = 436;
  const fitsLine = (line) => {
    const m2 = ds.defaultCardMeasure(line, "body", avail, 1);
    return !m2.tooWide && m2.lines.length <= 1;
  };
  if (explicitLines.length <= 2 && explicitLines.every(fitsLine)) return explicitLines;
  const joined = explicitLines.join(" ");
  const m = ds.defaultCardMeasure(joined, "body", avail, 2);
  if (!m.tooWide && m.lines.length <= 2) return [...m.lines];
  const words = joined.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let i = Math.ceil(words.length / 2); i >= 1; i--) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      if (fitsLine(a) && fitsLine(b)) return [a, b];
    }
  }
  return [...m.lines];
}
function parseCatalogRoles(description) {
  const roles = /* @__PURE__ */ new Map();
  if (!description) return roles;
  for (const line of String(description).split(/\r?\n/)) {
    const idx = line.indexOf(" : ");
    if (idx > 0) roles.set(line.slice(0, idx).trim(), line.slice(idx + 3).trim());
  }
  return roles;
}
function textAttrValue(entity, field) {
  const attr = entity?.attributes?.[field];
  return attr && attr.kind === "text" && typeof attr.value === "string" && attr.value.trim() ? attr.value.trim() : void 0;
}
function extractModel(document, ds, options = {}) {
  const children = /* @__PURE__ */ new Map([[null, []]]);
  const parentOf = /* @__PURE__ */ new Map();
  const links = [];
  for (const rel of Object.values(document.relations ?? {})) {
    if (rel.type === "contains") {
      const parent = rel.endpoints.find((e) => e.role === "parent").target;
      const child = rel.endpoints.find((e) => e.role === "child").target;
      parentOf.set(child, parent);
    } else if (rel.type === "link") {
      const from = rel.endpoints.find((e) => e.role === "source").target;
      const to = rel.endpoints.find((e) => e.role === "target").target;
      const label = textAttrValue(rel, "label") ?? "";
      links.push({ id: rel.id, from, to, label, style: "link" });
    }
  }
  for (const entity of Object.values(document.entities ?? {})) {
    const parent = parentOf.get(entity.id) ?? null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity.id);
  }
  const catalogRoles = parseCatalogRoles(options.enrichment?.description);
  const useEcosystemIcons = Boolean(options.enrichment?.ecosystemIcons);
  const nodes = /* @__PURE__ */ new Map();
  for (const entity of Object.values(document.entities ?? {})) {
    const kids = children.get(entity.id) ?? [];
    const isZone = entity.type === "container" && kids.length > 0;
    const title = entity.attributes.name.value;
    const kicker = textAttrValue(entity, "kicker");
    const footer = textAttrValue(entity, "footer");
    const explicitDesc = textAttrValue(entity, "description");
    const catalogDesc = catalogRoles.get(title);
    const bodyText = explicitDesc ?? catalogDesc;
    const rawIcon = textAttrValue(entity, "icon") ?? (useEcosystemIcons ? ECOSYSTEM_ICONS[entity.id] : void 0);
    const icon = rawIcon && ds.DIAGRAM_GLYPHS[rawIcon] ? rawIcon : void 0;
    nodes.set(entity.id, {
      id: entity.id,
      kind: isZone ? "zone" : "card",
      parent: parentOf.get(entity.id) ?? null,
      children: kids,
      title,
      kicker,
      footer,
      icon,
      body: isZone ? [] : wrapBodyLines(bodyText, ds),
      subtitle: isZone && bodyText ? bodyText : void 0
    });
  }
  const depthOf = (id) => {
    let d = 0;
    for (let cur = parentOf.get(id); cur !== void 0; cur = parentOf.get(cur)) d++;
    return d;
  };
  for (const n of nodes.values()) n.depth = depthOf(n.id);
  return { nodes, children, parentOf, links, root: children.get(null) ?? [] };
}
function liftToScope(id, scopeParent, parentOf) {
  let cur = id;
  while (cur !== void 0 && cur !== null) {
    const p = parentOf.get(cur) ?? null;
    if (p === scopeParent) return cur;
    cur = p;
  }
  return null;
}
function computeScopeGrid(scopeParent, memberIds, model, direction) {
  if (memberIds.length === 0) return [];
  if (memberIds.length === 1) return [[memberIds[0]]];
  const memberSet = new Set(memberIds);
  const indexMap = new Map(memberIds.map((id, i) => [id, i]));
  const adj = new Map(memberIds.map((id) => [id, []]));
  const inDeg = new Map(memberIds.map((id) => [id, 0]));
  const seenEdge = /* @__PURE__ */ new Set();
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
  const rowIdx = /* @__PURE__ */ new Map();
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
  const isVertical = direction === "TB" || direction === "TD";
  const totalEdges = seenEdge.size;
  if (totalEdges === 0) {
    const cols = memberIds.length <= 3 ? memberIds.length : Math.min(MAX_COLS, Math.ceil(Math.sqrt(memberIds.length)));
    const grid2 = [];
    for (let i = 0; i < memberIds.length; i += cols) grid2.push(memberIds.slice(i, i + cols));
    return grid2;
  }
  if (isVertical) {
    const grid2 = [];
    for (const layer of layers) {
      for (let i = 0; i < layer.length; i += MAX_COLS) grid2.push(layer.slice(i, i + MAX_COLS));
    }
    return grid2;
  }
  const avgPerLayer = memberIds.length / layers.length;
  if (layers.length > MAX_COLS && avgPerLayer <= 1.5) {
    const cols = MAX_COLS;
    const rows = Math.ceil(topo.length / cols);
    const grid2 = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let i = 0; i < topo.length; i++) {
      const r = Math.floor(i / cols);
      const offset = i % cols;
      const c = r % 2 === 0 ? offset : cols - 1 - offset;
      grid2[r][c] = topo[i];
    }
    return grid2;
  }
  const maxLayerHeight = Math.max(...layers.map((l) => l.length));
  const grid = Array.from({ length: maxLayerHeight }, () => Array(layers.length).fill(null));
  for (let c = 0; c < layers.length; c++) {
    const layer = layers[c];
    for (let r = 0; r < layer.length; r++) grid[r][c] = layer[r];
  }
  return grid;
}
function computeNarrowOrder(scopeParent, model) {
  const memberIds = scopeParent === null ? model.root : model.nodes.get(scopeParent).children;
  if (memberIds.length <= 1) return [...memberIds];
  const memberSet = new Set(memberIds);
  const indexMap = new Map(memberIds.map((id, i) => [id, i]));
  const adj = new Map(memberIds.map((id) => [id, []]));
  const deg = new Map(memberIds.map((id) => [id, 0]));
  const seen = /* @__PURE__ */ new Set();
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
function assignNarrowRails(seq, links, leftRailStart, rightRailStart, railStep) {
  const idx = new Map(seq.map((id, i) => [id, i]));
  const longEdges = [];
  for (const e of links) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === void 0 || b === void 0) continue;
    if (Math.abs(a - b) > 1) longEdges.push({ id: e.id, lo: Math.min(a, b), hi: Math.max(a, b) });
  }
  longEdges.sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo);
  const leftTracks = [];
  const rightTracks = [];
  const lanes = /* @__PURE__ */ new Map();
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
    let bestSide = "r";
    let bestTrack = rightTracks.findIndex((tr) => fitsTrack(tr, item));
    const leftFit = leftTracks.findIndex((tr) => fitsTrack(tr, item));
    if (bestTrack < 0 && leftFit >= 0) {
      bestSide = "l";
      bestTrack = leftFit;
    } else if (bestTrack < 0 && leftFit < 0) {
      bestSide = rightTracks.length <= leftTracks.length ? "r" : "l";
    } else if (leftFit >= 0 && leftFit < bestTrack) {
      bestSide = "l";
      bestTrack = leftFit;
    }
    if (bestSide === "r") {
      const t = placeOnSide(rightTracks, item);
      lanes.set(item.id, { side: "r", track: t, x: rightRailStart + t * railStep });
    } else {
      const t = placeOnSide(leftTracks, item);
      lanes.set(item.id, { side: "l", track: t, x: leftRailStart - t * railStep });
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
    h: lines.length * PILL_LINE + 20
  });
  const legOk = (a, b, style, bundle, selfId) => {
    const w = EDGE_STYLES[style].width;
    const L0 = legRect2(a, b, w / 2);
    for (const c of solids) if (intersects2(L0, inflate2(c, -1))) return false;
    const Lt = legRect2(a, b, w / 2 + 6);
    for (const t of zoneTexts) if (intersects2(Lt, t)) return false;
    const aHoriz = Math.abs(a[1] - b[1]) < 0.05;
    const Le = legRect2(a, b, w / 2 + 3);
    for (const o of placed) {
      if (o.id === selfId) continue;
      if (bundle && o.bundle === bundle) continue;
      const ow = EDGE_STYLES[o.style].width;
      for (let j = 0; j < o.points.length - 1; j++) {
        const bHoriz = Math.abs(o.points[j][1] - o.points[j + 1][1]) < 0.05;
        if (allowPerpendicularCrossings && aHoriz !== bHoriz) continue;
        if (intersects2(Le, legRect2(o.points[j], o.points[j + 1], ow / 2 + 3))) return false;
      }
    }
    const Lp = legRect2(a, b, w / 2 + 2);
    for (const p of pills) {
      if (bundle && p.bundle === bundle) continue;
      if (intersects2(Lp, p)) return false;
    }
    if (canvasW && (Math.min(a[0], b[0]) < 6 || Math.max(a[0], b[0]) > canvasW - 6)) return false;
    if (Math.min(a[1], b[1]) < 6) return false;
    return true;
  };
  const pillOk = (p, bundle) => {
    if (p.x < 6 || p.y < 6) return false;
    if (canvasW && p.x + p.w > canvasW - 6) return false;
    for (const c of solids) if (intersects2(inflate2(p, 6), c)) return false;
    for (const t of zoneTexts) if (intersects2(inflate2(p, 6), t)) return false;
    for (const z of zoneFrames) if (intersects2(p, z) && !contains2(z, p)) return false;
    for (const q of pills) {
      if (bundle && q.bundle === bundle) continue;
      if (intersects2(inflate2(p, 8), q)) return false;
    }
    for (const o of placed) {
      if (bundle && o.bundle === bundle) continue;
      const ow = EDGE_STYLES[o.style].width;
      for (let j = 0; j < o.points.length - 1; j++) {
        if (intersects2(legRect2(o.points[j], o.points[j + 1], ow / 2 + 2), p)) return false;
      }
    }
    return true;
  };
  const placePill = (pts, style, label, bundle) => {
    if (!label) return null;
    const variants = [[label]];
    const two = splitLabel(label);
    if (two.length === 2) variants.push(two);
    const order = pts.slice(0, -1).map((p, i) => ({ i, len: segLen2(p, pts[i + 1]) })).sort((a, b) => b.len - a.len || a.i - b.i);
    const head = headOf(style);
    for (const lines of variants) {
      const size = pillSize(lines);
      for (const { i } of order) {
        const a = pts[i];
        const b = pts[i + 1];
        const horizontal = Math.abs(a[1] - b[1]) < 0.05;
        const along = horizontal ? size.w : size.h;
        const len = segLen2(a, b);
        const first = i === 0;
        const last = i === pts.length - 2;
        const needStart = first ? 20 : 6;
        const needEnd = last ? head + 14 : 6;
        if (len < along + needStart + needEnd + 1) continue;
        const cMin = needStart + 0.5 + along / 2;
        const cMax = len - needEnd - 0.5 - along / 2;
        const ts = /* @__PURE__ */ new Set();
        const mid = Math.min(Math.max(len / 2, cMin), cMax);
        ts.add(mid / len);
        for (let k = 0; k <= 16; k++) ts.add((cMin + (cMax - cMin) * k / 16) / len);
        const tList = [...ts].sort((p, q) => Math.abs(p - 0.5) - Math.abs(q - 0.5));
        for (const t of tList) {
          const cx = a[0] + (b[0] - a[0]) * t;
          const cy = a[1] + (b[1] - a[1]) * t;
          const p = { x: r22(cx - size.w / 2), y: r22(cy - size.h / 2), w: size.w, h: size.h };
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
      if (segLen2(a, b) < min) return false;
      if (!legOk(a, b, e.style, e.bundle, e.id)) return false;
    }
    if (strictlyInside2(pts[1], src) || strictlyInside2(pts.at(-2), dst)) return false;
    for (let i = 1; i < pts.length - 1; i++) {
      const d1 = [Math.sign(pts[i][0] - pts[i - 1][0]), Math.sign(pts[i][1] - pts[i - 1][1])];
      const d2 = [Math.sign(pts[i + 1][0] - pts[i][0]), Math.sign(pts[i + 1][1] - pts[i][1])];
      if (d1[0] === -d2[0] && d1[1] === -d2[1]) return false;
      if (d1[0] === d2[0] && d1[1] === d2[1]) return false;
    }
    return true;
  };
  const port = (b, side, t) => {
    if (side === "l") return [b.x, r22(b.y + b.h * t)];
    if (side === "r") return [b.x + b.w, r22(b.y + b.h * t)];
    if (side === "t") return [r22(b.x + b.w * t), b.y];
    return [r22(b.x + b.w * t), b.y + b.h];
  };
  const outward = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
  const H = (s) => s === "l" || s === "r";
  const T = [0.5, 0.3, 0.7, 0.4, 0.6, 0.2, 0.8];
  const TDEEP = [0.5, 0.3, 0.7, 0.2, 0.8];
  const FINE = [0.5, 0.35, 0.65, 0.25, 0.75, 0.42, 0.58, 0.18, 0.82];
  function candidates(e, src, dst, deep) {
    const out = [];
    const lane = ctx.lanes?.get(e.id);
    const XS = lane !== void 0 ? [lane.x, ...ctx.xs.filter((x) => x !== lane.x)] : ctx.xs;
    const add = (pts, sides2, k, tA, tB) => {
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) len += segLen2(pts[i], pts[i + 1]);
      const cost = len + k * 260 + (Math.abs(tA - 0.5) + Math.abs(tB - 0.5)) * 120;
      out.push({ pts, sides: sides2, k, cost, tA, tB });
    };
    if (deep) {
      const sides2 = ["l", "r", "t", "b"];
      for (const sa of sides2) {
        for (const sb of sides2) {
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
    const ov = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
    if (src.x + src.w <= dst.x || dst.x + dst.w <= src.x) {
      const [lo, hi] = ov(src.y, src.y + src.h, dst.y, dst.y + dst.h);
      if (hi - lo > 20) {
        const right = src.x + src.w <= dst.x;
        for (const f of FINE) {
          const y = r22(lo + (hi - lo) * f);
          const a = [right ? src.x + src.w : src.x, y];
          const b = [right ? dst.x : dst.x + dst.w, y];
          add([a, b], right ? ["r", "l"] : ["l", "r"], 0, (y - src.y) / src.h, (y - dst.y) / dst.h);
        }
      }
    }
    if (src.y + src.h <= dst.y || dst.y + dst.h <= src.y) {
      const [lo, hi] = ov(src.x, src.x + src.w, dst.x, dst.x + dst.w);
      if (hi - lo > 20) {
        const down = src.y + src.h <= dst.y;
        for (const f of FINE) {
          const x = r22(lo + (hi - lo) * f);
          const a = [x, down ? src.y + src.h : src.y];
          const b = [x, down ? dst.y : dst.y + dst.h];
          add([a, b], down ? ["b", "t"] : ["t", "b"], 0, (x - src.x) / src.w, (x - dst.x) / dst.w);
        }
      }
    }
    const sides = ["l", "r", "t", "b"];
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
    route
  };
}
function renderR7Diagram(document, ds, options = {}) {
  const kit = createR7Kit({ ds });
  const model = extractModel(document, ds, options);
  const direction = options.direction ?? "LR";
  const key = options.id ?? document.documentId ?? "diagram";
  const title = options.title ?? options.alt ?? key;
  const description = options.alt ?? options.description ?? title;
  const pillSize = (lines) => ({
    w: Math.ceil(Math.max(...lines.map((l) => kit.boldWidth(l, PILL_FONT))) * 1.04 + 40),
    h: lines.length * PILL_LINE + 20
  });
  const headerCache = /* @__PURE__ */ new Map();
  const headerOf = (node, w) => {
    const cacheKey = `${node.id}|${w}`;
    if (!headerCache.has(cacheKey)) {
      const probe = kit.scene({ key: "probe", variant: "probe", width: 2e3, title: "", description: "" });
      headerCache.set(
        cacheKey,
        probe.zoneContentTop({
          entityId: node.id,
          w,
          kicker: node.kicker,
          title: node.title,
          subtitle: node.subtitle,
          icon: node.icon
        }) + 4
      );
    }
    return headerCache.get(cacheKey);
  };
  const scopeGrids = /* @__PURE__ */ new Map();
  scopeGrids.set(null, computeScopeGrid(null, model.root, model, direction));
  for (const n of model.nodes.values()) {
    if (n.kind === "zone") scopeGrids.set(n.id, computeScopeGrid(n.id, n.children, model, direction));
  }
  function placeWide(extra) {
    const ext = /* @__PURE__ */ new Map();
    const local = /* @__PURE__ */ new Map();
    const extent = (id) => {
      if (ext.has(id)) return ext.get(id);
      const n = model.nodes.get(id);
      if (n.kind !== "zone") {
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
      g.forEach(
        (row, i) => row.forEach((cellId, j) => {
          if (!cellId) return;
          cells.push({ id: cellId, i, j });
          const e = extent(cellId);
          rowSpan[i] = Math.max(rowSpan[i], e.rows);
          colSpan[j] = Math.max(colSpan[j], e.cols);
        })
      );
      local.set(id, { rowSpan, colSpan, cells });
      return { rows: rowSpan.reduce((a, b) => a + b, 0), cols: colSpan.reduce((a, b) => a + b, 0) };
    };
    const rootExt = measure(null);
    const cell = /* @__PURE__ */ new Map();
    const span = /* @__PURE__ */ new Map();
    const place = (id, r0, c0) => {
      const { rowSpan, colSpan, cells } = local.get(id);
      const rowStart = [];
      const colStart = [];
      rowSpan.reduce((acc, s, i) => (rowStart[i] = acc, acc + s), 0);
      colSpan.reduce((acc, s, j) => (colStart[j] = acc, acc + s), 0);
      for (const c of cells) {
        const e = extent(c.id);
        const r = r0 + rowStart[c.i];
        const col = c0 + colStart[c.j];
        const n = model.nodes.get(c.id);
        if (n.kind === "zone") {
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
    const inset = /* @__PURE__ */ new Map();
    const insetOf = (id) => {
      if (inset.has(id)) return inset.get(id);
      const s = span.get(id);
      const kids = childZones(id);
      const node = model.nodes.get(id);
      const head = headerOf(node, 1e3);
      const v = {
        top: head + ZONE_GAP + Math.max(0, ...kids.filter((k) => span.get(k).r0 === s.r0).map((k) => insetOf(k).top)),
        bottom: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).r1 === s.r1).map((k) => insetOf(k).bottom)),
        left: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).c0 === s.c0).map((k) => insetOf(k).left)),
        right: ZONE_PAD + Math.max(0, ...kids.filter((k) => span.get(k).c1 === s.c1).map((k) => insetOf(k).right))
      };
      inset.set(id, v);
      return v;
    };
    zoneIds.forEach(insetOf);
    const stack = (pick, pred) => Math.max(0, ...zoneIds.filter(pred).map((z) => insetOf(z)[pick]));
    const topStack = (r) => stack("top", (z) => span.get(z).r0 === r);
    const bottomStack = (r) => stack("bottom", (z) => span.get(z).r1 === r);
    const leftStack = (c) => stack("left", (z) => span.get(z).c0 === c);
    const rightStack = (c) => stack("right", (z) => span.get(z).c1 === c);
    const rowChannel = Array(R).fill(ROW_CHANNEL);
    const colChannel = Array(C).fill(COL_CHANNEL);
    const colNeed = /* @__PURE__ */ new Map();
    const rowNeed = /* @__PURE__ */ new Map();
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
    const rects = /* @__PURE__ */ new Map();
    for (const [id, p] of cell) rects.set(id, rectOf2(colX[p.c], rowY[p.r], CARD_W, CARD_H));
    for (const id of zoneIds) {
      const s = span.get(id);
      const ins = insetOf(id);
      const x = colX[s.c0] - ins.left;
      const y = rowY[s.r0] - ins.top;
      rects.set(id, rectOf2(x, y, colX[s.c1] + CARD_W + ins.right - x, rowY[s.r1] + CARD_H + ins.bottom - y));
    }
    const xs = /* @__PURE__ */ new Set();
    const ys = /* @__PURE__ */ new Set();
    const lanes = (lo, hi, set) => {
      if (hi - lo < 24) return;
      const n = 5;
      for (let k = 0; k <= n; k++) set.add(Math.round(lo + 12 + (hi - lo - 24) * k / n));
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
    const opens = /* @__PURE__ */ new Map();
    const closes = /* @__PURE__ */ new Map();
    const maxZoneDepth = Math.max(-1, ...[...model.nodes.values()].filter((n) => n.kind === "zone").map((n) => n.depth));
    const zoneLevels = maxZoneDepth + 1;
    const walk = (scopeParent, depth) => {
      for (const id of computeNarrowOrder(scopeParent, model)) {
        const n = model.nodes.get(id);
        if (n.kind === "zone") {
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
    const perGap = /* @__PURE__ */ new Map();
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
    const rects = /* @__PURE__ */ new Map();
    seq.forEach((id, i) => rects.set(id, rectOf2(nx, yOf[i], CARD_W, CARD_H)));
    const zoneIds = [];
    for (const [first, list] of opens) {
      for (const z of list) {
        let last = first;
        for (const [end, cl] of closes) if (cl.some((c) => c.id === z.id)) last = end;
        const outerOpens = opens.get(first) ?? [];
        const innerTop = outerOpens.filter((o) => o.depth > z.depth).reduce((s, o) => s + headOfZone(o) + ZONE_GAP, 0);
        const innerClose = (closes.get(last) ?? []).filter((c) => c.depth > z.depth).length * ZONE_PAD;
        const top = yOf[first] - innerTop - headOfZone(z) - ZONE_GAP;
        const bottom2 = yOf[last] + CARD_H + innerClose + ZONE_PAD;
        rects.set(z.id, rectOf2(zoneXForDepth(z.depth), top, zoneWidthForDepth(z.depth), bottom2 - top));
        zoneIds.push(z.id);
      }
    }
    zoneIds.sort((a, b) => model.nodes.get(a).depth - model.nodes.get(b).depth);
    const xsSet = /* @__PURE__ */ new Set();
    for (let t = 0; t < Math.max(3, railPlan.leftCount + 1); t++) {
      const rx = leftRailStart - t * railStep;
      if (rx >= 10) xsSet.add(rx);
    }
    for (let t = 0; t < Math.max(3, railPlan.rightCount + 1); t++) {
      const rx = rightRailStart + t * railStep;
      if (rx <= narrowW - 10) xsSet.add(rx);
    }
    for (const f of [0.25, 0.5, 0.75]) xsSet.add(Math.round(nx + CARD_W * f));
    const ysSet = /* @__PURE__ */ new Set();
    for (let i = 1; i < seq.length; i++) {
      const lo = yOf[i - 1] + CARD_H + bottomStack(i - 1);
      const hi = yOf[i] - topStack(i);
      if (hi - lo >= 24) {
        for (let k = 0; k <= 5; k++) ysSet.add(Math.round(lo + 12 + (hi - lo - 24) * k / 5));
      }
    }
    const bottom = Math.max(0, ...[...rects.values()].map((b) => b.y + b.h));
    for (const d of [36, 72, 108, 144]) ysSet.add(Math.round(bottom + d));
    return { rects, zoneIds, xs: [...xsSet].sort((a, b) => a - b), ys: [...ysSet].sort((a, b) => a - b), lanes: railPlan.lanes, canvasW: narrowW };
  }
  function buildVariant(variant) {
    const wide = variant === "wide";
    const attemptWith = (extra, allowPerpendicularCrossings) => {
      const priority = [];
      let last = null;
      const maxAttempts = Math.min(model.links.length + 2, 12);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const lay = wide ? placeWide(extra) : placeNarrow(extra);
        const { rects, zoneIds } = lay;
        const probe = kit.scene({ key, variant: "probe", width: 1e5, title: "", description: "" });
        const zoneTexts = [];
        const zoneFrames = [];
        for (const id of zoneIds) {
          const r = rects.get(id);
          const n = model.nodes.get(id);
          const z = probe.zone(id, { x: r.x, y: r.y, w: r.w, h: r.h, kicker: n.kicker, title: n.title, subtitle: n.subtitle, icon: n.icon });
          zoneTexts.push(...z.texts);
          if (n.icon) zoneTexts.push(rectOf2(r.x + 16, r.y + 16, 70, 70));
          zoneFrames.push(r);
        }
        const leaves = [...model.nodes.values()].filter((n) => n.kind === "card").map((n) => n.id);
        const solids = leaves.map((id) => rects.get(id));
        const ctx = { solids, zoneFrames, zoneTexts, xs: lay.xs, ys: lay.ys, lanes: lay.lanes ?? null, canvasW: lay.canvasW };
        const rt = createRouter(kit, ctx, { allowPerpendicularCrossings });
        const routes = /* @__PURE__ */ new Map();
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
            ...rt.placed.flatMap((p) => p.points.map((q) => rectOf2(q[0], q[1], 0, 0)))
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
              footer: n.footer
            });
          }
          for (const e of model.links) {
            const r = routes.get(e.id);
            if (!r) continue;
            const pts = r.pts;
            const src = rects.get(e.from);
            const dst = rects.get(e.to);
            const sideOf = (p, b) => Math.abs(p[0] - b.x) < 0.05 ? "l" : Math.abs(p[0] - (b.x + b.w)) < 0.05 ? "r" : Math.abs(p[1] - b.y) < 0.05 ? "t" : "b";
            const fracOf = (p, b, side) => side === "l" || side === "r" ? (p[1] - b.y) / b.h : (p[0] - b.x) / b.w;
            const sa = sideOf(pts[0], src);
            const sb = sideOf(pts.at(-1), dst);
            const via = [];
            for (let i = 1; i < pts.length - 1; i++) {
              via.push(Math.abs(pts[i][1] - pts[i - 1][1]) < 0.05 ? ["h", pts[i][0]] : ["v", pts[i][1]]);
            }
            s.edge(e.id, {
              from: [e.from, sa, fracOf(pts[0], src, sa)],
              to: [e.to, sb, fracOf(pts.at(-1), dst, sb)],
              via,
              style: e.style,
              ...r.pill ? { label: r.pill.lines.length === 1 ? r.pill.lines[0] : r.pill.lines, labelAt: [r.pill.segIndex, r.pill.t] } : {},
              name: e.label || `${model.nodes.get(e.from)?.title ?? e.from} \u2192 ${model.nodes.get(e.to)?.title ?? e.to}`
            });
          }
          return { ok: true, out: s.render(H, { allowPerpendicularCrossings }) };
        }
        last = { ok: false, failures };
        const bumped = failures.find((id) => !priority.includes(id));
        if (!bumped) break;
        priority.unshift(bumped);
      }
      return last ?? { ok: false, failures: ["layout"] };
    };
    for (let step = 0; step < 5; step++) {
      const res = attemptWith({ all: step * 60 }, false);
      if (res.ok) return res.out;
    }
    for (let step = 0; step < 4; step++) {
      const res = attemptWith({ all: step * 80 }, true);
      if (res.ok) return res.out;
    }
    throw new Error(`r7 diagram ${key}-${variant}: could not find non-overlapping orthogonal layout`);
  }
  try {
    const wide = buildVariant("wide");
    const narrow = buildVariant("narrow");
    return {
      kind: "rendered",
      renderer: "r7",
      wide,
      narrow
    };
  } catch (error) {
    if (error instanceof R7RefusalError) {
      return { kind: "refused", diagnostics: error.diagnostics };
    }
    throw error;
  }
}

// src/diagram-model.js
var DS_RENDER_PRIMITIVES = {
  renderCardSvg,
  renderZoneSvg,
  DIAGRAM_GLYPHS,
  CARD_GEOMETRY,
  ZONE_GEOMETRY,
  defaultCardMeasure
};
function renderR7Diagram2(document, options = {}) {
  return renderR7Diagram(document, DS_RENDER_PRIMITIVES, options);
}
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
  const zones = new Set(
    Object.values(document.entities).filter((entity) => entity.type === "container" && (children.get(entity.id)?.length ?? 0) > 0).map((entity) => entity.id)
  );
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
    const probe = renderZoneSvg(
      { ...projectionOf(document.entities[zoneId]), collapsed: false, x: 0, y: 0, width: widthOf(zoneId) },
      { children: [] }
    );
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
  CARD_GEOMETRY,
  CARD_H,
  CARD_W,
  DIAGRAM_GLYPHS,
  DS_RENDER_PRIMITIVES,
  EDGE_STYLES,
  ZONE_GEOMETRY,
  containmentOf,
  createR7Kit,
  defaultCardMeasure,
  interimLayout,
  projectionOf,
  renderCardSvg,
  renderDiagramViews,
  renderR7Diagram2 as renderR7Diagram,
  renderZoneSvg
};
