/**
 * R5 registry entry descriptors (h2a side).
 *
 * Validates the package-owned `registry/entries.v1.json` envelopes from
 * contract registry-entry-contract-v8 §§3–5 without depending on the later
 * Sentropic R2/R7a/R3 delivery (platform remote routing, mesh bridge/CLI,
 * SKILLS facade). Where those lots are needed, callers refuse with a typed
 * code (see registry.ts) instead of inferring behavior.
 *
 * Dependency-light by design: only `node:crypto` is imported, so the
 * `./registry/definitions` subpath keeps a light static import graph (no
 * cluster-mesh, h2a-runtime, node-pty or handler modules).
 */

import { createHash } from "node:crypto";

export const REGISTRY_ENTRY_FORMAT = "sentropic.registry-entry/v1";
export const REGISTRY_ENTRY_CONTRACT_VERSION = "1.1.4";
export const REGISTRY_PACKAGE_FORMAT = "sentropic.registry-package/v1";

export type RegistryDiagnosticCode =
  | "invalid_entry"
  | "duplicate_entry"
  | "name_collision"
  | "invalid_parameters"
  | "unsupported_schema_profile"
  | "unsupported_definition_kind"
  | "missing_binding"
  | "incompatible_version"
  | "integrity_mismatch"
  | "policy_weakened"
  | "unsupported_host"
  | "unsupported_presentation"
  | "central_unavailable"
  | "missing_lock"
  | "stale_generation";

export class RegistryError extends Error {
  readonly code: RegistryDiagnosticCode;
  constructor(code: RegistryDiagnosticCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RegistryError";
    this.code = code;
  }
}

function fail(code: RegistryDiagnosticCode, message: string): never {
  throw new RegistryError(code, message);
}

export interface RegistryAssetRef {
  role: string;
  path: string;
  mediaType: string;
  sha256: string;
}

export interface RegistryEntry {
  format: string;
  contractVersion: string;
  kind: string;
  id: string;
  name: string;
  description: string;
  entryVersion: string;
  publisher: { packageName: string; packageVersion: string };
  compatibility: {
    entryContract: string;
    packages: Array<{ name: string; range: string }>;
    schemaProfiles: string[];
    requiredHostFeatures: string[];
    optionalHostFeatures: string[];
  };
  parameters: { schemaVersion: string; schema: unknown; defaults: unknown };
  bindings: Array<{ key: string; contract: string; required: boolean }>;
  assets: RegistryAssetRef[];
  mcp?: {
    manifestAsset: string;
    connectorIds: string[];
    transportProfiles: Array<{
      id: string;
      mode: string;
      bindingKey?: string;
      protocolVersions: string[];
      requiredHostFeatures: string[];
    }>;
    protocolVersions: string[];
    capabilityProfiles?: Array<{
      id: string;
      tools: string[];
      resources: string[];
      prompts: string[];
      readOnly: boolean;
    }>;
  };
  skill?: unknown;
  extensions?: Record<string, unknown>;
  requiredExtensions?: string[];
}

