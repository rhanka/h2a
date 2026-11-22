/**
 * EVO-7 slice 2 — pure, zero-dependency reader for the committed org manifest
 * (`org.h2a.yaml`). h2a carries no runtime dependencies, so rather than pull in
 * a YAML library we parse the small block-YAML subset the manifest needs:
 * block mappings, block sequences (`- `), flow sequences (`[a, b]`), scalars
 * (optionally single/double quoted), `#` comments and blank lines. A document
 * that begins with `{` or `[` is parsed as JSON instead (a manifest may be
 * committed as `org.h2a.json`). Anything outside the subset is rejected with a
 * line-anchored error rather than silently mis-parsed.
 *
 * Parsing is pure (no filesystem): the CLI reads the file and hands the text
 * in. Shape-coercion here only checks the manifest *types*; the h2a invariants
 * (a PRINCIPAL exists, unique instances, canonical roles, …) stay in
 * {@link validateOrgManifest}. Live provisioning is a later CLI slice.
 */

import type {
  H2AOrgCommEdge,
  H2AOrgGeneralCliPolicy,
  H2AOrgInstance,
  H2AOrgManifest,
  H2AOrgMemorialAgentDeclaration,
  H2AOrgPurposeGrantRequest
} from "./org.js";

/** Canonical filename of the committed org manifest. */
export const H2A_ORG_MANIFEST_FILENAME = "org.h2a.yaml";

/** A value produced by the block-YAML subset reader. */
export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

/** Outcome of {@link parseOrgManifest}: a typed manifest, or shape errors. */
export interface H2AOrgParseResult {
  /** Present only when the document parsed AND matched the manifest shape. */
  readonly manifest?: H2AOrgManifest;
  /** Human-readable parse / shape errors (line- or path-anchored). Empty on success. */
  readonly errors: string[];
}

/** Internal: a parse failure carrying a line-anchored message. Never escapes the module. */
class OrgParseError extends Error {}

interface Line {
  readonly indent: number;
  readonly text: string;
  /** 1-based source line number, for error messages. */
  readonly n: number;
}

/** `key:` or `key: value` — the only mapping-entry form the subset accepts. */
const ENTRY_RE = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;

function isEntry(text: string): boolean {
  return ENTRY_RE.test(text);
}

/** Drop a trailing `#` comment that is not inside quotes (and not mid-token). */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split a source string into non-blank, comment-free logical lines with indent. */
function tokenize(source: string): Line[] {
  const out: Line[] = [];
  const raw = source.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const lead = raw[i].slice(0, raw[i].length - raw[i].trimStart().length);
    if (lead.includes("\t")) {
      throw new OrgParseError(`line ${i + 1}: tab indentation is not supported`);
    }
    const stripped = stripComment(raw[i]);
    if (stripped.trim() === "") continue;
    const indent = stripped.length - stripped.trimStart().length;
    out.push({ indent, text: stripped.trim(), n: i + 1 });
  }
  return out;
}

function parseScalar(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** Split a flow-sequence body on top-level commas (ignoring quoted commas). */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (const c of inner) {
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += c;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += c;
    } else if (c === "," && !inSingle && !inDouble) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts;
}

function parseScalarOrFlow(text: string): YamlValue {
  const t = text.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map((s) => parseScalar(s));
  }
  return parseScalar(t);
}

