/**
 * HTML renderer (Focus-M1 L1) — MANDATORY surface.
 *
 * Renders a `DecisionDossierDocument` to an HTML string. Read-only FocusSnapshot:
 * affordances appear as DISABLED metadata; diagrams fall back to a `<pre>` block (no diagram
 * adapter). Markdown prose is converted via the host-supplied `renderMarkdown` hook (NO `marked`
 * dep, NO mdast core); the full document HTML is run through the host `sanitizeHtml` hook before
 * emission. The renderer core owns structure only; hosts own sanitization/styling.
 */
import type { DecisionDossierDocument } from "../model.js";
import type { HtmlRenderHooks } from "./hooks.js";
/** Render a decision-dossier document to a sanitized HTML string. */
export declare const renderHtml: (doc: DecisionDossierDocument, hooks: HtmlRenderHooks) => string;