const ROOT_FIELDS = new Set([
  "format", "contractVersion", "kind", "id", "name", "description",
  "entryVersion", "publisher", "compatibility", "parameters", "bindings",
  "assets", "mcp", "skill", "extensions", "requiredExtensions"
]);

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Minimal range check: exact, ^major-compatible or ~minor-compatible. */
function rangeAdmits(range: string, version: string): boolean {
  const clean = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const want = clean(version);
  if (!want) return false;
  if (range === version || range === "*") return true;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (caret) {
    const base: [number, number, number] = [Number(caret[1]), Number(caret[2]), Number(caret[3])];
    if (base[0] !== 0) return want[0] === base[0] && (want[1] > base[1] || (want[1] === base[1] && want[2] >= base[2]));
    if (base[1] !== 0) return want[0] === 0 && want[1] === base[1] && want[2] >= base[2];
    return want[0] === 0 && want[1] === 0 && want[2] === base[2];
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (tilde) {
    return want[0] === Number(tilde[1]) && want[1] === Number(tilde[2]) && want[2] >= Number(tilde[3]);
  }
  return false;
}

/**
 * Dependency-free canonical JSON for entry digests (RFC 8785 shape for the
 * JSON subset descriptors use: objects with string keys, arrays, strings,
 * finite numbers, booleans, null). Rejects duplicate keys while reading raw
 * JSON text, non-finite numbers and lone surrogates.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid_entry", "lone surrogate in string");
        i++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        fail("invalid_entry", "lone surrogate in string");
      }
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_entry", "non-finite number");
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${parts.join(",")}}`;
  }
  fail("invalid_entry", `non-JSON value of type ${typeof value}`);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestDescriptor(entry: RegistryEntry): string {
  return sha256Hex(canonicalJson(entry));
}

/** Parse raw JSON text while refusing duplicate object keys. */
export function parseNoDuplicateKeys(text: string): unknown {
  let index = 0;
  const peek = (): string => text[index];
  const skipWs = (): void => {
    while (index < text.length && " \t\n\r".includes(text[index])) index++;
  };
  const parseString = (): string => {
    const start = index;
    index++; // opening quote
    let escaped = false;
    while (index < text.length) {
      const ch = text[index];
      if (escaped) {
        escaped = false;
        index++;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        index++;
        continue;
      }
      if (ch === '"') {
        index++;
        return JSON.parse(text.slice(start, index)) as string;
      }
      if (ch < " ") fail("invalid_entry", "control character in string");
      index++;
    }
    return fail("invalid_entry", "unterminated string");
  };
  // Track raw literal spans so escapes resolve exactly once via JSON.parse.
  const parseValue = (): unknown => {
    skipWs();
    const ch = peek();
    if (ch === "{") return parseObject();
    if (ch === "[") {
      index++;
      const items: unknown[] = [];
      skipWs();
      if (peek() === "]") {
        index++;
        return items;
      }
      for (;;) {
        items.push(parseValue());
        skipWs();
        const sep = peek();
        if (sep === ",") {
          index++;
          continue;
        }
        if (sep === "]") {
          index++;
          return items;
        }
        return fail("invalid_entry", "malformed JSON array");
      }
    }
    if (ch === '"') {
      const start = index;
      parseString();
      return JSON.parse(text.slice(start, index)) as unknown;
    }
    const literal = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(index));
    if (literal) {
      index += literal[0].length;
      const parsed: unknown = JSON.parse(literal[0]);
      if (typeof parsed === "number" && !Number.isFinite(parsed)) fail("invalid_entry", "non-finite number");
      return parsed;
    }
    return fail("invalid_entry", `malformed JSON at offset ${index}`);
  };
  const parseObject = (): Record<string, unknown> => {
    index++; // {
    const obj: Record<string, unknown> = {};
    skipWs();
    if (peek() === "}") {
      index++;
      return obj;
    }
    for (;;) {
      skipWs();
      if (peek() !== '"') fail("invalid_entry", "object key must be a string");
      const start = index;
      parseString();
      const key = JSON.parse(text.slice(start, index)) as string;
      if (Object.hasOwn(obj, key)) fail("invalid_entry", `duplicate key ${JSON.stringify(key)}`);
      skipWs();
      if (peek() !== ":") fail("invalid_entry", "object entry must have a colon");
      index++;
      obj[key] = parseValue();
      skipWs();
      const sep = peek();
      if (sep === ",") {
        index++;
        continue;
      }
      if (sep === "}") {
        index++;
        return obj;
      }
      return fail("invalid_entry", "malformed JSON object");
    }
  };
  const value = parseValue();
  skipWs();
  if (index !== text.length) fail("invalid_entry", "trailing bytes after JSON document");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAssetRef(asset: unknown, field: string): asserts asset is RegistryAssetRef {
  if (!isRecord(asset)) fail("invalid_entry", `${field} must be an object`);
  for (const key of ["role", "path", "mediaType", "sha256"]) {
    if (typeof asset[key] !== "string" || (asset[key] as string).length === 0) {
      fail("invalid_entry", `${field}.${key} must be a nonempty string`);
    }
  }
  const path = asset["path"] as string;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
    fail("invalid_entry", `${field}.path must be a package-root-relative POSIX path`);
  }
  if (!SHA256_HEX.test(asset["sha256"] as string)) fail("invalid_entry", `${field}.sha256 must be 64 lowercase hex digits`);
}

