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
 *      a nonempty provenance source binding, and comprehension evidence whose
 *      dossier hash still matches the snapshot hash.
 *
 * Pure and dependency-free: no I/O, no clock, no mutation of the input.
 * Every recorded issue is a refusal — the schema is closed.
 */

import type {
  Affordance,
  AmendmentStep,
  ComprehensionEvidence,
  DecisionDossierDocument,
  DiagramSyntax,
  FocusNode,
  FocusProvenance,
  OptionAnnotationState,
  OptionNode,
  OutcomeModality,
  QuestionValidationState,
} from "../model.js";

/** Stable schema ID of the published DecisionDossierDocument asset. */
export const DOSSIER_SCHEMA_ID =
  "urn:sentropic:focus:DecisionDossierDocument:1.0.0";

/** Version of the dossier schema, independent of the package version. */
export const DOSSIER_SCHEMA_VERSION = "1.0.0";

/** One machine-checkable validation failure. */
export interface ValidationIssue {
  /** JSON-path-style location, e.g. `$.sections[2].options[0].annotation`. */
  readonly path: string;
  /** Stable machine code (`missing_field`, `duplicate_id`, …). */
  readonly code: string;
  /** Human-readable detail; never echoes secrets (dossiers carry none). */
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Thrown by {@link assertDecisionDossierDocument} on an invalid dossier. */
export class DecisionDossierValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    super(
      `invalid DecisionDossierDocument: ${issues
        .map((issue) => `${issue.path} ${issue.code}`)
        .join("; ")}`,
    );
    this.name = "DecisionDossierValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issue = (path: string, code: string, message: string): ValidationIssue => ({
  path,
  code,
  message,
});

/**
 * Closed-object check: unknown keys refuse, required keys must be present,
 * and `stringKeys` members must be strings when present (a missing required
 * string key therefore yields exactly one `missing_field`).
 */
const checkClosedObject = (
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  stringKeys: readonly string[],
  issues: ValidationIssue[],
): Record<string, unknown> | undefined => {
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

const checkEnum = (
  value: unknown,
  path: string,
  allowed: readonly string[],
  issues: ValidationIssue[],
): void => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(
      issue(path, "invalid_enum", `expected one of: ${allowed.join(" | ")}`),
    );
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
] as const;
const TOP_STRINGS = ["ref", "subject", "title", "hash", "cursor"] as const;

const checkOptionNode = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): OptionNode | undefined => {
  const start = issues.length;
  const node = checkClosedObject(
    value,
    path,
    ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment"],
    ["kind", "id", "targetRef", "label", "annotation"],
    ["id", "targetRef", "label", "body", "annotationComment"],
    issues,
  );
  if (node === undefined) return undefined;
  if (node["kind"] !== "option") {
    issues.push(issue(`${path}.kind`, "invalid_discriminator", 'expected "option"'));
  }
  checkEnum(node["annotation"], `${path}.annotation`, ["none", "accept", "reject", "comment"], issues);
  if (issues.length !== start) return undefined;
  return {
    kind: "option",
    id: node["id"] as string,
    targetRef: node["targetRef"] as string,
    label: node["label"] as string,
    ...(typeof node["body"] === "string" ? { body: node["body"] } : {}),
    annotation: node["annotation"] as OptionAnnotationState,
    ...(typeof node["annotationComment"] === "string"
      ? { annotationComment: node["annotationComment"] }
      : {}),
  };
};

const checkAmendmentStep = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): AmendmentStep | undefined => {
  const start = issues.length;
  const step = checkClosedObject(
    value, path,
    ["at", "author", "summary"], ["at", "author", "summary"], ["at", "author", "summary"],
    issues,
  );
  if (step === undefined || issues.length !== start) return undefined;
  return { at: step["at"] as string, author: step["author"] as string, summary: step["summary"] as string };
};

