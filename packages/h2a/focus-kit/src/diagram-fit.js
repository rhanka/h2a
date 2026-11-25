/**
 * Display scale and responsive variant selection for Focus dossier diagrams.
 *
 * `process@1` workflows render at natural scale (minimum readable floor 0.9 inside 72ch / phone)
 * via DS `process-fit` variants (`wide` 1440 -> `narrow` 640 -> `phone` 340), never crushed by the
 * architecture-card 0.62 cap.
 *
 * Legacy `generic@1` architecture scenes keep `WIDE_DISPLAY_SCALE = 0.62`, `NARROW_DISPLAY_SCALE = 0.5`,
 * `WIDE_MIN_READABLE_SCALE = 0.36`, and `DESKTOP_STAGE_PX = 1000` for unit compatibility, while
 * DS `renderSceneSvg` outputs already carry their fitted `displayWidth` (`box.width * fit.zoom`).
 */
export const WIDE_DISPLAY_SCALE = 0.62;
export const NARROW_DISPLAY_SCALE = 0.5;
export const WIDE_MIN_READABLE_SCALE = 0.36;
export const DESKTOP_STAGE_PX = 1000;
export const PROCESS_MIN_READABLE_SCALE = 0.9;

/** CSS max-width, in px, of a variant (`displayWidth` if pre-fitted by DS, else scaled units). */
export const displayWidth = (variant, drawnWidthOrVariant) => {
  if (drawnWidthOrVariant && typeof drawnWidthOrVariant === 'object') {
    if (typeof drawnWidthOrVariant.displayWidth === 'number') {
      return drawnWidthOrVariant.displayWidth;
    }
    return displayWidth(variant, drawnWidthOrVariant.width);
  }
  return Math.round(
    drawnWidthOrVariant * (variant === 'wide' ? WIDE_DISPLAY_SCALE : NARROW_DISPLAY_SCALE),
  );
};

/** Pick the visible diagram variant for `availablePx` of container room. */
export const pickDiagramVariant = (availablePx, wideWidthOrDiagram) => {
  if (wideWidthOrDiagram && typeof wideWidthOrDiagram === 'object' && wideWidthOrDiagram.wide) {
    const diagram = wideWidthOrDiagram;
    const isProcess = diagram.profile === 'process@1';
    const wideDisplay = displayWidth('wide', diagram.wide);
    const narrowDisplay = displayWidth('narrow', diagram.narrow);
    if (isProcess) {
      if (availablePx >= wideDisplay) return 'wide';
      if (diagram.phone && availablePx < narrowDisplay) return 'phone';
      return 'narrow';
    }
    return availablePx >= DESKTOP_STAGE_PX || availablePx >= diagram.wide.width * WIDE_MIN_READABLE_SCALE
      ? 'wide'
      : 'narrow';
  }
  const wideWidth = wideWidthOrDiagram;
  return availablePx >= DESKTOP_STAGE_PX || availablePx >= wideWidth * WIDE_MIN_READABLE_SCALE
    ? 'wide'
    : 'narrow';
};
