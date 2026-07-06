/**
 * Terminal renderer (Focus-M1 L1).
 *
 * Renders a `DecisionDossierDocument` to a plain-text terminal string. Read-only FocusSnapshot:
 * affordances appear as disabled metadata; diagrams fall back to text (no diagram adapter);
 * markdown prose is emitted as-is (terminal has no markdown engine).
 *
 * Align the CLI/terminal render with ARCH-21 resource_terminal / RF11 renderer (no duplication):
 * this stays a pure string builder with no ANSI/color side effects.
 */
import type { DecisionDossierDocument } from "../model.js";
export interface TerminalRenderOptions {
    /** Column width hint for rule lines. Default 72. */
    readonly width?: number;
}
/** Render a decision-dossier document to a terminal string. */
export declare const renderTerminal: (doc: DecisionDossierDocument, opts?: TerminalRenderOptions) => string;