const checkSectionNode = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): FocusNode | undefined => {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_type", "expected an object"));
    return undefined;
  }
  const kind = value["kind"];
  if (kind !== "prose" && kind !== "question" && kind !== "optionSet" && kind !== "outcome" && kind !== "amendmentTrace" && kind !== "diagram") {
    issues.push(
      issue(
        `${path}.kind`,
        typeof kind === "undefined" ? "missing_field" : "unknown_node_kind",
        `unknown section kind ${typeof kind === "string" ? `"${kind}"` : " discriminant"}`,
      ),
    );
    return undefined;
  }
  const start = issues.length;
  switch (kind) {
    case "prose": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "markdown"], ["kind", "id", "targetRef", "markdown"], ["id", "targetRef", "markdown"],
        issues,
      );
      if (node === undefined || issues.length !== start) return undefined;
      return { kind: "prose", id: node["id"] as string, targetRef: node["targetRef"] as string, markdown: node["markdown"] as string };
    }
    case "question": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state"],
        ["kind", "id", "targetRef", "question", "state"],
        ["id", "targetRef", "question", "recommendedAnswer", "answer"],
        issues,
      );
      if (node === undefined) return undefined;
      checkEnum(node["state"], `${path}.state`, ["open", "answered", "validated"], issues);
      if (issues.length !== start) return undefined;
      return {
        kind: "question",
        id: node["id"] as string,
        targetRef: node["targetRef"] as string,
        question: node["question"] as string,
        ...(typeof node["recommendedAnswer"] === "string" ? { recommendedAnswer: node["recommendedAnswer"] } : {}),
        ...(typeof node["answer"] === "string" ? { answer: node["answer"] } : {}),
        state: node["state"] as QuestionValidationState,
      };
    }
    case "optionSet": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "title", "options"],
        ["kind", "id", "targetRef", "options"],
        ["id", "targetRef", "title"],
        issues,
      );
      if (node === undefined) return undefined;
      const options: OptionNode[] = [];
      if (!Array.isArray(node["options"])) {
        issues.push(issue(`${path}.options`, "invalid_type", "expected an array"));
      } else {
        node["options"].forEach((option: unknown, index: number) => {
          const checked = checkOptionNode(option, `${path}.options[${index}]`, issues);
          if (checked !== undefined) options.push(checked);
        });
      }
      if (issues.length !== start) return undefined;
      return {
        kind: "optionSet",
        id: node["id"] as string,
        targetRef: node["targetRef"] as string,
        ...(typeof node["title"] === "string" ? { title: node["title"] } : {}),
        options,
      };
    }
    case "outcome": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "modality", "statement"],
        ["kind", "id", "targetRef", "modality", "statement"],
        ["id", "targetRef", "statement"],
        issues,
      );
      if (node === undefined) return undefined;
      checkEnum(node["modality"], `${path}.modality`, ["decision", "orientation", "amendment", "comment"], issues);
      if (issues.length !== start) return undefined;
      return {
        kind: "outcome",
        id: node["id"] as string,
        targetRef: node["targetRef"] as string,
        modality: node["modality"] as OutcomeModality,
        statement: node["statement"] as string,
      };
    }
    case "amendmentTrace": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "steps"],
        ["kind", "id", "targetRef", "steps"],
        ["id", "targetRef"],
        issues,
      );
      if (node === undefined) return undefined;
      const steps: AmendmentStep[] = [];
      if (!Array.isArray(node["steps"])) {
        issues.push(issue(`${path}.steps`, "invalid_type", "expected an array"));
      } else {
        node["steps"].forEach((step: unknown, index: number) => {
          const checked = checkAmendmentStep(step, `${path}.steps[${index}]`, issues);
          if (checked !== undefined) steps.push(checked);
        });
      }
      if (issues.length !== start) return undefined;
      return {
        kind: "amendmentTrace",
        id: node["id"] as string,
        targetRef: node["targetRef"] as string,
        steps,
      };
    }
    case "diagram": {
      const node = checkClosedObject(
        value, path,
        ["kind", "id", "targetRef", "syntax", "source", "alt"],
        ["kind", "id", "targetRef", "syntax", "source", "alt"],
        ["id", "targetRef", "source", "alt"],
        issues,
      );
      if (node === undefined) return undefined;
      checkEnum(node["syntax"], `${path}.syntax`, ["mermaid", "plantuml"], issues);
      if (issues.length !== start) return undefined;
      return {
        kind: "diagram",
        id: node["id"] as string,
        targetRef: node["targetRef"] as string,
        syntax: node["syntax"] as DiagramSyntax,
        source: node["source"] as string,
        alt: node["alt"] as string,
      };
    }
  }
};

const checkInteraction = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Affordance | undefined => {
  const start = issues.length;
  const affordance = checkClosedObject(
    value, path,
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label"],
    issues,
  );
  if (affordance === undefined) return undefined;
  // The snapshot profile is read-only: an enabled affordance is never valid here.
  if (affordance["enabled"] !== false) {
    issues.push(
      issue(`${path}.enabled`, "enabled_action", "snapshot interactions must stay disabled (enabled:false)"),
    );
  }
  if (issues.length !== start) return undefined;
  return {
    name: affordance["name"] as string,
    targetRef: affordance["targetRef"] as string,
    label: affordance["label"] as string,
    enabled: false,
  };
};

