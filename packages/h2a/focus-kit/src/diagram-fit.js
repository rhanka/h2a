/**
 * Display scale of the static r7 diagrams.
 *
 * The r7 scene is drawn in fixed units (460 x 200 cards, 32-unit titles, 22-unit edge labels) that
 * are meant to be shown reduced, never at scale 1. Both variants therefore carry an explicit cap:
 * the wide one at 0.62 (20 px titles) and the single-column narrow one at 0.5 (16 px titles, a
 * 640-unit column shown 320 px wide, sized for a phone).
 *
 * The variant is chosen per diagram from the width actually available to it, not from a page
 * breakpoint: the horizontal layout is kept for as long as it stays readable, i.e. down to 0.36
 * (11.5 px titles). Below that the compact column takes over, except on a desktop-size stage,
 * where a large two-dimensional scene stays horizontal as it always has: a 320 px column of
 * every card would be a tower there.
 */
export const WIDE_DISPLAY_SCALE = 0.62;
export const NARROW_DISPLAY_SCALE = 0.5;
export const WIDE_MIN_READABLE_SCALE = 0.36;
export const DESKTOP_STAGE_PX = 1000;

/** CSS max-width, in px, of a variant drawn `drawnWidth` units wide. */
export const displayWidth = (variant, drawnWidth) =>
  Math.round(drawnWidth * (variant === 'wide' ? WIDE_DISPLAY_SCALE : NARROW_DISPLAY_SCALE));

/** Variant to show for a wide drawing of `wideWidth` units inside `availablePx` of room. */
export const pickDiagramVariant = (availablePx, wideWidth) =>
  availablePx >= DESKTOP_STAGE_PX || availablePx >= wideWidth * WIDE_MIN_READABLE_SCALE ? 'wide' : 'narrow';