/**
 * Validate a registry entry envelope. `expectedDigest` (from a lock) turns a
 * mismatch into `integrity_mismatch`; without it the digest is computed and
 * returned. Never reads the filesystem; use verifyAssetClosure for bytes.
 */
export function validateRegistryEntry(
  raw: unknown,
  options: { expectedDigest?: string } = {}
): { entry: RegistryEntry; digest: string } {
  if (!isRecord(raw)) fail("invalid_entry", "entry must be an object");
  for (const key of Object.keys(raw)) {
    if (!ROOT_FIELDS.has(key)) fail("invalid_entry", `unknown field ${JSON.stringify(key)}`);
  }
  const entry = raw as unknown as RegistryEntry;
  if (entry.format !== REGISTRY_ENTRY_FORMAT) fail("invalid_entry", `format must be ${REGISTRY_ENTRY_FORMAT}`);
  if (typeof entry.contractVersion !== "string" || !SEMVER.test(entry.contractVersion)) {
    fail("invalid_entry", "contractVersion must be exact SemVer");
  }
  if (!rangeAdmits(entry.contractVersion, REGISTRY_ENTRY_CONTRACT_VERSION)) {
    fail("incompatible_version", `contractVersion ${entry.contractVersion} does not admit ${REGISTRY_ENTRY_CONTRACT_VERSION}`);
  }
  if (entry.kind !== "mcp" && entry.kind !== "skill") fail("invalid_entry", 'kind must be "mcp" or "skill"');
  for (const key of ["id", "name", "description"] as const) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) fail("invalid_entry", `${key} must be a nonempty string`);
  }
  if (entry.kind === "skill" && entry.description.length > 280) {
    fail("invalid_entry", "skill description exceeds the 280-character limit");
  }
  if (typeof entry.entryVersion !== "string" || !SEMVER.test(entry.entryVersion)) {
    fail("invalid_entry", "entryVersion must be exact SemVer");
  }
  if (!isRecord(entry.publisher) || typeof entry.publisher.packageName !== "string" || typeof entry.publisher.packageVersion !== "string") {
    fail("invalid_entry", "publisher must carry packageName/packageVersion strings");
  }
  if (!SEMVER.test(entry.publisher.packageVersion)) fail("invalid_entry", "publisher.packageVersion must be exact SemVer");
  const compat = entry.compatibility;
  if (!isRecord(compat) || typeof compat.entryContract !== "string") fail("invalid_entry", "compatibility.entryContract is required");
  if (!rangeAdmits(compat.entryContract, REGISTRY_ENTRY_CONTRACT_VERSION)) {
    fail("incompatible_version", `compatibility.entryContract ${compat.entryContract} excludes ${REGISTRY_ENTRY_CONTRACT_VERSION}`);
  }
  if (!Array.isArray(compat.schemaProfiles) || compat.schemaProfiles.length === 0) {
    fail("invalid_entry", "compatibility.schemaProfiles must be nonempty");
  }
  for (const key of ["requiredHostFeatures", "optionalHostFeatures"] as const) {
    if (!Array.isArray(compat[key]) || new Set(compat[key] as string[]).size !== (compat[key] as string[]).length) {
      fail("invalid_entry", `compatibility.${key} must be duplicate-free`);
    }
  }
  if (!isRecord(entry.parameters) || typeof entry.parameters.schemaVersion !== "string") {
    fail("invalid_entry", "parameters must carry schemaVersion/schema/defaults");
  }
  validateParametersForEntry(entry);
  if (!Array.isArray(entry.bindings)) fail("invalid_entry", "bindings must be an array");
  {
    const keys = new Set<string>();
    for (const binding of entry.bindings) {
      if (!isRecord(binding) || typeof binding.key !== "string" || typeof binding.contract !== "string" || typeof binding.required !== "boolean") {
        fail("invalid_entry", "bindings entries need key/contract/required");
      }
      if (keys.has(binding.key)) fail("duplicate_entry", `duplicate binding key ${binding.key}`);
      keys.add(binding.key);
    }
  }
  if (!Array.isArray(entry.assets) || entry.assets.length === 0) fail("invalid_entry", "assets must be a nonempty array");
  {
    const paths = new Set<string>();
    entry.assets.forEach((asset, i) => {
      assertAssetRef(asset, `assets[${i}]`);
      if (paths.has(asset.path)) fail("duplicate_entry", `duplicate asset path ${asset.path}`);
      paths.add(asset.path);
    });
  }
  if (entry.skill !== undefined && entry.mcp !== undefined) fail("invalid_entry", "exactly one of skill/mcp must be present");
  if (entry.kind === "mcp") {
    if (!isRecord(entry.mcp)) fail("invalid_entry", "mcp payload is required for kind mcp");
    validateMcpPayload(entry);
  } else if (entry.skill !== undefined && !isRecord(entry.skill)) {
    fail("invalid_entry", "skill payload must be an object");
  }
  if (entry.requiredExtensions !== undefined) {
    if (!Array.isArray(entry.requiredExtensions)) fail("invalid_entry", "requiredExtensions must be a string array");
    const extensions = isRecord(entry.extensions) ? entry.extensions : {};
    for (const key of entry.requiredExtensions) {
      if (typeof key !== "string") fail("invalid_entry", "requiredExtensions must be a string array");
      if (!Object.hasOwn(extensions, key)) fail("invalid_entry", `required extension ${key} is absent`);
    }
  }
  const digest = digestDescriptor(entry);
  if (options.expectedDigest !== undefined && options.expectedDigest !== digest) {
    fail("integrity_mismatch", "descriptor digest does not match the pinned digest");
  }
  return { entry, digest };
}

