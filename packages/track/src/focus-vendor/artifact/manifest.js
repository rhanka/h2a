import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { baseDigest, canonicalJson } from "../editing/digest.js";
import { isEvidenceDossier, isReportDocument } from "../model.js";
import { DOSSIER_V1_1_SCHEMA_ID, DOSSIER_V2_1_SCHEMA_ID, REPORT_SCHEMA_ID, } from "../validation/index.js";
export const FOCUS_ARTIFACT_TYPE = "focus-dossier";
export const FOCUS_DOSSIER_CONTRACT = "focus-dossier/1";
export const FOCUS_VIEWS_CONTRACT = "focus-views/1";
export const FOCUS_TEMPLATE_ID = "focus-dossier";
export const FOCUS_DOCUMENT_PATH = "dossier.json";
export const FOCUS_MANIFEST_PATH = "focus.manifest.json";
export const FOCUS_VIEWS_PATH = "views.json";
export const FOCUS_BINDING_NAME_PREFIX = "focus:";
export const FOCUS_MAX_DOCUMENT_BYTES = 1_048_576;
export const FOCUS_MAX_ANCHOR_LENGTH = 128;
export const FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH = 128;
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ANCHOR_FAMILIES = [
    "section",
    "option",
    "source",
    "citation",
    "evidenceGroup",
    "annex",
];
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const compareUtf16 = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (values) => [...new Set(values)].sort(compareUtf16);
/** RFC 8785 canonical JSON string without trailing newline. */
export const canonicalJsonString = (value) => canonicalJson(value);
/** UTF-8 bytes of RFC 8785 canonical JSON without trailing newline. */
export const canonicalJsonBytes = (value) => new TextEncoder().encode(canonicalJson(value));
export const canonicalByteLength = (value) => canonicalJsonBytes(value).byteLength;
/** SHA-256 digest of raw bytes, prefixed with `sha256:`. Pure JS (Node & browser identical). */
export const digestBytes = (bytes) => `sha256:${bytesToHex(sha256(bytes))}`;
/** Canonical document digest (`sha256:<hex>`), computed before any section enrichment. */
export const documentDigest = (doc) => baseDigest(doc);
/**
 * Canonical SHA-256 digest of the DS static kit manifest (SPEC-r3 §2.4.1):
 * RFC 8785 bytes without trailing newline, prefixed `sha256:`.
 */
