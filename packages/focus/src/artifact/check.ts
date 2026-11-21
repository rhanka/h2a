import { isReportDocument } from "../model.js";
import type { FocusDocument } from "../model.js";
import {
  DecisionDossierValidationError,
  validateDecisionDossierReadability,
  validateFocusDocument,
} from "../validation/index.js";
import type { ReadabilityOptions, ValidationIssue } from "../validation/index.js";

import {
  FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH,
  FOCUS_MAX_ANCHOR_LENGTH,
  FOCUS_MAX_DOCUMENT_BYTES,
  bindingNameForDocumentRef,
  canonicalJsonString,
  computeNextRevisionAndRetiredRefs,
  digestBytes,
  extractDocumentAnchors,
  extractDocumentAnchorsWithPaths,
  resolveDocumentSchemaId,
  validateFocusArtifactManifest,
} from "./manifest.js";
import type { FocusAnchorEntry, FocusArtifactManifest } from "./manifest.js";

const DISALLOWED_ANCHOR_CHARS_RE = /[\s\u0000-\u001f\u007f-\u009f]/;

export interface FocusArtifactCheckOptions {
  /** Optional previous focus.manifest.json: activates revision rules R3 and R4. */
  readonly previousManifest?: unknown;
  /** Maximum canonical UTF-8 byte length of dossier.json (defaults to 1 048 576; null disables). */
  readonly maxDocumentBytes?: number | null;
  /** Maximum UTF-16 length of `focus:<doc.ref>` bindingName (defaults to 128, radar profile). */
  readonly maxBindingNameLength?: number;
  /** Skip readability gate when caller checks structural/artifact identity only (defaults to false). */
  readonly skipReadability?: boolean;
  /** Optional readability profile forwarded to validateDecisionDossierReadability. */
  readonly readabilityOptions?: ReadabilityOptions;
}

export interface FocusArtifactCheckOk {
  readonly ok: true;
  readonly document: FocusDocument;
  readonly documentType: "decision" | "report";
  readonly schemaId: string;
  readonly bindingName: string;
  readonly documentDigest: string;
  readonly bytes: number;
  readonly canonicalJson: string;
  readonly anchors: readonly FocusAnchorEntry[];
  readonly retiredRefs: readonly string[];
  readonly revisionSeq: number;
}

export interface FocusArtifactCheckRefused {
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
}

export type FocusArtifactCheckResult =
  | FocusArtifactCheckOk
  | FocusArtifactCheckRefused;

/** R5: non-empty, <= 128 characters, no whitespace and no control characters. */
export function isAnchorableId(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= FOCUS_MAX_ANCHOR_LENGTH &&
    !DISALLOWED_ANCHOR_CHARS_RE.test(value)
  );
}

/**
 * Common Focus artifact gate (FA-H1 / SPEC-r3 §2.4 & §2.7).
 *
 * Always checks:
 * - Closed schema + semantic rules including R2 (`duplicate_id`) across all v1/v2 families
 * - Presentation readability gate (unless `skipReadability: true`)
 * - R5 (`focus-anchor-not-anchorable`) on `doc.ref` (header anchor) and every entity `id`
 * - R6 (`focus-anchor-equals-document-ref`) on every entity `id`
 * - `focus:<doc.ref>` bindingName profile ceiling (default 128)
 * - Canonical `dossier.json` UTF-8 size ceiling (default 1 048 576 bytes)
 *
 * When `previousManifest` is provided, also checks:
 * - R3 (`focus-anchor-kind-changed`) on every retained `id`
 * - R4 (`focus-anchor-reused`) against cumulative `previousManifest.retiredRefs`
 */