/** Parse the block-YAML subset (or JSON) into a generic value. Throws OrgParseError. */
function parseDocument(source: string): YamlValue {
  const trimmed = source.trim();
  if (trimmed === "") return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as YamlValue;
    } catch (error) {
      throw new OrgParseError(`invalid JSON: ${(error as Error).message}`);
    }
  }

  const lines = tokenize(source);
  if (lines.length === 0) return {};
  let idx = 0;

  function applyEntry(
    map: Record<string, YamlValue>,
    key: string,
    valueText: string | undefined,
    ownerIndent: number
  ): void {
    if (valueText !== undefined && valueText !== "") {
      map[key] = parseScalarOrFlow(valueText);
    } else if (idx < lines.length && lines[idx].indent > ownerIndent) {
      map[key] = parseNode(lines[idx].indent);
    } else {
      map[key] = "";
    }
  }

  function parseMap(
    indent: number,
    seed: { key: string; valueText: string | undefined } | undefined
  ): YamlValue {
    const map: Record<string, YamlValue> = {};
    if (seed) applyEntry(map, seed.key, seed.valueText, indent);
    while (idx < lines.length && lines[idx].indent === indent && isEntry(lines[idx].text)) {
      const m = ENTRY_RE.exec(lines[idx].text);
      idx++;
      if (m) applyEntry(map, m[1], m[2], indent);
    }
    return map;
  }

  function parseSeq(indent: number): YamlValue {
    const arr: YamlValue[] = [];
    while (
      idx < lines.length &&
      lines[idx].indent === indent &&
      (lines[idx].text === "-" || lines[idx].text.startsWith("- "))
    ) {
      const line = lines[idx];
      const after = line.text === "-" ? "" : line.text.slice(2).trim();
      idx++;
      if (after === "") {
        if (idx < lines.length && lines[idx].indent > indent) arr.push(parseNode(lines[idx].indent));
        else arr.push("");
      } else if (isEntry(after)) {
        const m = ENTRY_RE.exec(after);
        arr.push(m ? parseMap(indent + 2, { key: m[1], valueText: m[2] }) : after);
      } else {
        arr.push(parseScalarOrFlow(after));
      }
    }
    return arr;
  }

  function parseNode(indent: number): YamlValue {
    const first = lines[idx];
    if (first.text === "-" || first.text.startsWith("- ")) return parseSeq(indent);
    if (isEntry(first.text)) return parseMap(indent, undefined);
    throw new OrgParseError(`line ${first.n}: expected a mapping or a sequence`);
  }

  const value = parseNode(lines[0].indent);
  if (idx < lines.length) {
    throw new OrgParseError(`line ${lines[idx].n}: unexpected indentation`);
  }
  return value;
}

function isRecord(v: YamlValue): v is Record<string, YamlValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Coerce an optional non-empty scalar: present means it must be a non-empty
 * string (an empty value is a shape error, not a silent absence).
 */
function coerceNonEmptyScalar(
  v: YamlValue | undefined,
  path: string,
  errors: string[]
): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v === "") {
    errors.push(`${path}: a non-empty string is required`);
    return undefined;
  }
  return v;
}

/**
 * Coerce a boolean field: the block-YAML subset yields only strings, so the
 * canonical `true`/`false` scalars are coerced; a JSON document may carry a
 * real boolean. Anything else is a shape error.
 */
function coerceBoolean(
  v: YamlValue | undefined,
  path: string,
  errors: string[]
): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  errors.push(`${path}: expected a boolean`);
  return undefined;
}

/**
 * Coerce a memorial-agent declaration block (H2A-ORG-H1, co-signed spec §2.1):
 * launch name, agentUuid enrolment reference, H1 policy references, requested
 * memory scopes, purpose grants with the explicit sub-agent opt-in, the L1
 * CLI/model/effort ceiling and the declaring owner. Type checks only; the org
 * invariants stay in {@link validateOrgManifest}.
 */