const BINDING_REF_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
void BINDING_REF_PATTERN;

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Exact normative parameter bodies: contract §5.4. */
function normativeParameters(id: string): { schemaVersion: string; schema: unknown; defaults: unknown } | null {
  if (id === "sentropic.h2a") {
    return {
      schemaVersion: "1.1.0",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:sentropic:registry:parameters:sentropic.h2a:1.1.0",
        type: "object",
        additionalProperties: false,
        required: ["mode", "serviceBindingRef"],
        properties: {
          mode: { enum: ["shared-central", "hosted-read-only"] },
          serviceBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
        }
      },
      defaults: { mode: "shared-central" }
    };
  }
  if (id === "sentropic.track") {
    return {
      schemaVersion: "1.0.0",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:sentropic:registry:parameters:sentropic.track:1.0.0",
        type: "object",
        additionalProperties: false,
        required: ["access", "repositoryBindingRef"],
        properties: {
          access: { const: "read-only" },
          repositoryBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
        }
      },
      defaults: { access: "read-only" }
    };
  }
  return null;
}

/**
 * Validate user configuration against an entry's parameter profile and apply
 * `defaults` once before validation. Unknown keys, invalid enum values and
 * missing required parameters fail with `invalid_parameters`; no implicit
 * coercion or environment substitution is allowed. Binding references must be
 * ASCII identifiers (`^[a-z0-9][a-z0-9._-]*$`, 1–96 chars).
 */