export function checkFocusArtifact(
  input: unknown,
  options: FocusArtifactCheckOptions = {},
): FocusArtifactCheckResult {
  const structural = validateFocusDocument(input);
  if (!structural.ok) return { ok: false, issues: structural.issues };

  const doc = structural.value;
  const issues: ValidationIssue[] = [];

  if (!options.skipReadability) {
    issues.push(...validateDecisionDossierReadability(doc, options.readabilityOptions));
  }

  // Header anchor (doc.ref) must satisfy R5 and profile bindingName length.
  if (!isAnchorableId(doc.ref)) {
    issues.push({
      path: "$.ref",
      code: "focus-anchor-not-anchorable",
      message: `document ref ${JSON.stringify(doc.ref)} must be 1–${FOCUS_MAX_ANCHOR_LENGTH} characters with no whitespace or control characters`,
    });
  }

  const maxBindingNameLength =
    options.maxBindingNameLength ?? FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH;
  const bindingName = bindingNameForDocumentRef(doc.ref);
  if (bindingName.length > maxBindingNameLength) {
    issues.push({
      path: "$.ref",
      code: "focus-binding-name-too-long",
      message: `bindingName "${bindingName}" has length ${bindingName.length}, exceeding profile limit ${maxBindingNameLength}`,
    });
  }

  // R5 & R6 across every anchorable entity (section, option, source, citation, evidenceGroup, annex).
  const anchorsWithPaths = extractDocumentAnchorsWithPaths(doc);
  for (const entry of anchorsWithPaths) {
    if (!isAnchorableId(entry.id)) {
      issues.push({
        path: entry.path,
        code: "focus-anchor-not-anchorable",
        message: `anchor id ${JSON.stringify(entry.id)} must be 1–${FOCUS_MAX_ANCHOR_LENGTH} characters with no whitespace or control characters`,
      });
    }
    if (entry.id === doc.ref) {
      issues.push({
        path: entry.path,
        code: "focus-anchor-equals-document-ref",
        message: `node id "${entry.id}" collides with document ref "${doc.ref}", which is reserved for the header anchor`,
      });
    }
  }

  // Canonical bytes without trailing newline + document size ceiling.
  const canonical = canonicalJsonString(doc);
  const canonicalBytes = new TextEncoder().encode(canonical);
  const digest = digestBytes(canonicalBytes);
  const maxDocumentBytes =
    options.maxDocumentBytes === undefined ? FOCUS_MAX_DOCUMENT_BYTES : options.maxDocumentBytes;
  if (maxDocumentBytes !== null && canonicalBytes.byteLength > maxDocumentBytes) {
    issues.push({
      path: "$",
      code: "focus-document-too-large",
      message: `canonical dossier.json is ${canonicalBytes.byteLength} bytes, exceeding the ${maxDocumentBytes}-byte limit`,
    });
  }

  // Revision rules R3 & R4 apply only when previousManifest is supplied.
  let previousManifest: FocusArtifactManifest | undefined;
  if (options.previousManifest !== undefined) {
    const manifestCheck = validateFocusArtifactManifest(options.previousManifest);
    if (!manifestCheck.ok) {
      for (const issue of manifestCheck.issues) {
        const suffix = issue.path === "$" ? "" : issue.path.slice(1);
        issues.push({
          path: `$.previousManifest${suffix}`,
          code: issue.code,
          message: issue.message,
        });
      }
    } else {
      previousManifest = manifestCheck.value;
      const previousById = new Map(previousManifest.anchors.map((a) => [a.id, a]));
      const retiredSet = new Set(previousManifest.retiredRefs);

      for (const entry of anchorsWithPaths) {
        if (retiredSet.has(entry.id)) {
          issues.push({
            path: entry.path,
            code: "focus-anchor-reused",
            message: `retired anchor id "${entry.id}" cannot be reused in a later revision`,
          });
          continue;
        }
        const prev = previousById.get(entry.id);
        if (prev !== undefined && (prev.family !== entry.family || prev.kind !== entry.kind)) {
          issues.push({
            path: entry.path,
            code: "focus-anchor-kind-changed",
            message: `anchor id "${entry.id}" changed from ${prev.family}/${prev.kind} to ${entry.family}/${entry.kind}`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const anchors = extractDocumentAnchors(doc);
  const { seq, retiredRefs } = computeNextRevisionAndRetiredRefs(digest, anchors, previousManifest);

  return {
    ok: true,
    document: doc,
    documentType: isReportDocument(doc) ? "report" : "decision",
    schemaId: resolveDocumentSchemaId(doc),
    bindingName,
    documentDigest: digest,
    bytes: canonicalBytes.byteLength,
    canonicalJson: canonical,
    anchors,
    retiredRefs,
    revisionSeq: seq,
  };
}

/** Assert the common artifact gate or throw DecisionDossierValidationError with all structured issues. */
export function assertFocusArtifact(
  input: unknown,
  options: FocusArtifactCheckOptions = {},
): FocusArtifactCheckOk {
  const result = checkFocusArtifact(input, options);
  if (!result.ok) {
    throw new DecisionDossierValidationError(result.issues);
  }
  return result;
}
