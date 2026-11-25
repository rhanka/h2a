/**
 * @sentropic/focus (Focus-M1 L2) — the FocusSnapshot render-core.
 *
 * Public API: the concrete decision-dossier document model, the three deterministic renderers
 * (terminal / MD / HTML — read-only snapshot), and the host render hooks (markdown injection +
 * HTML sanitization). The `/track` subpath (`@sentropic/focus/track`) binds the model to the REAL
 * `@sentropic/track/read` `DecisionDossierView` + `amendmentTrace` (L2 replaced L1's local
 * `DecisionDossierViewFixture` type + mapper).
 */
export type { Affordance, AmendmentStep, AmendmentTraceNode, ComprehensionEvidence, DecisionDossierDocument, DecisionDossierDocumentV1, DecisionDossierDocumentV2, EvidenceSource, EvidenceCitation, EvidenceGroup, EvidenceAnnex, AnnexBlock, DiagramNode, InlineDiagramNode, ReferenceDiagramNode, DiagramSyntax, DossierReadability, FocusNode, FocusDocument, ReportDocument, FocusProvenance, FocusRef, GlossaryEntry, OptionAnnotationState, OptionNode, OptionSetNode, OutcomeModality, OutcomeNode, ProseNode, QuestionNode, QuestionValidationState, SectionInput, TargetRef, } from "./model.js";
export { isEvidenceDossier, isReportDocument } from './model.js';
export type { HtmlRenderHooks, MdRenderHooks, RenderMarkdown, SanitizeHtml, } from "./render/hooks.js";
export { renderTerminal } from "./render/terminal.js";
export type { TerminalRenderOptions } from "./render/terminal.js";
export { renderMd } from "./render/md.js";
export { renderHtml } from "./render/html.js";
export type { HtmlRenderOptions } from "./render/html.js";
export { FOCUS_THEME_MAX_CSS_BYTES, validateThemeCss, validateThemeId, } from "./render/theme.js";
/** @internal Host-bridge helper consumed by `@sentropic/h2a`. */
export { extractRootThemeCustomProperties } from "./render/theme.js";
export { evidenceVolume } from './render/evidence.js';
export type { FocusEditingManifest, FocusReturn, ParagraphChange, EditTransaction } from './editing/contract.js';
export { FOCUS_ARTIFACT_TYPE, FOCUS_BINDING_NAME_PREFIX, FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH, FOCUS_DOCUMENT_PATH, FOCUS_DOSSIER_CONTRACT, FOCUS_MANIFEST_PATH, FOCUS_MAX_ANCHOR_LENGTH, FOCUS_MAX_DOCUMENT_BYTES, FOCUS_TEMPLATE_ID, FOCUS_VIEWS_CONTRACT, FOCUS_VIEWS_PATH, assertFocusArtifact, bindingNameForDocumentRef, buildDerivedFileEntry, buildFocusArtifactManifest, buildFocusViewsDocument, canonicalByteLength, canonicalJsonBytes, canonicalJsonString, checkFocusArtifact, computeNextRevisionAndRetiredRefs, digestBytes, documentDigest, extractDocumentAnchors, extractDocumentAnchorsWithPaths, isAnchorableId, isSafeBundleRelativePath, rendererManifestDigest, resolveDocumentSchemaId, validateFocusArtifactManifest, validateFocusViewsDocument, } from "./artifact/index.js";
export type { BuildFocusArtifactManifestInput, BuildFocusViewsDocumentInput, FocusAnchorEntry, FocusAnchorFamily, FocusAnchorWithPath, FocusArtifactCheckOk, FocusArtifactCheckOptions, FocusArtifactCheckRefused, FocusArtifactCheckResult, FocusArtifactManifest, FocusDerivedFileEntry, FocusDiagramDerivedEntry, FocusManifestDocument, FocusManifestFileEntry, FocusManifestGenerator, FocusManifestRenderer, FocusManifestRevision, FocusManifestValidator, FocusViewsDocument, } from "./artifact/index.js";