function coerceMemorialAgent(
  v: YamlValue | undefined,
  path: string,
  errors: string[]
): H2AOrgMemorialAgentDeclaration | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) {
    errors.push(`${path}: expected a mapping`);
    return undefined;
  }
  let bad = false;
  const fail = (message: string): void => {
    errors.push(`${path}.${message}`);
    bad = true;
  };
  // launchName is the one field whose absence is a shape error here (the
  // remaining required fields of spec §2.1 surface through it too)
  if (v.launchName === undefined) {
    errors.push(`${path}.launchName: a non-empty string is required`);
    bad = true;
  }
  const launchName = coerceNonEmptyScalar(v.launchName, `${path}.launchName`, errors);
  const agentUuidRef = coerceNonEmptyScalar(v.agentUuidRef, `${path}.agentUuidRef`, errors);
  if (agentUuidRef === undefined) bad = true;
  const declaringOwner = coerceNonEmptyScalar(v.declaringOwner, `${path}.declaringOwner`, errors);
  if (declaringOwner === undefined) bad = true;
  const effortCeiling = coerceNonEmptyScalar(v.effortCeiling, `${path}.effortCeiling`, errors);
  const policyRefs = coerceStringList(v.policyRefs, `${path}.policyRefs`, errors);
  if (policyRefs === undefined || policyRefs.length === 0) bad = true;
  const memoryScopes = coerceStringList(v.memoryScopes, `${path}.memoryScopes`, errors) ?? [];
  const allowedCliKinds = coerceStringList(v.allowedCliKinds, `${path}.allowedCliKinds`, errors);
  if (allowedCliKinds === undefined || allowedCliKinds.length === 0) bad = true;
  const allowedModels = coerceStringList(v.allowedModels, `${path}.allowedModels`, errors);
  if (allowedModels === undefined || allowedModels.length === 0) bad = true;
  const purposeGrants: H2AOrgPurposeGrantRequest[] = [];
  if (v.purposeGrants !== undefined) {
    if (!Array.isArray(v.purposeGrants)) {
      fail(`purposeGrants: expected a sequence`);
    } else {
      v.purposeGrants.forEach((raw, i) => {
        if (!isRecord(raw)) {
          errors.push(`${path}.purposeGrants[${i}]: expected a mapping`);
          bad = true;
          return;
        }
        const grantPath = `${path}.purposeGrants[${i}]`;
        const scopeKind = coerceNonEmptyScalar(raw.scopeKind, `${grantPath}.scopeKind`, errors);
        const purposeRef = coerceNonEmptyScalar(raw.purposeRef, `${grantPath}.purposeRef`, errors);
        const allowSubagentExec = coerceBoolean(
          raw.allowSubagentExec,
          `${grantPath}.allowSubagentExec`,
          errors
        );
        if (scopeKind === undefined || purposeRef === undefined) {
          bad = true;
          return;
        }
        purposeGrants.push({
          scopeKind: scopeKind as H2AOrgPurposeGrantRequest["scopeKind"],
          purposeRef,
          ...(allowSubagentExec !== undefined ? { allowSubagentExec } : {})
        });
      });
    }
  } else {
    bad = true;
  }
  if (bad || launchName === undefined) return undefined;
  return {
    launchName,
    agentUuidRef: agentUuidRef!,
    policyRefs: policyRefs!,
    memoryScopes: memoryScopes as H2AOrgMemorialAgentDeclaration["memoryScopes"],
    purposeGrants,
    allowedCliKinds: allowedCliKinds!,
    allowedModels: allowedModels!,
    ...(effortCeiling !== undefined ? { effortCeiling } : {}),
    declaringOwner: declaringOwner!
  };
}

/**
 * Coerce the manifest-level general CLI pass-through policy (Q-D, spec §2.1).
 * `allowMemory` is required — the frozen `false` posture is the point of the
 * block; a memory grant is refused by {@link validateOrgManifest}, never
 * parsed away.
 */
function coerceGeneralCliPolicy(
  v: YamlValue | undefined,
  path: string,
  errors: string[]
): H2AOrgGeneralCliPolicy | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) {
    errors.push(`${path}: expected a mapping`);
    return undefined;
  }
  let bad = false;
  const generalPolicyRef = coerceNonEmptyScalar(v.generalPolicyRef, `${path}.generalPolicyRef`, errors);
  if (generalPolicyRef === undefined) bad = true;
  const allowedCliKinds = coerceStringList(v.allowedCliKinds, `${path}.allowedCliKinds`, errors);
  if (allowedCliKinds === undefined || allowedCliKinds.length === 0) bad = true;
  const allowedModels = coerceStringList(v.allowedModels, `${path}.allowedModels`, errors);
  if (allowedModels === undefined) bad = true;
  const allowedTools = coerceStringList(v.allowedTools, `${path}.allowedTools`, errors);
  if (allowedTools === undefined) bad = true;
  const effortCeiling = coerceNonEmptyScalar(v.effortCeiling, `${path}.effortCeiling`, errors);
  const allowMemory = coerceBoolean(v.allowMemory, `${path}.allowMemory`, errors);
  if (allowMemory === undefined) bad = true;
  if (bad || generalPolicyRef === undefined) return undefined;
  return {
    generalPolicyRef,
    allowedCliKinds: allowedCliKinds!,
    allowedModels: allowedModels!,
    ...(effortCeiling !== undefined ? { effortCeiling } : {}),
    allowedTools: allowedTools!,
    allowMemory: allowMemory as boolean
  };
}