/** Structural layer: closed shape check against the published schema. */
export const validateDecisionDossierStructure = (
  value: unknown,
): ValidationResult<DecisionDossierDocument> => {
  const issues: ValidationIssue[] = [];
  const doc = checkClosedObject(value, "$", [...TOP_REQUIRED], [...TOP_REQUIRED], [...TOP_STRINGS], issues);
  if (doc === undefined) return { ok: false, issues };

  const sections: FocusNode[] = [];
  if (!Array.isArray(doc["sections"])) {
    issues.push(issue("$.sections", "invalid_type", "expected an array"));
  } else {
    (doc["sections"] as unknown[]).forEach((section: unknown, index: number) => {
      const checked = checkSectionNode(section, `$.sections[${index}]`, issues);
      if (checked !== undefined) sections.push(checked);
    });
  }

  const interactions: Affordance[] = [];
  if (!Array.isArray(doc["interactions"])) {
    issues.push(issue("$.interactions", "invalid_type", "expected an array"));
  } else {
    (doc["interactions"] as unknown[]).forEach((interaction: unknown, index: number) => {
      const checked = checkInteraction(interaction, `$.interactions[${index}]`, issues);
      if (checked !== undefined) interactions.push(checked);
    });
  }

  let provenance: FocusProvenance | undefined;
  const rawProvenance = checkClosedObject(
    doc["provenance"], "$.provenance",
    ["source", "readAt", "comprehensionEvidence"], ["source", "readAt"], ["source", "readAt"],
    issues,
  );
  if (rawProvenance !== undefined) {
    let evidence: ComprehensionEvidence | undefined;
    if (rawProvenance["comprehensionEvidence"] !== undefined) {
      const evidenceStart = issues.length;
      const rawEvidence = checkClosedObject(
        rawProvenance["comprehensionEvidence"], "$.provenance.comprehensionEvidence",
        ["subject", "dossierHash", "signature"], ["subject", "dossierHash"], ["subject", "dossierHash", "signature"],
        issues,
      );
      if (rawEvidence !== undefined && issues.length === evidenceStart) {
        evidence = {
          subject: rawEvidence["subject"] as string,
          dossierHash: rawEvidence["dossierHash"] as string,
          ...(typeof rawEvidence["signature"] === "string" ? { signature: rawEvidence["signature"] } : {}),
        };
      }
    }
    provenance = {
      source: rawProvenance["source"] as string,
      readAt: rawProvenance["readAt"] as string,
      ...(evidence !== undefined ? { comprehensionEvidence: evidence } : {}),
    };
  }

  const amendmentTrace: AmendmentStep[] = [];
  if (!Array.isArray(doc["amendmentTrace"])) {
    issues.push(issue("$.amendmentTrace", "invalid_type", "expected an array"));
  } else {
    (doc["amendmentTrace"] as unknown[]).forEach((step: unknown, index: number) => {
      const checked = checkAmendmentStep(step, `$.amendmentTrace[${index}]`, issues);
      if (checked !== undefined) amendmentTrace.push(checked);
    });
  }

  // Every recorded issue is a refusal: the schema is closed.
  if (issues.length > 0 || provenance === undefined) {
    return { ok: false, issues };
  }
  if (
    typeof doc["ref"] !== "string" ||
    typeof doc["subject"] !== "string" ||
    typeof doc["title"] !== "string" ||
    typeof doc["hash"] !== "string" ||
    typeof doc["cursor"] !== "string"
  ) {
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
    },
  };
};

/** Semantic layer on a structurally valid dossier. Empty means valid. */
export const validateDecisionDossierSemantics = (
  doc: DecisionDossierDocument,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, string>();
  const registerId = (id: string, path: string): void => {
    const first = seen.get(id);
    if (first !== undefined) {
      issues.push(issue(path, "duplicate_id", `node id "${id}" already used at ${first}`));
    } else {
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
  const resolvable = new Set<string>([doc.ref]);
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
      issues.push(
        issue(
          `$.interactions[${index}].targetRef`,
          "unresolved_target",
          `interaction target "${interaction.targetRef}" resolves to no node`,
        ),
      );
    }
  });

  // The source binding selects the read backend; it must be an explicit value.
  if (doc.provenance.source.trim() === "") {
    issues.push(issue("$.provenance.source", "invalid_source", "provenance source binding is empty"));
  }
  // Comprehension evidence is carried verbatim: its dossier hash must still be
  // the hash the snapshot was taken over. A mismatch is forged evidence.
  const evidence = doc.provenance.comprehensionEvidence;
  if (evidence !== undefined && evidence.dossierHash !== doc.hash) {
    issues.push(
      issue(
        "$.provenance.comprehensionEvidence.dossierHash",
        "evidence_mismatch",
        "comprehension evidence does not match the snapshot hash",
      ),
    );
  }
  return issues;
};

/** Full validation: structure first, then semantics. */
export const validateDecisionDossierDocument = (
  value: unknown,
): ValidationResult<DecisionDossierDocument> => {
  const structural = validateDecisionDossierStructure(value);
  if (!structural.ok) return structural;
  const semantic = validateDecisionDossierSemantics(structural.value);
  if (semantic.length > 0) return { ok: false, issues: semantic };
  return structural;
};

/** Parse or throw {@link DecisionDossierValidationError}. */
export const assertDecisionDossierDocument = (
  value: unknown,
): DecisionDossierDocument => {
  const result = validateDecisionDossierDocument(value);
  if (!result.ok) throw new DecisionDossierValidationError(result.issues);
  return result.value;
};
