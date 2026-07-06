/**
 * Markdown renderer (Focus-M1 L1).
 *
 * Renders a `DecisionDossierDocument` to a Markdown string. Read-only FocusSnapshot:
 * affordances appear as disabled metadata; diagrams fall back to a FENCED code block
 * (```mermaid / ```plantuml — no diagram adapter). Prose markdown is emitted verbatim
 * (or passed through an optional host `renderMarkdown` hook for normalization).
 */
import type { DecisionDossierDocument } from "../model.js";
import type { MdRenderHooks } from "./hooks.js";
/** Render a decision-dossier document to a Markdown string. */
export declare const renderMd: (doc: DecisionDossierDocument, hooks?: MdRenderHooks) => string;
