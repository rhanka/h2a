/**
 * The 9-step envelope validation pipeline (DS spec §4.3–§4.5), mirrored from
 * sent-tech-design-system cc29be886b543ffa29592afbc6b4482c104b1fb4
 * `packages/elements/src/validate/{envelope,structure,diagnostics}.ts`,
 * `packages/elements/src/structure/ajv.ts` and
 * `packages/elements/src/ports/{types,focus}.ts`. The DS validator cannot be
 * delegated to until DS L7a publishes `@sentropic/design-system-elements`
 * (h2a spec §7.2), so h2a mirrors the committed behavior exactly: the same
 * check order, the same closed §4.5 diagnostic shape, the same ajv 2020-12
 * registration set (vendored A2UI common types, the empty-function-set
 * catalogue stub, the catalogue itself), and the same focus port.
 *
 * Check order (every step that refuses returns immediately):
 *   1. JSON-serializable, then the 1 MiB UTF-8 budget (§4.3 item 3);
 *   2. envelope structure (§4.2);
 *   3. the optional `catalogId`, when present, must name this catalogue;
 *   4. `mode`: `preview` is reserved (§10.3);
 *   5. `root.component` must be catalogued;
 *   6. a placeholder entry refuses (`component-unavailable`);
 *   7. the §4.4 contract rule: older is accepted, never newer, never
 *      another major;
 *   8. the root's structure against the targeted catalogue entry;
 *   9. semantics — only when the structure is clean — through the injected
 *      port of the entry's `lazy:` engine. `core` engines have no port.
 */

import { Ajv2020 } from "ajv/dist/2020.js";

import { validateDecisionDossierDocument } from "@sentropic/focus/validate";

import { a2uiCommonTypes, a2uiSdkCatalogSchema } from "./a2ui-common-types.js";
import type { UiRenderCatalogDocument, UiRenderAssets } from "./assets.js";
import type { SemanticFinding, SemanticPort, UiRenderDiagnostic } from "./types.js";

/** The §4.3 item 3 budget: 1 MiB of UTF-8 (the limit itself is accepted). */
export const ENVELOPE_LIMIT_BYTES = 1048576;

/**
 * The prop every semantic engine validates. Fixed for the two semantic
 * components (DecisionDossier, BpmnCanvas): §5.1 names `document` the
 * semantic payload.
 */
const SEMANTIC_PAYLOAD_PROP = "document";

/** Escape one RFC 6901 token (`~` first, then `/`). */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Appends one property token to an RFC 6901 pointer. */
function appendPointerToken(pointer: string, token: string): string {
  return `${pointer}/${escapePointerToken(token)}`;
}

/**
 * The JSON-form contract (review 1, B1): the envelope IS a JSON value
 * (§4.3) and the property channel feeds plain JS objects that may carry
 * `undefined` values TypeScript callers routinely produce. `JSON.stringify`
 * drops such keys, so the raw JS object and its serialized form disagree.
 * The single JSON round-trip below defines the canonical form ONCE for both
 * seams: size measurement and both validators judge exactly the bytes the
 * host transmits.
 */
export type NormalizedEnvelopeInput =
  | { readonly ok: true; readonly value: unknown; readonly text: string }
  | { readonly ok: false; readonly kind: "not-json-value" | "not-serializable"; readonly message: string };