export const rendererManifestDigest = (staticManifest) => baseDigest(staticManifest);
export const bindingNameForDocumentRef = (ref) => `${FOCUS_BINDING_NAME_PREFIX}${ref}`;
export const resolveDocumentSchemaId = (doc) => {
    if (isReportDocument(doc))
        return REPORT_SCHEMA_ID;
    if (isEvidenceDossier(doc))
        return DOSSIER_V2_1_SCHEMA_ID;
    return DOSSIER_V1_1_SCHEMA_ID;
};
/** Safe relative bundle path: no leading slash, no traversal, no backslash, no drive letter. */
export function isSafeBundleRelativePath(path) {
    if (typeof path !== "string" || path.length === 0)
        return false;
    if (path.startsWith("/") || path.includes("\\") || path.includes("\0"))
        return false;
    if (/^[A-Za-z]:/.test(path))
        return false;
    const segments = path.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
/** Extract every anchorable entity definition with its exact JSON path (SPEC-r3 §2.7 R1). */
export function extractDocumentAnchorsWithPaths(doc) {
    const entries = [];
    doc.sections.forEach((section, index) => {
        const sectionPath = `$.sections[${index}]`;
        entries.push({
            id: section.id,
            family: "section",
            kind: section.kind,
            path: `${sectionPath}.id`,
        });
        if (section.kind === "optionSet") {
            section.options.forEach((option, optionIndex) => {
                entries.push({
                    id: option.id,
                    family: "option",
                    kind: option.kind,
                    path: `${sectionPath}.options[${optionIndex}].id`,
                });
            });
        }
    });
    if (isEvidenceDossier(doc)) {
        doc.sources.forEach((source, index) => {
            entries.push({
                id: source.id,
                family: "source",
                kind: "source",
                path: `$.sources[${index}].id`,
            });
        });
        doc.citations.forEach((citation, index) => {
            entries.push({
                id: citation.id,
                family: "citation",
                kind: "citation",
                path: `$.citations[${index}].id`,
            });
        });
        doc.evidenceGroups.forEach((group, index) => {
            entries.push({
                id: group.id,
                family: "evidenceGroup",
                kind: "evidenceGroup",
                path: `$.evidenceGroups[${index}].id`,
            });
        });
        doc.annexes.forEach((annex, index) => {
            entries.push({
                id: annex.id,
                family: "annex",
                kind: "annex",
                path: `$.annexes[${index}].id`,
            });
        });
    }
    return entries;
}
/** Deterministic anchor table (`id`, `family`, `kind`) for `focus.manifest.json`. */
export function extractDocumentAnchors(doc) {
    return extractDocumentAnchorsWithPaths(doc)
        .map(({ id, family, kind }) => ({ id, family, kind }))
        .sort((a, b) => compareUtf16(a.id, b.id));
}
/**
 * Compute next revision metadata and cumulative retiredRefs (SPEC-r3 Annexe A & FA-H1 step 3):
 * - First revision: seq = 1, parentDigest = null, retiredRefs = []
 * - Same document (e.g., kit upgrade): seq, parentDigest and retiredRefs preserved
 * - Changed document: seq = prev.seq + 1, parentDigest = prev.document.digest, retiredRefs accumulated
 */
export function computeNextRevisionAndRetiredRefs(currentDigest, currentAnchors, previousManifest) {
    if (previousManifest === undefined) {
        return { seq: 1, parentDigest: null, retiredRefs: [] };
    }
    if (previousManifest.document.digest === currentDigest) {
        return {
            seq: previousManifest.revision.seq,
            parentDigest: previousManifest.revision.parentDigest,
            retiredRefs: uniqueSorted(previousManifest.retiredRefs),
        };
    }
    const currentIds = new Set(currentAnchors.map((anchor) => anchor.id));
    const newlyRetired = previousManifest.anchors
        .filter((anchor) => !currentIds.has(anchor.id))
        .map((anchor) => anchor.id);
    return {
        seq: previousManifest.revision.seq + 1,
        parentDigest: previousManifest.document.digest,
        retiredRefs: uniqueSorted([...previousManifest.retiredRefs, ...newlyRetired]),
    };
}
export function buildDerivedFileEntry(path, value, mimeType) {
    if (!isSafeBundleRelativePath(path)) {
        throw new Error(`Invalid derived relative bundle path: ${path}`);
    }
    if (typeof mimeType !== "string" || mimeType.trim().length === 0) {
        throw new Error("Derived file entry requires a non-empty mimeType");
    }
    const bytes = value instanceof Uint8Array ? value : canonicalJsonBytes(value);
    return {
        path,
        digest: digestBytes(bytes),
        bytes: bytes.byteLength,
        mimeType,
    };
}
export function buildFocusViewsDocument(input) {
    if (!SHA256_DIGEST_RE.test(input.documentDigest)) {
        throw new Error("focus-views/1 requires a sha256:-prefixed documentDigest");
    }
    if (!SHA256_DIGEST_RE.test(input.rendererDigest)) {
        throw new Error("focus-views/1 requires a sha256:-prefixed rendererDigest");
    }
    return {
        contract: FOCUS_VIEWS_CONTRACT,
        documentDigest: input.documentDigest,
        rendererDigest: input.rendererDigest,
        diagrams: input.diagrams,
    };
}
export function buildFocusArtifactManifest(input) {
    const bytes = canonicalJsonBytes(input.document);
    const digest = digestBytes(bytes);
    const anchors = extractDocumentAnchors(input.document);
    const { seq, parentDigest, retiredRefs } = computeNextRevisionAndRetiredRefs(digest, anchors, input.previousManifest);
    const manifest = {
        artifactType: FOCUS_ARTIFACT_TYPE,
        contract: FOCUS_DOSSIER_CONTRACT,
        templateId: FOCUS_TEMPLATE_ID,
        document: {
            path: FOCUS_DOCUMENT_PATH,
            schemaId: resolveDocumentSchemaId(input.document),
            digest,
            bytes: bytes.byteLength,
            type: isReportDocument(input.document) ? "report" : "decision",
        },
        renderer: {
            name: input.renderer.name,
            version: input.renderer.version,
            entry: input.renderer.entry,
            digest: input.renderer.digest,
            files: input.renderer.files.map((file) => ({
                path: file.path,
                digest: file.digest,
                bytes: file.bytes,
            })),
            capabilities: [...input.renderer.capabilities],
        },
        validator: {
            name: input.validator.name,
            version: input.validator.version,
            digest: input.validator.digest,
        },
        revision: {
            seq,
            parentDigest,
            createdAt: input.createdAt,
        },
        anchors,
        derived: (input.derived ?? []).map((entry) => ({
            path: entry.path,
            digest: entry.digest,
            bytes: entry.bytes,
            mimeType: entry.mimeType,
        })),
        retiredRefs,
        generator: {
            name: input.generator.name,
            version: input.generator.version,
        },
    };
    const checked = validateFocusArtifactManifest(manifest);
    if (!checked.ok) {
        throw new Error(`Invalid focus.manifest.json: ${checked.issues.map((i) => `${i.path} ${i.code}: ${i.message}`).join("; ")}`);
    }
    return checked.value;
}
const pushIssue = (issues, path, code, message) => {
    issues.push({ path, code, message });
};
const checkClosedKeys = (obj, path, allowed, required, issues) => {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(obj)) {
        if (!allowedSet.has(key)) {
            pushIssue(issues, `${path}.${key}`, "unknown_field", "field not in the closed schema");
        }
    }
    for (const key of required) {
        if (!Object.hasOwn(obj, key) || obj[key] === undefined) {
            pushIssue(issues, `${path}.${key}`, "missing_field", "required field is missing");
        }
    }
};
const checkNonEmptyString = (value, path, issues) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        pushIssue(issues, path, "invalid_type", "expected a non-empty string");
        return false;
    }
    return true;
};
const checkDigest = (value, path, issues) => {
    if (typeof value !== "string" || !SHA256_DIGEST_RE.test(value)) {
        pushIssue(issues, path, "invalid_digest", "expected sha256:<64-lowercase-hex>");
        return false;
    }
    return true;
};
const checkSafePath = (value, path, issues) => {
    if (typeof value !== "string" || !isSafeBundleRelativePath(value)) {
        pushIssue(issues, path, "invalid_path", "expected a safe relative bundle path without traversal or leading slash");
        return false;
    }
    return true;
};
const checkNonNegInt = (value, path, issues) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        pushIssue(issues, path, "invalid_type", "expected a non-negative integer");
        return false;
    }
    return true;
};
/** Closed validation for focus-views/1 companion JSON (SPEC-r3 §2.4.1). */
export function validateFocusViewsDocument(value, expected) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "invalid_type", message: "expected an object" }] };
    }
    checkClosedKeys(value, "$", ["contract", "documentDigest", "rendererDigest", "diagrams"], ["contract", "documentDigest", "rendererDigest", "diagrams"], issues);
    if (value.contract !== FOCUS_VIEWS_CONTRACT) {
        pushIssue(issues, "$.contract", "invalid_contract", `expected "${FOCUS_VIEWS_CONTRACT}"`);
    }
    if (checkDigest(value.documentDigest, "$.documentDigest", issues) && expected?.documentDigest !== undefined && value.documentDigest !== expected.documentDigest) {
        pushIssue(issues, "$.documentDigest", "views_document_digest_mismatch", "views.json documentDigest does not match manifest document digest");
    }
    if (checkDigest(value.rendererDigest, "$.rendererDigest", issues) && expected?.rendererDigest !== undefined && value.rendererDigest !== expected.rendererDigest) {
        pushIssue(issues, "$.rendererDigest", "views_renderer_digest_mismatch", "views.json rendererDigest does not match manifest renderer digest");
    }
    if (!isRecord(value.diagrams)) {
        pushIssue(issues, "$.diagrams", "invalid_type", "expected a diagram map indexed by section id");
    }
    else {
        for (const [sectionId, entry] of Object.entries(value.diagrams)) {
            const entryPath = `$.diagrams[${JSON.stringify(sectionId)}]`;
            if (!isRecord(entry)) {
                pushIssue(issues, entryPath, "invalid_type", "expected an object with scene and views");
                continue;
            }
            checkClosedKeys(entry, entryPath, ["scene", "views"], ["scene", "views"], issues);
            if (!isRecord(entry.scene)) {
                pushIssue(issues, `${entryPath}.scene`, "invalid_type", "expected a scene object");
            }
            if (!isRecord(entry.views)) {
                pushIssue(issues, `${entryPath}.views`, "invalid_type", "expected a views object");
            }
        }
    }
    if (issues.length > 0)
        return { ok: false, issues };
    return { ok: true, value: value };
}
/** Closed validation for focus-dossier/1 manifest (SPEC-r3 Annexe A). */
export function validateFocusArtifactManifest(value) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "invalid_type", message: "expected a manifest object" }] };
    }
    const topKeys = [
        "artifactType",
        "contract",
        "templateId",
        "document",
        "renderer",
        "validator",
        "revision",
        "anchors",
        "derived",
        "retiredRefs",
        "generator",
    ];
    checkClosedKeys(value, "$", topKeys, topKeys, issues);
    if (value.artifactType !== FOCUS_ARTIFACT_TYPE) {
        pushIssue(issues, "$.artifactType", "invalid_manifest", `expected "${FOCUS_ARTIFACT_TYPE}"`);
    }
    if (value.contract !== FOCUS_DOSSIER_CONTRACT) {
        pushIssue(issues, "$.contract", "invalid_contract", `expected "${FOCUS_DOSSIER_CONTRACT}"`);
    }
    if (value.templateId !== FOCUS_TEMPLATE_ID) {
        pushIssue(issues, "$.templateId", "invalid_manifest", `expected "${FOCUS_TEMPLATE_ID}"`);
    }
    if (!isRecord(value.document)) {
        pushIssue(issues, "$.document", "invalid_type", "expected an object");
    }
    else {
        checkClosedKeys(value.document, "$.document", ["path", "schemaId", "digest", "bytes", "type"], ["path", "schemaId", "digest", "bytes", "type"], issues);
        if (value.document.path !== FOCUS_DOCUMENT_PATH) {
            pushIssue(issues, "$.document.path", "invalid_path", `expected "${FOCUS_DOCUMENT_PATH}"`);
        }
        checkNonEmptyString(value.document.schemaId, "$.document.schemaId", issues);
        checkDigest(value.document.digest, "$.document.digest", issues);
        checkNonNegInt(value.document.bytes, "$.document.bytes", issues);
        if (value.document.type !== "decision" && value.document.type !== "report") {
            pushIssue(issues, "$.document.type", "invalid_enum", 'expected "decision" or "report"');
        }
    }
    if (!isRecord(value.renderer)) {
        pushIssue(issues, "$.renderer", "invalid_type", "expected an object");
    }
    else {
        checkClosedKeys(value.renderer, "$.renderer", ["name", "version", "entry", "digest", "files", "capabilities"], ["name", "version", "entry", "digest", "files", "capabilities"], issues);
        checkNonEmptyString(value.renderer.name, "$.renderer.name", issues);
        checkNonEmptyString(value.renderer.version, "$.renderer.version", issues);
        checkSafePath(value.renderer.entry, "$.renderer.entry", issues);
        checkDigest(value.renderer.digest, "$.renderer.digest", issues);
        if (!Array.isArray(value.renderer.files)) {
            pushIssue(issues, "$.renderer.files", "invalid_type", "expected an array");
        }
        else {
            value.renderer.files.forEach((file, index) => {
                const fPath = `$.renderer.files[${index}]`;
                if (!isRecord(file)) {
                    pushIssue(issues, fPath, "invalid_type", "expected an object");
                    return;
                }
                checkClosedKeys(file, fPath, ["path", "digest", "bytes"], ["path", "digest", "bytes"], issues);
                checkSafePath(file.path, `${fPath}.path`, issues);
                checkDigest(file.digest, `${fPath}.digest`, issues);
                checkNonNegInt(file.bytes, `${fPath}.bytes`, issues);
            });
        }
        if (!Array.isArray(value.renderer.capabilities)) {
            pushIssue(issues, "$.renderer.capabilities", "invalid_type", "expected an array");
        }
        else {
            value.renderer.capabilities.forEach((cap, index) => {
                checkNonEmptyString(cap, `$.renderer.capabilities[${index}]`, issues);
            });
        }
    }
    if (!isRecord(value.validator)) {
        pushIssue(issues, "$.validator", "invalid_type", "expected an object");
    }
    else {
        checkClosedKeys(value.validator, "$.validator", ["name", "version", "digest"], ["name", "version", "digest"], issues);
        checkNonEmptyString(value.validator.name, "$.validator.name", issues);
        checkNonEmptyString(value.validator.version, "$.validator.version", issues);
        checkDigest(value.validator.digest, "$.validator.digest", issues);
    }
    if (!isRecord(value.revision)) {
        pushIssue(issues, "$.revision", "invalid_type", "expected an object");
    }
    else {
        checkClosedKeys(value.revision, "$.revision", ["seq", "parentDigest", "createdAt"], ["seq", "parentDigest", "createdAt"], issues);
        if (typeof value.revision.seq !== "number" || !Number.isSafeInteger(value.revision.seq) || value.revision.seq < 1) {
            pushIssue(issues, "$.revision.seq", "invalid_type", "expected a positive integer >= 1");
        }
        if (value.revision.parentDigest !== null) {
            checkDigest(value.revision.parentDigest, "$.revision.parentDigest", issues);
        }
        checkNonEmptyString(value.revision.createdAt, "$.revision.createdAt", issues);
    }
    if (!Array.isArray(value.anchors)) {
        pushIssue(issues, "$.anchors", "invalid_type", "expected an array");
    }
    else {
        const seenAnchors = new Set();
        value.anchors.forEach((anchor, index) => {
            const aPath = `$.anchors[${index}]`;
            if (!isRecord(anchor)) {
                pushIssue(issues, aPath, "invalid_type", "expected an object");
                return;
            }
            checkClosedKeys(anchor, aPath, ["id", "family", "kind"], ["id", "family", "kind"], issues);
            if (checkNonEmptyString(anchor.id, `${aPath}.id`, issues)) {
                if (seenAnchors.has(anchor.id)) {
                    pushIssue(issues, `${aPath}.id`, "duplicate_id", `duplicate anchor id "${anchor.id}" in manifest`);
                }
                else {
                    seenAnchors.add(anchor.id);
                }
            }
            if (typeof anchor.family !== "string" || !ANCHOR_FAMILIES.includes(anchor.family)) {
                pushIssue(issues, `${aPath}.family`, "invalid_enum", `expected one of: ${ANCHOR_FAMILIES.join(" | ")}`);
            }
            checkNonEmptyString(anchor.kind, `${aPath}.kind`, issues);
        });
    }
    if (!Array.isArray(value.derived)) {
        pushIssue(issues, "$.derived", "invalid_type", "expected an array");
    }
    else {
        value.derived.forEach((entry, index) => {
            const dPath = `$.derived[${index}]`;
            if (!isRecord(entry)) {
                pushIssue(issues, dPath, "invalid_type", "expected an object");
                return;
            }
            checkClosedKeys(entry, dPath, ["path", "digest", "bytes", "mimeType"], ["path", "digest", "bytes", "mimeType"], issues);
            checkSafePath(entry.path, `${dPath}.path`, issues);
            checkDigest(entry.digest, `${dPath}.digest`, issues);
            checkNonNegInt(entry.bytes, `${dPath}.bytes`, issues);
            checkNonEmptyString(entry.mimeType, `${dPath}.mimeType`, issues);
        });
    }
    if (!Array.isArray(value.retiredRefs)) {
        pushIssue(issues, "$.retiredRefs", "invalid_type", "expected an array");
    }
    else {
        value.retiredRefs.forEach((ref, index) => {
            checkNonEmptyString(ref, `$.retiredRefs[${index}]`, issues);
        });
    }
    if (!isRecord(value.generator)) {
        pushIssue(issues, "$.generator", "invalid_type", "expected an object");
    }
    else {
        checkClosedKeys(value.generator, "$.generator", ["name", "version"], ["name", "version"], issues);
        checkNonEmptyString(value.generator.name, "$.generator.name", issues);
        checkNonEmptyString(value.generator.version, "$.generator.version", issues);
    }
    if (issues.length > 0)
        return { ok: false, issues };
    return { ok: true, value: value };
}