export function normalizeConfiguration(entry: RegistryEntry, values: unknown): Record<string, unknown> {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    fail("invalid_parameters", `configuration for ${entry.id} must be an object`);
  }
  const normative = normativeParameters(entry.id);
  const input = values as Record<string, unknown>;
  if (normative === null) {
    return { ...(input as Record<string, unknown>) };
  }
  const schema = normative.schema as {
    required: string[];
    properties: Record<string, { const?: unknown; enum?: unknown[]; type?: string; minLength?: number; maxLength?: number; pattern?: string }>;
  };
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(schema.properties, key)) {
      fail("invalid_parameters", `unknown parameter ${JSON.stringify(key)} for ${entry.id}`);
    }
  }
  const normalized: Record<string, unknown> = { ...(normative.defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = value;
  }
  for (const key of schema.required) {
    if (normalized[key] === undefined) fail("invalid_parameters", `missing required parameter ${JSON.stringify(key)} for ${entry.id}`);
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    const value = normalized[key];
    if (value === undefined) continue;
    if (rule.const !== undefined && !deepEqual(value, rule.const)) {
      fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} must be exactly ${JSON.stringify(rule.const)}`);
    }
    if (rule.enum !== undefined && !rule.enum.some((member) => deepEqual(value, member))) {
      fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} is not an admitted value`);
    }
    if (rule.type === "string") {
      if (typeof value !== "string") fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} must be a string`);
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} is too short`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} is too long`);
      }
      if (rule.pattern !== undefined) {
        const pattern = rule.pattern === "^[a-z0-9][a-z0-9._-]*$" ? BINDING_REF_PATTERN : null;
        if (pattern === null || !pattern.test(value)) {
          fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} is not an admitted binding reference`);
        }
        if (/[\s]/.test(value)) fail("invalid_parameters", `parameter ${JSON.stringify(key)} for ${entry.id} must not contain whitespace`);
      }
    }
  }
  return normalized;
}

function validateParametersForEntry(entry: RegistryEntry): void {
  const normative = normativeParameters(entry.id);
  if (normative === null) {
    // Third-party publisher namespace: structural checks only.
    if (!isRecord(entry.parameters.schema) || !isRecord(entry.parameters.defaults)) {
      fail("invalid_parameters", "parameters.schema/defaults must be objects");
    }
    return;
  }
  if (entry.parameters.schemaVersion !== normative.schemaVersion) {
    fail("unsupported_schema_profile", `parameters.schemaVersion must be ${normative.schemaVersion} for ${entry.id}`);
  }
  if (!deepEqual(entry.parameters.schema, normative.schema)) {
    fail("invalid_parameters", `parameters.schema for ${entry.id} differs from the normative §5.4 body`);
  }
  if (!deepEqual(entry.parameters.defaults, normative.defaults)) {
    fail("invalid_parameters", `parameters.defaults for ${entry.id} differ from the normative defaults`);
  }
}

