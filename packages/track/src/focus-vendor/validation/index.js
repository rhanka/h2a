/**
 * `@sentropic/focus/validate` — the typed runtime validator for the
 * `DecisionDossierDocument` (contract §4.2, R4).
 *
 * Two layers, matching the published JSON Schema asset
 * (`schemas/decision-dossier-document.v1.schema.json`,
 * `urn:sentropic:focus:DecisionDossierDocument:1.0.0`):
 *
 *   1. structure — closed shape check (unknown fields, wrong types, bad enums,
 *      an enabled snapshot interaction all refuse);
 *   2. semantics — unique node IDs, interaction targets resolvable to the
 *      dossier ref, a section id/targetRef or a nested option id/targetRef,
 *      an opaque provenance source binding (any string, per the published
 *      schema), and comprehension evidence whose dossier hash still matches
 *      the snapshot hash.
 *
 * Pure and dependency-free: no I/O, no clock, no mutation of the input.
 * Every recorded issue is a refusal — the schema is closed.
 */
import { validateDecisionDossierReadability } from "./readability.js";
import { checkEvidence } from './evidence.js';
export { READABILITY_LIMITS, READABILITY_BUDGETS, validateDecisionDossierReadability } from "./readability.js";
/** Stable schema ID of the published DecisionDossierDocument asset. */
export const DOSSIER_SCHEMA_ID = "urn:sentropic:focus:DecisionDossierDocument:1.0.0";
/** Version of the dossier schema, independent of the package version. */
export const DOSSIER_SCHEMA_VERSION = "1.0.0";
/** Thrown by {@link assertDecisionDossierDocument} on an invalid dossier. */
export class DecisionDossierValidationError extends Error {
    issues;
    constructor(issues) {
        super(`invalid DecisionDossierDocument: ${issues
            .map((issue) => `${issue.path} ${issue.code}: ${issue.message}`)
            .join("; ")}`);
        this.name = "DecisionDossierValidationError";
        this.issues = issues;
    }
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const issue = (path, code, message) => ({
    path,
    code,
    message,
});
/**
 * Closed-object check: unknown keys refuse, required keys must be present,
 * and `stringKeys` members must be strings when present (a missing required
 * string key therefore yields exactly one `missing_field`).
 */
const checkClosedObject = (value, path, allowed, required, stringKeys, issues) => {
    if (!isRecord(value)) {
        issues.push(issue(path, "invalid_type", "expected an object"));
        return undefined;
    }
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) {
            issues.push(issue(`${path}.${key}`, "unknown_field", "field not in the closed schema"));
        }
    }
    for (const key of required) {
        if (value[key] === undefined) {
            issues.push(issue(`${path}.${key}`, "missing_field", "required field is missing"));
        }
    }
    for (const key of stringKeys) {
        if (value[key] !== undefined && typeof value[key] !== "string") {
            issues.push(issue(`${path}.${key}`, "invalid_type", "expected a string"));
        }
    }
    return value;
};
const checkEnum = (value, path, allowed, issues) => {
    if (typeof value !== "string" || !allowed.includes(value)) {
        issues.push(issue(path, "invalid_enum", `expected one of: ${allowed.join(" | ")}`));
    }
};
const TOP_REQUIRED = [
    "ref",
    "subject",
    "title",
    "hash",
    "cursor",
    "sections",
    "interactions",
    "provenance",
    "amendmentTrace",
];
const TOP_STRINGS = ["ref", "subject", "title", "hash", "cursor"];
/** Backward-compatible readability fields: optional at schema level, enforced by the gate. */
const TOP_ALLOWED = [...TOP_REQUIRED, "readability"];
const checkOptionNode = (value, path, issues) => {
    const start = issues.length;
    const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment", "consequence"], ["kind", "id", "targetRef", "label", "annotation"], ["id", "targetRef", "label", "body", "annotationComment", "consequence"], issues);
    if (node === undefined)
        return undefined;
    if (node["kind"] !== "option") {
        issues.push(issue(`${path}.kind`, "invalid_discriminator", 'expected "option"'));
    }
    checkEnum(node["annotation"], `${path}.annotation`, ["none", "accept", "reject", "comment"], issues);
    if (issues.length !== start)
        return undefined;
    return {
        kind: "option",
        id: node["id"],
        targetRef: node["targetRef"],
        label: node["label"],
        ...(typeof node["body"] === "string" ? { body: node["body"] } : {}),
        annotation: node["annotation"],
        ...(typeof node["annotationComment"] === "string"
            ? { annotationComment: node["annotationComment"] }
            : {}),
        ...(typeof node["consequence"] === "string" ? { consequence: node["consequence"] } : {}),
    };
};
const checkAmendmentStep = (value, path, issues) => {
    const start = issues.length;
    const step = checkClosedObject(value, path, ["at", "author", "summary"], ["at", "author", "summary"], ["at", "author", "summary"], issues);
    if (step === undefined || issues.length !== start)
        return undefined;
    return { at: step["at"], author: step["author"], summary: step["summary"] };
};
const checkSectionNode = (value, path, issues) => {
    if (!isRecord(value)) {
        issues.push(issue(path, "invalid_type", "expected an object"));
        return undefined;
    }
    const kind = value["kind"];
    if (kind !== "prose" && kind !== "question" && kind !== "optionSet" && kind !== "outcome" && kind !== "amendmentTrace" && kind !== "diagram") {
        issues.push(issue(`${path}.kind`, typeof kind === "undefined" ? "missing_field" : "unknown_node_kind", `unknown section kind ${typeof kind === "string" ? `"${kind}"` : " discriminant"}`));
        return undefined;
    }
    const start = issues.length;
    switch (kind) {
        case "prose": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "markdown", "questionId"], ["kind", "id", "targetRef", "markdown"], ["id", "targetRef", "markdown", "questionId"], issues);
            if (node === undefined || issues.length !== start)
                return undefined;
            return { kind: "prose", id: node["id"], targetRef: node["targetRef"], markdown: node["markdown"], ...(typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}) };
        }
        case "question": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state", "context", "readingTimeMinutes", "recommendedOptionId"], ["kind", "id", "targetRef", "question", "state"], ["id", "targetRef", "question", "recommendedAnswer", "answer", "context", "recommendedOptionId"], issues);
            if (node === undefined)
                return undefined;
            checkEnum(node["state"], `${path}.state`, ["open", "answered", "validated"], issues);
            if (node["readingTimeMinutes"] !== undefined && (typeof node["readingTimeMinutes"] !== "number" || !Number.isFinite(node["readingTimeMinutes"]))) {
                issues.push(issue(`${path}.readingTimeMinutes`, "invalid_type", "expected a finite number"));
            }
            if (issues.length !== start)
                return undefined;
            return {
                kind: "question",
                id: node["id"],
                targetRef: node["targetRef"],
                question: node["question"],
                ...(typeof node["recommendedAnswer"] === "string" ? { recommendedAnswer: node["recommendedAnswer"] } : {}),
                ...(typeof node["answer"] === "string" ? { answer: node["answer"] } : {}),
                state: node["state"],
                ...(typeof node["context"] === "string" ? { context: node["context"] } : {}),
                ...(typeof node["recommendedOptionId"] === "string" ? { recommendedOptionId: node["recommendedOptionId"] } : {}),
                ...(typeof node["readingTimeMinutes"] === "number" ? { readingTimeMinutes: node["readingTimeMinutes"] } : {}),
            };
        }
        case "optionSet": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "title", "options", "questionId"], ["kind", "id", "targetRef", "options"], ["id", "targetRef", "title", "questionId"], issues);
            if (node === undefined)
                return undefined;
            const options = [];
            if (!Array.isArray(node["options"])) {
                issues.push(issue(`${path}.options`, "invalid_type", "expected an array"));
            }
            else {
                node["options"].forEach((option, index) => {
                    const checked = checkOptionNode(option, `${path}.options[${index}]`, issues);
                    if (checked !== undefined)
                        options.push(checked);
                });
            }
            if (issues.length !== start)
                return undefined;
            return {
                kind: "optionSet",
                id: node["id"],
                targetRef: node["targetRef"],
                ...(typeof node["title"] === "string" ? { title: node["title"] } : {}),
                options,
                ...(typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}),
            };
        }
        case "outcome": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "modality", "statement", "questionId"], ["kind", "id", "targetRef", "modality", "statement"], ["id", "targetRef", "statement", "questionId"], issues);
            if (node === undefined)
                return undefined;
            checkEnum(node["modality"], `${path}.modality`, ["decision", "orientation", "amendment", "comment"], issues);
            if (issues.length !== start)
                return undefined;
            return {
                kind: "outcome",
                id: node["id"],
                targetRef: node["targetRef"],
                modality: node["modality"],
                statement: node["statement"],
                ...(typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}),
            };
        }
        case "amendmentTrace": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "steps"], ["kind", "id", "targetRef", "steps"], ["id", "targetRef"], issues);
            if (node === undefined)
                return undefined;
            const steps = [];
            if (!Array.isArray(node["steps"])) {
                issues.push(issue(`${path}.steps`, "invalid_type", "expected an array"));
            }
            else {
                node["steps"].forEach((step, index) => {
                    const checked = checkAmendmentStep(step, `${path}.steps[${index}]`, issues);
                    if (checked !== undefined)
                        steps.push(checked);
                });
            }
            if (issues.length !== start)
                return undefined;
            return {
                kind: "amendmentTrace",
                id: node["id"],
                targetRef: node["targetRef"],
                steps,
            };
        }
        case "diagram": {
            const node = checkClosedObject(value, path, ["kind", "id", "targetRef", "syntax", "source", "alt", "scene"], ["kind", "id", "targetRef", "syntax", "source", "alt"], ["id", "targetRef", "source", "alt"], issues);
            if (node === undefined)
                return undefined;
            checkEnum(node["syntax"], `${path}.syntax`, ["mermaid", "plantuml"], issues);
            // Opaque diagram-core JSON; its authoritative schema will be pinned when published.
            if (node["scene"] !== undefined && !isRecord(node["scene"])) {
                issues.push(issue(`${path}.scene`, "invalid_type", "expected a diagram-core SemanticDocument object"));
            }
            if (issues.length !== start)
                return undefined;
            return {
                kind: "diagram",
                id: node["id"],
                targetRef: node["targetRef"],
                syntax: node["syntax"],
                source: node["source"],
                alt: node["alt"],
                ...(node["scene"] === undefined ? {} : { scene: node["scene"] }),
            };
        }
    }
};
const checkInteraction = (value, path, issues) => {
    const start = issues.length;
    const affordance = checkClosedObject(value, path, ["name", "targetRef", "label", "enabled"], ["name", "targetRef", "label", "enabled"], ["name", "targetRef", "label"], issues);
    if (affordance === undefined)
        return undefined;
    // The snapshot profile is read-only: an enabled affordance is never valid here.
    if (affordance["enabled"] !== false) {
        issues.push(issue(`${path}.enabled`, "enabled_action", "snapshot interactions must stay disabled (enabled:false)"));
    }
    if (issues.length !== start)
        return undefined;
    return {
        name: affordance["name"],
        targetRef: affordance["targetRef"],
        label: affordance["label"],
        enabled: false,
    };
};
const checkGlossaryEntry = (value, path, issues) => {
    const start = issues.length;
    const entry = checkClosedObject(value, path, ["term", "definition"], ["term", "definition"], ["term", "definition"], issues);
    if (entry === undefined || issues.length !== start)
        return undefined;
    return { term: entry["term"], definition: entry["definition"] };
};
/** Closed-object check for the optional dossier-level readability statement. */
const checkReadability = (value, path, issues) => {
    const start = issues.length;
    const block = checkClosedObject(value, path, ["ownerRequestQuote", "noOwnerRequest", "stakes", "stakesLevel", "readingBudgetMinutes", "glossary"], [], ["ownerRequestQuote", "stakes"], issues);
    if (block === undefined)
        return undefined;
    if (block["stakesLevel"] !== undefined) {
        checkEnum(block["stakesLevel"], `${path}.stakesLevel`, ["low", "medium", "high"], issues);
    }
    if (block["noOwnerRequest"] !== undefined && typeof block["noOwnerRequest"] !== "boolean") {
        issues.push(issue(`${path}.noOwnerRequest`, "invalid_type", "expected a boolean"));
    }
    if (block["readingBudgetMinutes"] !== undefined && (typeof block["readingBudgetMinutes"] !== "number" || !Number.isFinite(block["readingBudgetMinutes"]))) {
        issues.push(issue(`${path}.readingBudgetMinutes`, "invalid_type", "expected a finite number"));
    }
    let glossary;
    if (block["glossary"] !== undefined) {
        glossary = [];
        if (!Array.isArray(block["glossary"])) {
            issues.push(issue(`${path}.glossary`, "invalid_type", "expected an array"));
        }
        else {
            block["glossary"].forEach((entry, index) => {
                const checked = checkGlossaryEntry(entry, `${path}.glossary[${index}]`, issues);
                if (checked !== undefined)
                    glossary.push(checked);
            });
        }
    }
    if (issues.length !== start)
        return undefined;
    return {
        ...(typeof block["ownerRequestQuote"] === "string" ? { ownerRequestQuote: block["ownerRequestQuote"] } : {}),
        ...(typeof block["noOwnerRequest"] === "boolean" ? { noOwnerRequest: block["noOwnerRequest"] } : {}),
        ...(typeof block["stakes"] === "string" ? { stakes: block["stakes"] } : {}),
        ...(block["stakesLevel"] !== undefined ? { stakesLevel: block["stakesLevel"] } : {}),
        ...(typeof block["readingBudgetMinutes"] === "number" ? { readingBudgetMinutes: block["readingBudgetMinutes"] } : {}),
        ...(glossary !== undefined ? { glossary } : {}),
    };
};
/** Structural layer: closed shape check against the published schema. */
const validateLegacyStructure = (value) => {
    const issues = [];
    const doc = checkClosedObject(value, "$", [...TOP_ALLOWED], [...TOP_REQUIRED], [...TOP_STRINGS], issues);
    if (doc === undefined)
        return { ok: false, issues };
    const sections = [];
    if (!Array.isArray(doc["sections"])) {
        issues.push(issue("$.sections", "invalid_type", "expected an array"));
    }
    else {
        doc["sections"].forEach((section, index) => {
            const checked = checkSectionNode(section, `$.sections[${index}]`, issues);
            if (checked !== undefined)
                sections.push(checked);
        });
    }
    const interactions = [];
    if (!Array.isArray(doc["interactions"])) {
        issues.push(issue("$.interactions", "invalid_type", "expected an array"));
    }
    else {
        doc["interactions"].forEach((interaction, index) => {
            const checked = checkInteraction(interaction, `$.interactions[${index}]`, issues);
            if (checked !== undefined)
                interactions.push(checked);
        });
    }
    let provenance;
    const rawProvenance = checkClosedObject(doc["provenance"], "$.provenance", ["source", "readAt", "comprehensionEvidence"], ["source", "readAt"], ["source", "readAt"], issues);
    if (rawProvenance !== undefined) {
        let evidence;
        if (rawProvenance["comprehensionEvidence"] !== undefined) {
            const evidenceStart = issues.length;
            const rawEvidence = checkClosedObject(rawProvenance["comprehensionEvidence"], "$.provenance.comprehensionEvidence", ["subject", "dossierHash", "signature"], ["subject", "dossierHash"], ["subject", "dossierHash", "signature"], issues);
            if (rawEvidence !== undefined && issues.length === evidenceStart) {
                evidence = {
                    subject: rawEvidence["subject"],
                    dossierHash: rawEvidence["dossierHash"],
                    ...(typeof rawEvidence["signature"] === "string" ? { signature: rawEvidence["signature"] } : {}),
                };
            }
        }
        provenance = {
            source: rawProvenance["source"],
            readAt: rawProvenance["readAt"],
            ...(evidence !== undefined ? { comprehensionEvidence: evidence } : {}),
        };
    }
    const amendmentTrace = [];
    if (!Array.isArray(doc["amendmentTrace"])) {
        issues.push(issue("$.amendmentTrace", "invalid_type", "expected an array"));
    }
    else {
        doc["amendmentTrace"].forEach((step, index) => {
            const checked = checkAmendmentStep(step, `$.amendmentTrace[${index}]`, issues);
            if (checked !== undefined)
                amendmentTrace.push(checked);
        });
    }
    let readability;
    if (doc["readability"] !== undefined) {
        readability = checkReadability(doc["readability"], "$.readability", issues);
    }
    // Every recorded issue is a refusal: the schema is closed.
    if (issues.length > 0 || provenance === undefined || (doc["readability"] !== undefined && readability === undefined)) {
        return { ok: false, issues };
    }
    if (typeof doc["ref"] !== "string" ||
        typeof doc["subject"] !== "string" ||
        typeof doc["title"] !== "string" ||
        typeof doc["hash"] !== "string" ||
        typeof doc["cursor"] !== "string") {
        return { ok: false, issues };
    }
    return {
        ok: true,
        value: {
            ref: doc["ref"],
            subject: doc["subject"],
            title: doc["title"],
            hash: doc["hash"],
            cursor: doc["cursor"],
            sections,
            interactions,
            provenance,
            amendmentTrace,
            ...(readability !== undefined ? { readability } : {}),
        },
    };
};
/** Absence means historical v1; unknown explicit versions always refuse. */
export const validateDecisionDossierStructure = (value) => {
    if (isRecord(value) && Object.hasOwn(value, 'schemaVersion')) {
        if (value.schemaVersion !== 2)
            return { ok: false, issues: [issue('$.schemaVersion', 'unsupported_version', 'Supported explicit version: 2; omit schemaVersion for legacy v1')] };
        return checkEvidence(value, validateLegacyStructure);
    }
    return validateLegacyStructure(value);
};
/** Semantic layer on a structurally valid dossier. Empty means valid. */
export const validateDecisionDossierSemantics = (doc) => {
    const issues = [];
    const seen = new Map();
    const registerId = (id, path) => {
        const first = seen.get(id);
        if (first !== undefined) {
            issues.push(issue(path, "duplicate_id", `node id "${id}" already used at ${first}`));
        }
        else {
            seen.set(id, path);
        }
    };
    doc.sections.forEach((section, index) => {
        const path = `$.sections[${index}]`;
        registerId(section.id, `${path}.id`);
        if (section.kind === "optionSet") {
            section.options.forEach((option, optionIndex) => {
                registerId(option.id, `${path}.options[${optionIndex}].id`);
            });
        }
    });
    // Every interaction target must resolve: the dossier ref, a section
    // id/targetRef, or a nested option id/targetRef.
    const resolvable = new Set([doc.ref]);
    for (const section of doc.sections) {
        resolvable.add(section.id);
        resolvable.add(section.targetRef);
        if (section.kind === "optionSet") {
            for (const option of section.options) {
                resolvable.add(option.id);
                resolvable.add(option.targetRef);
            }
        }
    }
    doc.interactions.forEach((interaction, index) => {
        if (!resolvable.has(interaction.targetRef)) {
            issues.push(issue(`$.interactions[${index}].targetRef`, "unresolved_target", `interaction target "${interaction.targetRef}" resolves to no node`));
        }
    });
    // The source binding selects the read backend. It is opaque (e.g. a
    // `track:<events-path>` binding): the published schema accepts any string,
    // so the validator does too — no stricter refusal without a versioned change.
    // Comprehension evidence is carried verbatim: its dossier hash must still be
    // the hash the snapshot was taken over. A mismatch is forged evidence.
    const evidence = doc.provenance.comprehensionEvidence;
    if (evidence !== undefined && evidence.dossierHash !== doc.hash) {
        issues.push(issue("$.provenance.comprehensionEvidence.dossierHash", "evidence_mismatch", "comprehension evidence does not match the snapshot hash"));
    }
    return issues;
};
/** Full validation: structure first, then semantics. */
export const validateDecisionDossierDocument = (value) => {
    const structural = validateDecisionDossierStructure(value);
    if (!structural.ok)
        return structural;
    const semantic = validateDecisionDossierSemantics(structural.value);
    if (semantic.length > 0)
        return { ok: false, issues: semantic };
    return structural;
};
/** Parse or throw {@link DecisionDossierValidationError}. */
export const assertDecisionDossierDocument = (value) => {
    const result = validateDecisionDossierDocument(value);
    if (!result.ok)
        throw new DecisionDossierValidationError(result.issues);
    return result.value;
};
/** Presentation requires the backward-compatible structure AND the readability gate. */
export const validateDecisionDossierForPresentation = (value) => {
    const result = validateDecisionDossierDocument(value);
    if (!result.ok)
        return result;
    const issues = validateDecisionDossierReadability(result.value);
    return issues.length > 0 ? { ok: false, issues } : result;
};
/** Refuse before any presentation or host rendering hook runs. */
export const assertDecisionDossierForPresentation = (value) => {
    const result = validateDecisionDossierForPresentation(value);
    if (!result.ok)
        throw new DecisionDossierValidationError(result.issues);
    return result.value;
};
