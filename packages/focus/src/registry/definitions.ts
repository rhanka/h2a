/**
 * `@sentropic/focus/registry/definitions` — the publisher-owned definition
 * surface for the `sentropic.focus` skill entry (contract §§3–4, R4).
 *
 * This module is SIDE-EFFECT-FREE: importing it reads no file, opens no
 * handle and touches no network. The JSON manifest is read only when
 * {@link loadFocusSkillDescriptor} is called; instruction text is read only
 * through the caller-supplied loader in {@link resolveFocusPresentation},
 * and only AFTER the presentation preflight succeeds — so an unavailable
 * presentation refuses with `unsupported_presentation` with zero instruction
 * loads.
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";

/** Canonical registry ID of the Focus skill. */
export const FOCUS_SKILL_ID = "sentropic.focus";

/** Public entry version of the first Focus registry release. */
export const FOCUS_ENTRY_VERSION = "1.0.0";

/** Entry-contract version this descriptor conforms to. */
export const FOCUS_CONTRACT_VERSION = "1.1.4";

/** Parameter-schema version of the Focus entry (contract §5.4). */
export const FOCUS_PARAMETERS_SCHEMA_VERSION = "1.0.0";

/** Existing skill-description limit enforced by the contract. */
export const MAX_SKILL_DESCRIPTION_LENGTH = 280;

export type FocusPresentation = "terminal" | "markdown" | "html" | "mcp-app";
export type FocusLocale = "en" | "fr";

export interface FocusParameters {
  readonly mode: "snapshot";
  readonly preferredPresentation: FocusPresentation;
  readonly locale: FocusLocale;
}

/** Exact §5.4 defaults, applied once before validation. */
export const FOCUS_PARAMETER_DEFAULTS: FocusParameters = {
  mode: "snapshot",
  preferredPresentation: "markdown",
  locale: "en",
};

export interface DefinitionIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type DefinitionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DefinitionIssue[] };

const definitionIssue = (
  path: string,
  code: string,
  message: string,
): DefinitionIssue => ({ path, code, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Exact §5.4 parameter values pinned by entry 1.0.0 (closed: any drift refuses). */
const FOCUS_PRESENTATIONS = ["terminal", "markdown", "html", "mcp-app"] as const;
const FOCUS_LOCALES = ["en", "fr"] as const;
const FOCUS_PARAMETER_KEYS = ["mode", "preferredPresentation", "locale"] as const;
const FOCUS_PARAMETERS_SCHEMA_ID = "urn:sentropic:registry:parameters:sentropic.focus:1.0.0";
const FOCUS_PARAMETERS_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

/** Capability and schema references pinned by entry 1.0.0. */
const FOCUS_CAPABILITY_ID = "sentropic.focus.decision-dossier";
const FOCUS_DOSSIER_SCHEMA_ID = "urn:sentropic:focus:DecisionDossierDocument:1.0.0";
const FOCUS_DOSSIER_SCHEMA_VERSION = "1.0.0";

const sameStrings = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

export interface FocusAsset {
  readonly role: string;
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
}

export interface FocusDocumentSchemaRef {
  readonly name: string;
  readonly schemaId: string;
  readonly version: string;
  readonly assetPath: string;
  readonly sha256: string;
}

export interface FocusSkillPayload {
  readonly profile: "instructions";
  readonly metadata: {
    readonly category: string;
    readonly contextFilters: readonly string[];
    readonly permissions: readonly string[];
    readonly toolNames: readonly string[];
  };
  readonly instructionsAsset: string;
  readonly capabilities: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly effect: "read-only" | "mutation";
    readonly permissions: readonly string[];
    readonly inputSchemaRef?: string;
    readonly outputSchemaRef?: string;
  }>;
  readonly tools: readonly unknown[];
  readonly documentSchemas: readonly FocusDocumentSchemaRef[];
  readonly dependencies: readonly unknown[];
}

export interface FocusEntryDescriptor {
  readonly format: "sentropic.registry-entry/v1";
  readonly contractVersion: string;
  readonly kind: "skill";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly entryVersion: string;
  readonly publisher: { readonly packageName: string; readonly packageVersion: string };
  readonly compatibility: {
    readonly entryContract: string;
    readonly packages: ReadonlyArray<{ readonly name: string; readonly range: string }>;
    readonly schemaProfiles: readonly string[];
    readonly requiredHostFeatures: readonly string[];
    readonly optionalHostFeatures: readonly string[];
  };
  readonly parameters: {
    readonly schemaVersion: string;
    readonly schema: Record<string, unknown>;
    readonly defaults: Record<string, unknown>;
  };
  readonly bindings: readonly unknown[];
  readonly assets: readonly FocusAsset[];
  readonly skill: FocusSkillPayload;
}

const stringArray = (
  value: unknown,
  path: string,
  issues: DefinitionIssue[],
): readonly string[] | undefined => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push(definitionIssue(path, "invalid_parameters", "expected an array of strings"));
    return undefined;
  }
  return value as readonly string[];
};