function validateMcpPayload(entry: RegistryEntry): void {
  const mcp = entry.mcp as NonNullable<RegistryEntry["mcp"]>;
  if (typeof mcp.manifestAsset !== "string" || mcp.manifestAsset.length === 0) {
    fail("invalid_entry", "mcp.manifestAsset is required");
  }
  if (!entry.assets.some((asset) => asset.path === mcp.manifestAsset)) {
    fail("invalid_entry", "mcp.manifestAsset must resolve within the asset closure");
  }
  if (!Array.isArray(mcp.connectorIds) || mcp.connectorIds.length === 0 || new Set(mcp.connectorIds).size !== mcp.connectorIds.length) {
    fail("invalid_entry", "mcp.connectorIds must be nonempty and duplicate-free");
  }
  if (!Array.isArray(mcp.protocolVersions) || mcp.protocolVersions.length === 0) {
    fail("invalid_entry", "mcp.protocolVersions must be nonempty: empty universal support is prohibited");
  }
  if (!Array.isArray(mcp.transportProfiles) || mcp.transportProfiles.length === 0) {
    fail("invalid_entry", "mcp.transportProfiles must be nonempty");
  }
  const bindingKeys = new Set(entry.bindings.map((binding) => binding.key));
  const profileIds = new Set<string>();
  for (const profile of mcp.transportProfiles) {
    if (!isRecord(profile) || typeof profile.id !== "string" || typeof profile.mode !== "string") {
      fail("invalid_entry", "transport profiles need id/mode");
    }
    if (profileIds.has(profile.id)) fail("duplicate_entry", `duplicate transport profile ${profile.id}`);
    profileIds.add(profile.id);
    if (!["in-process", "stdio", "streamable-http", "binding"].includes(profile.mode)) {
      fail("invalid_entry", `unknown transport mode ${profile.mode}`);
    }
    if (!Array.isArray(profile.protocolVersions) || profile.protocolVersions.length === 0) {
      fail("invalid_entry", `transport ${profile.id} must declare protocol versions`);
    }
    for (const version of profile.protocolVersions) {
      if (!mcp.protocolVersions.includes(version)) {
        fail("invalid_entry", `transport ${profile.id} protocol ${version} is outside mcp.protocolVersions`);
      }
    }
    if (profile.mode === "binding") {
      if (typeof profile.bindingKey !== "string" || !bindingKeys.has(profile.bindingKey)) {
        fail("missing_binding", `transport ${profile.id} bindingKey must resolve to a declared binding`);
      }
    }
  }
  if (mcp.capabilityProfiles !== undefined) {
    const ids = new Set<string>();
    for (const capability of mcp.capabilityProfiles) {
      if (!isRecord(capability) || typeof capability.id !== "string") fail("invalid_entry", "capability profiles need id");
      if (ids.has(capability.id)) fail("duplicate_entry", `duplicate capability profile ${capability.id}`);
      ids.add(capability.id);
      for (const key of ["tools", "resources", "prompts"] as const) {
        const list = capability[key] as unknown;
        if (!Array.isArray(list) || new Set(list as string[]).size !== (list as string[]).length) {
          fail("invalid_entry", `capability profile ${capability.id}.${key} must be duplicate-free`);
        }
      }
      if (typeof capability.readOnly !== "boolean") fail("invalid_entry", `capability profile ${capability.id}.readOnly must be boolean`);
    }
  }
}

/**
 * Verify every asset digest against exact file bytes supplied by `readFile`.
 * Throws `integrity_mismatch` on any divergence; refuses path escapes even
 * when the reader would serve them.
 */
export function verifyAssetClosure(
  entry: RegistryEntry,
  _packageDir: string,
  readFile: (assetPath: string) => Uint8Array | string
): void {
  for (const asset of entry.assets) {
    if (asset.path.startsWith("/") || asset.path.includes("\\") || asset.path.split("/").includes("..")) {
      fail("invalid_entry", `asset path escapes the package: ${asset.path}`);
    }
    let bytes: Uint8Array | string;
    try {
      bytes = readFile(asset.path);
    } catch {
      fail("integrity_mismatch", `packed asset is missing: ${asset.path}`);
    }
    if (sha256Hex(bytes as Uint8Array) !== asset.sha256) {
      fail("integrity_mismatch", `asset bytes differ from the pinned digest: ${asset.path}`);
    }
  }
}

/** Validate the `./registry/manifest` package wrapper. */
export function validateRegistryPackageManifest(raw: unknown): { entries: RegistryEntry[] } {
  if (!isRecord(raw)) fail("invalid_entry", "package manifest must be an object");
  if (raw["format"] !== REGISTRY_PACKAGE_FORMAT) fail("invalid_entry", `package manifest format must be ${REGISTRY_PACKAGE_FORMAT}`);
  if (!Array.isArray(raw["entries"]) || raw["entries"].length === 0) {
    fail("invalid_entry", "package manifest entries must be a nonempty array");
  }
  const ids = new Set<string>();
  const entries = (raw["entries"] as unknown[]).map((item) => {
    const { entry } = validateRegistryEntry(item);
    const key = `${entry.kind}/${entry.id}`;
    if (ids.has(key)) fail("duplicate_entry", `duplicate package entry ${key}`);
    ids.add(key);
    return entry;
  });
  return { entries };
}