export function normalizeEnvelopeInput(input: unknown): NormalizedEnvelopeInput {
  let text: string | undefined;
  try {
    const serialized = JSON.stringify(input);
    if (typeof serialized !== "string") {
      return {
        ok: false,
        kind: "not-json-value",
        message: "the envelope is not a JSON value (§4.3)",
      };
    }
    text = serialized;
  } catch (error) {
    return {
      ok: false,
      kind: "not-serializable",
      message: `the envelope is not JSON-serializable (§4.3): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, value: JSON.parse(text) as unknown, text };
}

/**
 * UTF-8 byte length without TextEncoder (the pure half stays free of
 * host-global identifiers; surrogates pair to 4 bytes like the encoder's).
 */
export function utf8ByteLength(text: string): number {
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) total += 1;
    else if (code <= 0x7ff) total += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      total += 4;
      index += 1;
    } else total += 3;
  }
  return total;
}

/** A "major.minor" contract version (§4.4). */
interface ContractVersion {
  readonly major: number;
  readonly minor: number;
}

function parseContract(value: string): ContractVersion | undefined {
  const match = /^([0-9]+)\.([0-9]+)$/.exec(value);
  if (match === undefined || match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * A lazy engine chunk failed to load (§4.5 `engine-load-failed`): produced
 * when an injected port throws instead of returning findings.
 */
function engineLoadFailed(chunk: string, cause: string): UiRenderDiagnostic {
  return {
    code: "engine-load-failed",
    path: "",
    message: `the ${chunk} engine failed to load: ${cause}`,
    severity: "error",
    source: "host",
    detail: { chunk, cause },
  };
}

/** Structure issues become §4.5 `schema-violation` diagnostics. */
function structureDiagnostics(issues: readonly StructureIssue[], prefix: string): readonly UiRenderDiagnostic[] {
  return issues.map((issue) => {
    let path = `${prefix}${issue.pointer}`;
    if (issue.keyword === "required" && issue.missingProperty !== undefined) {
      path = appendPointerToken(path, issue.missingProperty);
    } else if (
      (issue.keyword === "unevaluatedProperties" || issue.keyword === "additionalProperties") &&
      issue.additionalProperty !== undefined
    ) {
      path = appendPointerToken(path, issue.additionalProperty);
    }
    return {
      code: "schema-violation",
      path,
      message: issue.message,
      severity: "error",
      source: "catalog",
      detail: { keyword: issue.keyword },
    };
  });
}

/**
 * One structure failure. `pointer` is an RFC 6901 JSON Pointer RELATIVE TO
 * THE VALIDATED VALUE (the envelope, or the root component object), so the
 * envelope validator can anchor it into the envelope.
 */
export interface StructureIssue {
  readonly pointer: string;
  readonly message: string;
  /** The failing keyword, e.g. `type`, `required`, `unevaluatedProperties`. */
  readonly keyword: string;
  /** For `required`: the missing property name. */
  readonly missingProperty?: string;
  /** For `unevaluatedProperties`/`additionalProperties`: the stray name. */
  readonly additionalProperty?: string;
}

/** Structure validation of both layers (§4.3: envelope, then component). */
export interface StructureValidator {
  validateEnvelope(value: unknown): readonly StructureIssue[];
  validateComponent(component: string, root: unknown): readonly StructureIssue[];
}

type AjvInstance = InstanceType<typeof Ajv2020>;
type CompiledSchema = ReturnType<AjvInstance["compile"]>;

interface AjvError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * The default structure seam (§4.3): ajv 8 (dist/2020) validating the
 * envelope and each catalogue entry against JSON Schema 2020-12.
 *
 * Registration set (all under their `$id`s, so every reference resolves
 * without network or file access): the vendored A2UI common types under the
 * v0.9.1 URI the entries reference `ComponentCommon` by; the built sibling
 * `catalog.json` stub under its URI — common_types' reachable graph ends at
 * its `anyFunction` definition, the empty function set `{ "not": {} }`
 * (§5.2 `functions: {}`), so every A2UI `FunctionCall` refuses; and the
 * catalogue itself, so each entry compiles through
 * `<catalogId>#/components/<Name>`.
 */
export interface AjvStructureOptions {
  readonly catalog: UiRenderCatalogDocument;
  readonly envelopeSchema: Record<string, unknown>;
  /** The vendored A2UI common types (mirrored in src/runtime/mcp/ui-render). */
  readonly commonTypes: Record<string, unknown>;
}

/** ajv errors become StructureIssues; the suffix params become token hints. */
function toIssues(compiled: CompiledSchema): readonly StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const error of (compiled.errors ?? []) as readonly AjvError[]) {
    const params = error.params ?? {};
    issues.push({
      pointer: error.instancePath,
      message: error.message ?? "the value does not satisfy the schema",
      keyword: error.keyword,
      ...(typeof params.missingProperty === "string" ? { missingProperty: params.missingProperty } : {}),
      ...(typeof params.additionalProperty === "string" ? { additionalProperty: params.additionalProperty } : {}),
      ...(typeof params.unevaluatedProperty === "string" ? { additionalProperty: params.unevaluatedProperty } : {}),
    });
  }
  return issues;
}

/**
 * Builds the 2020-12 structure validator for one catalogue. `strict: false`
 * trades nothing away: the committed documents carry vendor keywords
 * (`components`, `functions`, `catalogId`, `x-sentropic`) outside ajv's
 * known set, and their freshness is guarded by the vendored digests.
 */
export function createAjvStructure(options: AjvStructureOptions): StructureValidator {
  const catalogId = options.catalog["$id"];
  if (typeof catalogId !== "string" || catalogId.length === 0) {
    throw new Error("the catalogue document must carry its $id (§5.2: $id = catalogId)");
  }
  if (catalogId !== options.catalog.catalogId) {
    throw new Error("the catalogue document's $id and catalogId disagree (§5.2)");
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(options.commonTypes);
  ajv.addSchema(a2uiSdkCatalogSchema);
  ajv.addSchema(options.catalog);

  const envelopeValidate = ajv.compile(options.envelopeSchema);
  const entries = new Map<string, CompiledSchema>();

  /** Compiles (and caches) one entry; the error names what failed to compile. */
  function entryOf(component: string): { compiled: CompiledSchema } | { error: string } {
    const cached = entries.get(component);
    if (cached !== undefined) return { compiled: cached };
    try {
      const compiled = ajv.compile({ $ref: `${catalogId}#/components/${component}` });
      entries.set(component, compiled);
      return { compiled };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    validateEnvelope(value: unknown): readonly StructureIssue[] {
      return envelopeValidate(value) ? [] : toIssues(envelopeValidate);
    },

    validateComponent(component: string, root: unknown): readonly StructureIssue[] {
      const entry = entryOf(component);
      if ("error" in entry) {
        return [
          {
            pointer: "/component",
            message: `the catalogued schema for ${component} could not be compiled: ${entry.error}`,
            keyword: "$compile",
          },
        ];
      }
      return entry.compiled(root) ? [] : toIssues(entry.compiled);
    },
  };
}

/** One focus validation issue: `path` is focus's JSON-path style (`$.a[0].b`). */
export interface FocusValidationIssue {
  /** JSON-path-style location, e.g. `$.sections[3].id`. */
  readonly path: string;
  /** Focus's stable machine code, e.g. `duplicate_id`. */
  readonly code: string;
  readonly message: string;
}

/** The shape of `validateDecisionDossierDocument` (matched structurally). */
export type FocusValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly FocusValidationIssue[] };

/** Any function shaped like `@sentropic/focus/validate`'s default validator. */
export type FocusValidate = (value: unknown) => FocusValidationResult;

/**
 * Converts focus's JSON-path pointer (`$.sections[3].id`) to an RFC 6901
 * pointer relative to the payload (`/sections/3/id`).
 */
export function focusPathToPointer(path: string): string {
  const withoutRoot = path.startsWith("$") ? path.slice(1) : path;
  const tokens: string[] = [];
  for (const match of withoutRoot.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    const token = match[1] ?? match[2];
    if (token !== undefined) tokens.push(escapePointerToken(token));
  }
  return tokens.length === 0 ? "" : `/${tokens.join("/")}`;
}

/**
 * Wraps a focus validator as the injected `focus` semantic port
 * (h2a spec §4.2.3: `createFocusPort({ validate })`).
 */
export function createFocusPort(options: { readonly validate: FocusValidate }): SemanticPort {
  return {
    source: "focus",
    validate(payload: unknown): readonly SemanticFinding[] {
      const result = options.validate(payload);
      if (result.ok) return [];
      return result.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        pointer: focusPathToPointer(issue.path),
        severity: "error" as const,
      }));
    },
  };
}