/** Coerce a `scopes`/`mandateRights`-style field into a string list (a bare scalar → one-element). */
function coerceStringList(
  v: YamlValue | undefined,
  path: string,
  errors: string[]
): string[] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return v === "" ? [] : [v];
  if (Array.isArray(v)) {
    const out: string[] = [];
    v.forEach((el, i) => {
      if (typeof el === "string") out.push(el);
      else errors.push(`${path}[${i}]: expected a string`);
    });
    return out;
  }
  errors.push(`${path}: expected a sequence of strings`);
  return undefined;
}

function coerceManifest(value: YamlValue): H2AOrgParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { errors: ["document: expected a mapping at the top level"] };
  }

  const scope = value.scope;
  if (typeof scope !== "string" || scope === "") {
    errors.push("scope: a non-empty string is required");
  }

  let version: string | undefined;
  if (value.version !== undefined) {
    if (typeof value.version === "string") version = value.version;
    else errors.push("version: expected a string");
  }

  const instances: H2AOrgInstance[] = [];
  if (!Array.isArray(value.instances)) {
    errors.push("instances: expected a sequence");
  } else {
    value.instances.forEach((raw, i) => {
      if (!isRecord(raw)) {
        errors.push(`instances[${i}]: expected a mapping`);
        return;
      }
      const id = raw.instance;
      const role = raw.role;
      if (typeof id !== "string") errors.push(`instances[${i}].instance: expected a string`);
      if (typeof role !== "string") errors.push(`instances[${i}].role: expected a string`);
      const scopes = coerceStringList(raw.scopes, `instances[${i}].scopes`, errors) ?? [];
      const rights = coerceStringList(raw.mandateRights, `instances[${i}].mandateRights`, errors);
      const memorialAgent = coerceMemorialAgent(
        raw.memorialAgent,
        `instances[${i}].memorialAgent`,
        errors
      );
      if (typeof id === "string" && typeof role === "string") {
        instances.push({
          instance: id,
          role: role as H2AOrgInstance["role"],
          scopes,
          ...(rights ? { mandateRights: rights } : {}),
          ...(memorialAgent !== undefined ? { memorialAgent } : {})
        });
      }
    });
  }

  let commEdges: H2AOrgCommEdge[] | undefined;
  if (value.commEdges !== undefined) {
    if (!Array.isArray(value.commEdges)) {
      errors.push("commEdges: expected a sequence");
    } else {
      commEdges = [];
      value.commEdges.forEach((raw, i) => {
        if (!isRecord(raw)) {
          errors.push(`commEdges[${i}]: expected a mapping`);
          return;
        }
        const from = raw.from;
        const to = raw.to;
        if (typeof from !== "string") errors.push(`commEdges[${i}].from: expected a string`);
        if (typeof to !== "string") errors.push(`commEdges[${i}].to: expected a string`);
        if (typeof from === "string" && typeof to === "string") commEdges!.push({ from, to });
      });
    }
  }

  const generalCliPolicy = coerceGeneralCliPolicy(
    value.generalCliPolicy,
    "generalCliPolicy",
    errors
  );

  if (errors.length > 0) return { errors };

  const manifest: H2AOrgManifest = {
    scope: scope as string,
    ...(version !== undefined ? { version } : {}),
    instances,
    ...(commEdges !== undefined ? { commEdges } : {}),
    ...(generalCliPolicy !== undefined ? { generalCliPolicy } : {})
  };
  return { manifest, errors: [] };
}

/**
 * Parse a committed org manifest (`org.h2a.yaml` block-YAML subset, or JSON)
 * into a typed {@link H2AOrgManifest}. Total — never throws: a malformed
 * document or a shape mismatch yields `{ errors }` with no `manifest`. Run the
 * returned manifest through {@link validateOrgManifest} for the h2a invariants.
 */
export function parseOrgManifest(source: string): H2AOrgParseResult {
  let value: YamlValue;
  try {
    value = parseDocument(source);
  } catch (error) {
    return { errors: [(error as Error).message] };
  }
  return coerceManifest(value);
}
