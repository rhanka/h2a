// report-revamp §C — the SHARED design-system fragment contract (the "embeddable-view contract" of
// M5-decision-presentation-DESIGN §3.3). The report and the focus dossier are the SAME presenter: both emit
// a self-contained, DS-styled `<article>` FRAGMENT (structure + namespaced classes + `data-*` variants, NO
// inline styling, NO tokens embedded), with markdown/sanitization INJECTED by the host. The design system
// supplies the CSS (`--st-*` tokens) and wrapping; a fragment is embeddable in the Svelte app OR any host.
//
// This module defines the contract ONCE. Two implementations conform to it:
//   • focus  — `@sentropic/focus` `renderHtml(DecisionDossierDocument, HtmlRenderHooks)` (the dossier side),
//              already vendored in `../focus-vendor/render/html.js`;
//   • report — `renderReportHtml(ReportView, DsFragmentHooks)` (this repo, `./html.ts`).
// Both take `(model, hooks) => sanitizedFragment` and share the SAME hooks shape (a superset of focus's
// `HtmlRenderHooks`: `renderMarkdown` is OPTIONAL because a report carries no prose). The full Svelte app
// (design-system-svelte, focus L-D) consumes this contract — it is the cross-repo DS piece, out of scope
// here; this repo ships the DS-compatible FRAGMENT that app embeds.

/** Convert markdown source to an HTML string. Host-supplied (e.g. `marked`) — only prose models need it. */
export type RenderMarkdown = (markdown: string) => string

/** Sanitize an HTML string before emission. Host-supplied (e.g. DOMPurify / sanitize-html). */
export type SanitizeHtml = (html: string) => string

/**
 * Hooks a DS fragment renderer needs from the host. A SUPERSET of focus's `HtmlRenderHooks`:
 * `sanitizeHtml` is always required (the fragment is run through it before emission); `renderMarkdown` is
 * OPTIONAL and only consulted by prose-bearing models (the dossier), so the report renderer never needs it.
 */
export interface DsFragmentHooks {
  readonly sanitizeHtml: SanitizeHtml
  readonly renderMarkdown?: RenderMarkdown
}

/** The shared presenter signature: a model → a sanitized, DS-styled `<article>` fragment string. */
export type DsFragmentPresenter<Model> = (model: Model, hooks: DsFragmentHooks) => string

/**
 * Minimal HTML text escaping for attribute/text content the renderer itself emits (§A4 — every interpolated
 * user title/ref MUST pass through this before landing in the fragment, so a forged title cannot inject
 * markup). Byte-for-byte the same escape focus's renderer uses, so the two fragments are consistent.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * The trusted-local-CLI hooks (identity sanitize): track's `--format html` is a local surface, not untrusted
 * network output — the renderer already escapes every interpolation, so identity sanitize is safe here. An
 * L4/web host (the Svelte app) supplies a REAL DOMPurify/sanitize-html hook instead.
 */
export const IDENTITY_HOOKS: DsFragmentHooks = { sanitizeHtml: (h: string): string => h }