/** Options of the h2a validator factory. */
export interface CreateUiRenderValidatorOptions {
  /** The verified asset set (`loadUiRenderAssets`). */
  readonly assets: UiRenderAssets;
  /** Injected semantic ports, by engine chunk name (§4.3 item 2). */
  readonly ports?: Readonly<Partial<Record<string, SemanticPort>>>;
}

/** A validator bound to one catalogue; `validate` is pure and reusable. */
export interface UiRenderValidator {
  validate(input: unknown): readonly UiRenderDiagnostic[];
}

/** The core factory: mirrors `createEnvelopeValidatorCore` (DS §4.3–§4.5). */
function createEnvelopeValidatorCore(
  options: CreateUiRenderValidatorOptions & { readonly structure: StructureValidator },
): UiRenderValidator {
  const { catalog, structure, ports } = { catalog: options.assets.catalog, structure: options.structure, ports: options.ports };

  return {
    validate(input: unknown): readonly UiRenderDiagnostic[] {
      // 1. The JSON round-trip (B1): the canonical form for size AND
      // validation. `undefined` keys vanish here, exactly as the wire sees
      // them, so both structure seams judge the same value.
      const normalized = normalizeEnvelopeInput(input);
      if (!normalized.ok) {
        return [
          {
            code: "schema-violation",
            path: "",
            message: normalized.message,
            severity: "error",
            source: "catalog",
          },
        ];
      }
      const text = normalized.text;
      const bytes = utf8ByteLength(text);
      if (bytes > ENVELOPE_LIMIT_BYTES) {
        return [
          {
            code: "payload-too-large",
            path: "",
            message: `the envelope is ${bytes} UTF-8 bytes, over the ${ENVELOPE_LIMIT_BYTES}-byte budget (§4.3 item 3)`,
            severity: "error",
            source: "catalog",
            detail: { limitBytes: ENVELOPE_LIMIT_BYTES, actualBytes: bytes },
          },
        ];
      }

      // 2. Envelope structure (§4.2), on the NORMALIZED value.
      const envelopeIssues = structure.validateEnvelope(normalized.value);
      if (envelopeIssues.length > 0) return structureDiagnostics(envelopeIssues, "");
      const envelope = normalized.value as Record<string, unknown>;

      // 3. `catalogId` is optional (§4.2: default = the renderer's catalogue):
      // absent names THIS catalogue; present, it must name THIS catalogue.
      // A non-string value that survived step 2 still refuses here.
      const envelopeCatalogId = envelope.catalogId;
      if (envelopeCatalogId !== undefined && envelopeCatalogId !== catalog.catalogId) {
        return [
          {
            code: "schema-violation",
            path: "/catalogId",
            message: `the envelope must name its catalogue (${String(catalog.catalogId)})`,
            severity: "error",
            source: "catalog",
            detail: { expected: catalog.catalogId, found: envelopeCatalogId },
          },
        ];
      }

      // 4. `preview` is reserved (§10.3).
      if (envelope.mode === "preview") {
        return [
          {
            code: "unsupported-mode",
            path: "/mode",
            message: 'mode "preview" is reserved and not rendered by this catalogue (§10.3)',
            severity: "error",
            source: "catalog",
            detail: { mode: "preview" },
          },
        ];
      }

      // 5. The targeted component must be catalogued.
      const root = envelope.root as Record<string, unknown>;
      const component = root.component;
      if (typeof component !== "string" || !(component in catalog.components)) {
        return [
          {
            code: "unknown-component",
            path: "/root/component",
            message: `no catalogued component is named ${String(component)}`,
            severity: "error",
            source: "catalog",
            detail: { component },
          },
        ];
      }

      // 6. A placeholder entry refuses (§5.2 x-sentropic.status).
      const entry = catalog.components[component];
      if (entry === undefined) {
        return [
          {
            code: "unknown-component",
            path: "/root/component",
            message: `no catalogued component is named ${component}`,
            severity: "error",
            source: "catalog",
            detail: { component },
          },
        ];
      }
      const sentropic = entry["x-sentropic"] as
        | { readonly contract?: unknown; readonly engine?: unknown; readonly status?: unknown }
        | undefined;
      if (sentropic?.status === "unknown") {
        return [
          {
            code: "component-unavailable",
            path: "/root/component",
            message: `${component} is catalogued as a placeholder (x-sentropic.status "unknown") and cannot render`,
            severity: "error",
            source: "catalog",
            detail: { component },
          },
        ];
      }

      // 7. The §4.4 contract rule: never newer, never another major.
      const envelopeContract = envelope.contract;
      const entryContract = sentropic?.contract;
      if (typeof entryContract !== "string") {
        return [
          {
            code: "schema-violation",
            path: "/root/component",
            message: `the catalogued entry for ${component} declares no x-sentropic contract`,
            severity: "error",
            source: "catalog",
          },
        ];
      }
      const parsedEntry = parseContract(entryContract);
      const parsedEnvelope = typeof envelopeContract === "string" ? parseContract(envelopeContract) : undefined;
      if (parsedEntry === undefined || parsedEnvelope === undefined) {
        return [
          {
            code: "schema-violation",
            path: "/contract",
            message: `contract versions are "major.minor" strings (§4.4): envelope ${String(
              envelopeContract,
            )}, entry ${entryContract}`,
            severity: "error",
            source: "catalog",
          },
        ];
      }
      if (parsedEnvelope.major !== parsedEntry.major || parsedEnvelope.minor > parsedEntry.minor) {
        return [
          {
            code: "unsupported-contract",
            path: "/contract",
            message: `the envelope targets contract ${String(envelopeContract)} but ${component} is at ${entryContract} (§4.4: an envelope may be older, never newer)`,
            severity: "error",
            source: "catalog",
            detail: { expected: entryContract, found: envelopeContract },
          },
        ];
      }

      // 8. The root's structure against the catalogue entry.
      const componentIssues = structure.validateComponent(component, root);
      if (componentIssues.length > 0) return structureDiagnostics(componentIssues, "/root");

      // 9. Semantics, only when the structure is clean (§4.3 item 2).
      const engine = sentropic?.engine;
      if (typeof engine !== "string" || !engine.startsWith("lazy:")) return [];
      const chunk = engine.slice("lazy:".length);
      const port = ports?.[chunk];
      const payloadPath = `/root/${SEMANTIC_PAYLOAD_PROP}`;
      if (port === undefined) {
        return [
          {
            code: "host-capability-missing",
            path: payloadPath,
            message: `the host did not inject the ${chunk} semantic port (engine ${engine}); the owning runtime validates this payload (§4.3 item 2)`,
            severity: "error",
            source: "host",
            detail: { chunk, engine },
          },
        ];
      }
      let findings: readonly SemanticFinding[];
      try {
        findings = port.validate(root[SEMANTIC_PAYLOAD_PROP]);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        return [{ ...engineLoadFailed(chunk, cause), path: payloadPath }];
      }
      return findings.map((finding) => ({
        // Engine warnings surface under the engine's own code (the one §4.5
        // names is `watermark-refused`); refusals are always `semantic-invalid`.
        code: finding.severity === "warning" ? finding.code : "semantic-invalid",
        path: `${payloadPath}${finding.pointer ?? ""}`,
        message: finding.message,
        severity: finding.severity,
        source: port.source,
        detail: { code: finding.code },
      }));
    },
  };
}

/**
 * Creates the ui:// render validator for the verified asset set: the ajv
 * 2020-12 structure bridge over the vendored catalogue, envelope schema and
 * mirrored A2UI common types, with the focus port wired by default
 * (`createFocusPort({ validate: validateDecisionDossierDocument })`).
 *
 * `@sentropic/bpmn-canvas` is not a dependency of this package, so no
 * `bpmn-canvas` port exists to inject: a `lazy:bpmn-canvas` envelope
 * honestly refuses `host-capability-missing` until the owning runtime ships
 * a Node-side port.
 */
export function createUiRenderValidator(options: CreateUiRenderValidatorOptions): UiRenderValidator {
  const structure = createAjvStructure({
    catalog: options.assets.catalog,
    envelopeSchema: options.assets.envelopeSchema,
    commonTypes: a2uiCommonTypes,
  });
  const ports =
    options.ports ?? { focus: createFocusPort({ validate: validateDecisionDossierDocument }) };
  return createEnvelopeValidatorCore({
    assets: options.assets,
    ports,
    structure,
  });
}
