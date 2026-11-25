/**
 * Theme CSS validation and root custom-property discovery for portable Focus HTML surfaces.
 *
 * Security & portability contract:
 * - Bounded size (256 KiB max) to keep offline portable dossiers self-contained and fast.
 * - Rejects `@import`, external/non-`data:` `url(...)` references, restricted image functions
 *   (`image-set(`, `-webkit-image-set(`, `image(`, `cross-fade(`, `src(`) unless every argument
 *   supplies a `data:` `url(...)` or `"data:..."` string without `var(`, `env(`, or `attr(`,
 *   `</style` breakouts, and NUL bytes.
 * - Does not relax the host CSP (`style-src 'unsafe-inline'` already permits inline `<style>`).
 */
/** Maximum allowed size (256 KiB) for an inlined theme CSS file. */
export declare const FOCUS_THEME_MAX_CSS_BYTES: number;
/** Validate a theme identifier placed in `data-theme="<id>"`. */
export declare const validateThemeId: (themeId: string) => string;
/**
 * Validate theme CSS for strict offline CSP portability.
 * Returns the CSS string unchanged if valid; throws a descriptive `Error` otherwise.
 */
export declare const validateThemeCss: (css: string) => string;
/**
 * @internal
 * Extract `--st-*` custom properties declared for the page root (`:root`, `html`, or
 * `[data-theme="<themeId>"]` when `themeId` is provided). Used by portable DS hosts so
 * root theme tokens inherit cleanly through `[data-st-theme]` wrappers.
 */
export declare const extractRootThemeCustomProperties: (css: string, themeId?: string) => string[];