/**
 * Closed validation of the publisher-owned Focus entry descriptor.
 * Pure: no I/O, so catalog-time checks perform zero instruction reads.
 */
export const validateFocusEntryDescriptor = (
  value: unknown,
): DefinitionResult<FocusEntryDescriptor> => {
  const issues: DefinitionIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [definitionIssue("$", "invalid_entry", "expected an object")] };
  }
  const at = (key: string): string => `$.${key}`;
  let valid = true;
  const fail = (path: string, code: string, message: string): void => {
    issues.push(definitionIssue(path, code, message));
    valid = false;
  };
  const rejectUnknownKeys = (
    record: Record<string, unknown>,
    allowed: readonly string[],
    basePath: string,
    ignore: readonly string[] = [],
  ): void => {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key) && !ignore.includes(key)) {
        fail(`${basePath}.${key}`, "unknown_field", `unknown field "${key}"`);
      }
    }
  };

  rejectUnknownKeys(
    value,
    ["format", "contractVersion", "kind", "id", "name", "description", "entryVersion", "publisher", "compatibility", "parameters", "bindings", "assets", "skill"],
    "$",
    // `mcp` keeps its dedicated arm diagnostic below (exactly one issue).
    ["mcp"],
  );

  if (value["format"] !== "sentropic.registry-entry/v1") fail(at("format"), "invalid_entry", "expected sentropic.registry-entry/v1");
  if (value["contractVersion"] !== FOCUS_CONTRACT_VERSION) fail(at("contractVersion"), "incompatible_version", `expected ${FOCUS_CONTRACT_VERSION}`);
  if (value["kind"] !== "skill") fail(at("kind"), "invalid_entry", 'expected "skill"');
  if (value["id"] !== FOCUS_SKILL_ID) fail(at("id"), "invalid_entry", `expected "${FOCUS_SKILL_ID}"`);
  if (value["name"] !== "focus") fail(at("name"), "invalid_entry", 'expected name "focus"');
  if (typeof value["description"] !== "string" || value["description"].length === 0) {
    fail(at("description"), "invalid_entry", "expected a nonempty description");
  } else if (value["description"].length > MAX_SKILL_DESCRIPTION_LENGTH) {
    fail(at("description"), "invalid_entry", `description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);
  }
  if (typeof value["entryVersion"] !== "string" || !SEMVER.test(value["entryVersion"])) {
    fail(at("entryVersion"), "invalid_entry", "expected an exact SemVer entry version");
  }
  if (value["entryVersion"] !== FOCUS_ENTRY_VERSION) fail(at("entryVersion"), "incompatible_version", `expected ${FOCUS_ENTRY_VERSION}`);

  const publisher = value["publisher"];
  if (
    !isRecord(publisher) ||
    publisher["packageName"] !== "@sentropic/focus" ||
    typeof publisher["packageVersion"] !== "string" ||
    !SEMVER.test(publisher["packageVersion"])
  ) {
    fail(at("publisher"), "invalid_entry", "expected the @sentropic/focus package identity with an exact version");
  }
  if (isRecord(publisher)) {
    rejectUnknownKeys(publisher, ["packageName", "packageVersion"], at("publisher"));
  }

  const compatibility = value["compatibility"];
  if (!isRecord(compatibility) || compatibility["entryContract"] !== FOCUS_CONTRACT_VERSION) {
    fail(at("compatibility"), "incompatible_version", "expected the pinned entry-contract version");
  } else {
    rejectUnknownKeys(
      compatibility,
      ["entryContract", "packages", "schemaProfiles", "requiredHostFeatures", "optionalHostFeatures"],
      at("compatibility"),
    );
    const packages = compatibility["packages"];
    if (
      !Array.isArray(packages) ||
      packages.length === 0 ||
      packages.some(
        (row) =>
          !isRecord(row) ||
          typeof row["name"] !== "string" ||
          typeof row["range"] !== "string" ||
          Object.keys(row).some((key) => key !== "name" && key !== "range"),
      )
    ) {
      fail("$.compatibility.packages", "invalid_entry", "expected a nonempty list of closed package peer rows");
    }
    const profiles = stringArray(compatibility["schemaProfiles"], "$.compatibility.schemaProfiles", issues);
    if (profiles === undefined) valid = false;
    else if (!profiles.includes("sentropic.parameters/2020-12-bounded-v1")) {
      fail("$.compatibility.schemaProfiles", "unsupported_schema_profile", "expected the bounded parameters profile");
    }
    if (stringArray(compatibility["requiredHostFeatures"], "$.compatibility.requiredHostFeatures", issues) === undefined) valid = false;
    if (stringArray(compatibility["optionalHostFeatures"], "$.compatibility.optionalHostFeatures", issues) === undefined) valid = false;
  }

  const parameters = value["parameters"];
  if (!isRecord(parameters) || parameters["schemaVersion"] !== FOCUS_PARAMETERS_SCHEMA_VERSION) {
    fail(at("parameters"), "unsupported_schema_profile", `expected parameter schema version ${FOCUS_PARAMETERS_SCHEMA_VERSION}`);
  } else {
    rejectUnknownKeys(parameters, ["schemaVersion", "schema", "defaults"], at("parameters"));
    const schema = parameters["schema"];
    if (!isRecord(schema)) {
      fail("$.parameters.schema", "unsupported_schema_profile", "expected a schema object");
    } else {
      rejectUnknownKeys(
        schema,
        ["$schema", "$id", "type", "additionalProperties", "required", "properties"],
        "$.parameters.schema",
      );
      if (schema["$schema"] !== FOCUS_PARAMETERS_SCHEMA_DRAFT) {
        fail("$.parameters.schema.$schema", "unsupported_schema_profile", `expected ${FOCUS_PARAMETERS_SCHEMA_DRAFT}`);
      }
      if (schema["$id"] !== FOCUS_PARAMETERS_SCHEMA_ID) {
        fail("$.parameters.schema.$id", "unsupported_schema_profile", `expected ${FOCUS_PARAMETERS_SCHEMA_ID}`);
      }
      const properties = schema["properties"];
      if (
        schema["type"] !== "object" ||
        schema["additionalProperties"] !== false ||
        !sameStrings(schema["required"], [...FOCUS_PARAMETER_KEYS]) ||
        !isRecord(properties)
      ) {
        fail("$.parameters.schema", "unsupported_schema_profile", "expected the exact §5.4 focus parameter shape");
      } else {
        rejectUnknownKeys(properties, [...FOCUS_PARAMETER_KEYS], "$.parameters.schema.properties");
        const mode = properties["mode"];
        const preferredPresentation = properties["preferredPresentation"];
        const locale = properties["locale"];
        if (
          !isRecord(mode) ||
          mode["const"] !== "snapshot" ||
          !isRecord(preferredPresentation) ||
          !sameStrings(preferredPresentation["enum"], [...FOCUS_PRESENTATIONS]) ||
          !isRecord(locale) ||
          !sameStrings(locale["enum"], [...FOCUS_LOCALES])
        ) {
          fail("$.parameters.schema", "unsupported_schema_profile", "expected the exact §5.4 focus parameter shape");
        }
      }
    }
    const defaults = parameters["defaults"];
    if (
      !isRecord(defaults) ||
      defaults["mode"] !== FOCUS_PARAMETER_DEFAULTS.mode ||
      defaults["preferredPresentation"] !== FOCUS_PARAMETER_DEFAULTS.preferredPresentation ||
      defaults["locale"] !== FOCUS_PARAMETER_DEFAULTS.locale
    ) {
      fail("$.parameters.defaults", "invalid_parameters", "expected the exact §5.4 defaults");
    } else {
      rejectUnknownKeys(defaults, [...FOCUS_PARAMETER_KEYS], "$.parameters.defaults");
    }
  }

  if (!Array.isArray(value["bindings"]) || (value["bindings"] as unknown[]).length !== 0) {
    fail(at("bindings"), "invalid_entry", "instruction-only entries carry no bindings");
  }

  const assets = value["assets"];
  if (!Array.isArray(assets) || assets.length === 0) {
    fail(at("assets"), "invalid_entry", "expected a nonempty asset list");
  } else {
    assets.forEach((asset: unknown, index: number) => {
      const path = `$.assets[${index}]`;
      if (
        !isRecord(asset) ||
        typeof asset["role"] !== "string" ||
        typeof asset["path"] !== "string" ||
        typeof asset["mediaType"] !== "string" ||
        typeof asset["sha256"] !== "string" ||
        !HEX64.test(asset["sha256"])
      ) {
        fail(path, "invalid_entry", "expected { role, path, mediaType, sha256 } with a full SHA-256 hex digest");
      } else {
        rejectUnknownKeys(asset, ["role", "path", "mediaType", "sha256"], path);
      }
    });
    if (assets.every((asset: unknown) => isRecord(asset) && typeof asset["path"] === "string")) {
      for (const safeIssue of assertSafeAssetPaths({ assets: assets as FocusEntryDescriptor["assets"] })) {
        issues.push(safeIssue);
        valid = false;
      }
    }
  }
  const declaredAssetPaths = new Set<string>(
    Array.isArray(assets)
      ? assets
          .filter((asset: unknown): asset is Record<string, unknown> => isRecord(asset))
          .map((asset) => asset["path"])
          .filter((path: unknown): path is string => typeof path === "string")
      : [],
  );

  const skill = value["skill"];
  if (!isRecord(skill) || value["mcp"] !== undefined) {
    fail(at("skill"), "invalid_entry", "expected exactly the skill payload (no mcp arm)");
  } else {
    rejectUnknownKeys(
      skill,
      ["profile", "metadata", "instructionsAsset", "capabilities", "tools", "documentSchemas", "dependencies"],
      at("skill"),
    );
    if (skill["profile"] !== "instructions") fail("$.skill.profile", "invalid_entry", 'expected the instruction-only profile');
    const metadata = skill["metadata"];
    if (
      !isRecord(metadata) ||
      typeof metadata["category"] !== "string" ||
      !Array.isArray(metadata["toolNames"]) ||
      metadata["toolNames"].length !== 0
    ) {
      fail("$.skill.metadata", "invalid_entry", "expected category metadata with empty toolNames");
    } else {
      rejectUnknownKeys(metadata, ["category", "contextFilters", "permissions", "toolNames"], "$.skill.metadata");
      if (stringArray(metadata["contextFilters"], "$.skill.metadata.contextFilters", issues) === undefined) valid = false;
      if (stringArray(metadata["permissions"], "$.skill.metadata.permissions", issues) === undefined) valid = false;
    }
    if (typeof skill["instructionsAsset"] !== "string") {
      fail("$.skill.instructionsAsset", "invalid_entry", "expected one SKILL.md asset path");
    } else if (!declaredAssetPaths.has(skill["instructionsAsset"])) {
      fail("$.skill.instructionsAsset", "invalid_entry", "instruction asset is not a declared entry asset");
    }
    const capabilities = skill["capabilities"];
    if (!Array.isArray(capabilities) || capabilities.length !== 1) {
      fail("$.skill.capabilities", "invalid_entry", `expected exactly the read-only ${FOCUS_CAPABILITY_ID} capability`);
    } else {
      const capability = capabilities[0];
      if (
        !isRecord(capability) ||
        capability["id"] !== FOCUS_CAPABILITY_ID ||
        capability["effect"] !== "read-only"
      ) {
        fail("$.skill.capabilities", "invalid_entry", `expected exactly the read-only ${FOCUS_CAPABILITY_ID} capability`);
      } else {
        rejectUnknownKeys(
          capability,
          ["id", "description", "effect", "permissions", "inputSchemaRef", "outputSchemaRef"],
          "$.skill.capabilities[0]",
        );
        if (
          typeof capability["description"] !== "string" ||
          capability["description"].length === 0 ||
          stringArray(capability["permissions"], "$.skill.capabilities[0].permissions", issues) === undefined
        ) {
          if (typeof capability["description"] !== "string" || capability["description"].length === 0) {
            fail("$.skill.capabilities[0].description", "invalid_entry", "expected a nonempty capability description");
          }
          valid = false;
        }
        if (
          capability["inputSchemaRef"] !== FOCUS_DOSSIER_SCHEMA_ID ||
          capability["outputSchemaRef"] !== FOCUS_DOSSIER_SCHEMA_ID
        ) {
          fail("$.skill.capabilities[0]", "invalid_entry", `expected schema refs bound to ${FOCUS_DOSSIER_SCHEMA_ID}`);
        }
      }
    }
    if (!Array.isArray(skill["tools"]) || (skill["tools"] as unknown[]).length !== 0) {
      fail("$.skill.tools", "invalid_entry", "instruction-only entries carry no tools");
    }
    const schemas = skill["documentSchemas"];
    if (!Array.isArray(schemas) || schemas.length !== 1) {
      fail("$.skill.documentSchemas", "invalid_entry", "expected exactly the digest-bound DecisionDossierDocument schema reference");
    } else {
      const schema = schemas[0];
      if (
        !isRecord(schema) ||
        schema["name"] !== "DecisionDossierDocument" ||
        schema["schemaId"] !== FOCUS_DOSSIER_SCHEMA_ID ||
        schema["version"] !== FOCUS_DOSSIER_SCHEMA_VERSION ||
        typeof schema["assetPath"] !== "string" ||
        typeof schema["sha256"] !== "string" ||
        !HEX64.test(schema["sha256"])
      ) {
        fail("$.skill.documentSchemas", "invalid_entry", "expected exactly the digest-bound DecisionDossierDocument schema reference");
      } else {
        rejectUnknownKeys(
          schema,
          ["name", "schemaId", "version", "assetPath", "sha256"],
          "$.skill.documentSchemas[0]",
        );
        if (!declaredAssetPaths.has(schema["assetPath"])) {
          fail("$.skill.documentSchemas[0].assetPath", "invalid_entry", "schema asset is not a declared entry asset");
        }
      }
    }
    if (!Array.isArray(skill["dependencies"]) || (skill["dependencies"] as unknown[]).length !== 0) {
      fail("$.skill.dependencies", "invalid_entry", "instruction-only entries carry no dependencies");
    }
  }

  if (!valid) return { ok: false, issues };
  return { ok: true, value: value as unknown as FocusEntryDescriptor };
};

/**
 * Validate Focus configuration values against the exact §5.4 profile.
 * Declared defaults apply once before validation; unknown keys refuse.
 */
export const validateFocusParameters = (
  value: unknown,
): DefinitionResult<FocusParameters> => {
  const issues: DefinitionIssue[] = [];
  const merged: Record<string, unknown> =
    value === undefined ? {} : isRecord(value) ? { ...value } : {};
  if (value !== undefined && !isRecord(value)) {
    return { ok: false, issues: [definitionIssue("$", "invalid_parameters", "expected an object")] };
  }
  for (const [key, fallback] of Object.entries(FOCUS_PARAMETER_DEFAULTS)) {
    if (merged[key] === undefined) merged[key] = fallback;
  }
  for (const key of Object.keys(merged)) {
    if (!(key in FOCUS_PARAMETER_DEFAULTS)) {
      issues.push(definitionIssue(`$.${key}`, "invalid_parameters", "unknown parameter"));
    }
  }
  if (merged["mode"] !== "snapshot") {
    issues.push(definitionIssue("$.mode", "invalid_parameters", 'mode is fixed to "snapshot"'));
  }
  const presentations = ["terminal", "markdown", "html", "mcp-app"];
  if (typeof merged["preferredPresentation"] !== "string" || !presentations.includes(merged["preferredPresentation"])) {
    issues.push(
      definitionIssue("$.preferredPresentation", "invalid_parameters", `expected one of: ${presentations.join(" | ")}`),
    );
  }
  if (merged["locale"] !== "en" && merged["locale"] !== "fr") {
    issues.push(definitionIssue("$.locale", "invalid_parameters", 'expected "en" or "fr"'));
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      mode: "snapshot",
      preferredPresentation: merged["preferredPresentation"] as FocusPresentation,
      locale: merged["locale"] as FocusLocale,
    },
  };
};

export interface PresentationGate {
  /** True when the host registry holds a UI entry for Focus. */
  readonly uiRegistered: boolean;
  /** True when the host selected that UI entry for this session. */
  readonly uiSelected: boolean;
  /** True when the host qualified the selected UI entry. */
  readonly uiQualified: boolean;
  /** True only when the host supplies an HTML sanitization hook. */
  readonly htmlSanitizerAvailable: boolean;
}

export type PresentationResolution =
  | { readonly ok: true; readonly instructions: string }
  | { readonly ok: false; readonly code: "unsupported_presentation"; readonly message: string };

/**
 * Presentation preflight for the selected Focus configuration.
 * `loadInstructions` runs ONLY when the requested presentation is usable, so
 * an unavailable `mcp-app` (or an unsanitized `html`) refuses with
 * `unsupported_presentation` with zero instruction reads/loads.
 */
export const resolveFocusPresentation = (
  params: FocusParameters,
  gate: PresentationGate,
  loadInstructions: () => string,
): PresentationResolution => {
  switch (params.preferredPresentation) {
    case "terminal":
    case "markdown":
      return { ok: true, instructions: loadInstructions() };
    case "html":
      if (!gate.htmlSanitizerAvailable) {
        return {
          ok: false,
          code: "unsupported_presentation",
          message: "html presentation requires the host sanitization hook",
        };
      }
      return { ok: true, instructions: loadInstructions() };
    case "mcp-app":
      if (!gate.uiRegistered || !gate.uiSelected || !gate.uiQualified) {
        return {
          ok: false,
          code: "unsupported_presentation",
          message: "mcp-app presentation requires the separately registered, selected and qualified UI entry",
        };
      }
      return { ok: true, instructions: loadInstructions() };
  }
};

const packageRequire = createRequire(import.meta.url);

/**
 * Read the package-owned registry manifest (`registry/entries.v1.json`).
 * Called explicitly by the host; importing this module alone reads nothing.
 *
 * The compiled snapshot vendored into `@sentropic/track`
 * (`packages/track/src/focus-vendor/`) ships no adjacent manifest, so the
 * package-relative path misses there: fall back to the publisher-owned
 * manifest through the installed `@sentropic/focus` package.
 */
export const loadFocusSkillDescriptor = (): unknown => {
  try {
    return packageRequire("../../registry/entries.v1.json") as unknown;
  } catch {
    return packageRequire("@sentropic/focus/registry/manifest") as unknown;
  }
};

/** Recompute every asset/schema digest over the supplied bytes. */
export const verifyAssetDigests = (
  entry: FocusEntryDescriptor,
  readFile: (packageRelativePath: string) => Uint8Array | null,
): DefinitionIssue[] => {
  const issues: DefinitionIssue[] = [];
  const digestOf = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");
  for (const asset of entry.assets) {
    const bytes = readFile(asset.path);
    if (bytes === null) {
      issues.push(definitionIssue(`asset:${asset.path}`, "invalid_entry", "asset missing from the package"));
    } else if (digestOf(bytes) !== asset.sha256) {
      issues.push(definitionIssue(`asset:${asset.path}`, "integrity_mismatch", "asset bytes do not match the entry digest"));
    }
  }
  for (const schema of entry.skill.documentSchemas) {
    const bytes = readFile(schema.assetPath);
    if (bytes === null) {
      issues.push(definitionIssue(`asset:${schema.assetPath}`, "invalid_entry", "schema asset missing from the package"));
    } else if (digestOf(bytes) !== schema.sha256) {
      issues.push(definitionIssue(`asset:${schema.assetPath}`, "integrity_mismatch", "schema bytes do not match the entry digest"));
    }
  }
  return issues;
};

/** Refuse absolute paths, traversal, escapes and duplicates. */
export const assertSafeAssetPaths = (
  entry: Pick<FocusEntryDescriptor, "assets">,
): DefinitionIssue[] => {
  const issues: DefinitionIssue[] = [];
  const seen = new Set<string>();
  for (const asset of entry.assets) {
    const path = asset.path;
    const segments = path.split("/");
    if (
      path.length === 0 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      issues.push(definitionIssue(`asset:${path}`, "path_escape", "asset path must be a clean package-relative POSIX path"));
    }
    if (seen.has(path)) {
      issues.push(definitionIssue(`asset:${path}`, "duplicate_entry", "asset path listed twice"));
    }
    seen.add(path);
  }
  return issues;
};
