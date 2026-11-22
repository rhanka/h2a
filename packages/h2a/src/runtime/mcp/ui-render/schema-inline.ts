/**
 * Self-contained JSON Schema 2020-12 bundler for MCP tool descriptors.
 *
 * Vendored DS standalone schemas (`schemas/<Component>.v1.json`) reference
 * `https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/ComponentCommon`,
 * which in turn references `catalog.json#/$defs/anyFunction` and mutually
 * recursive local definitions (`FunctionCall` <-> `DynamicValue`).
 *
 * MCP hosts such as `agy` compile exported tool parameter schemas with an
 * offline JSON Schema loader that rejects remote URL `$ref`s (`invalid file url`).
 * This module resolves every external `$ref` against the vendored A2UI schema
 * documents and bundles the reachable transitive definitions into local
 * `#/$defs/<name>` entries so exported schemas are 100% self-contained and
 * semantically identical to the original multi-document schema graph.
 */

import { a2uiCommonTypes, a2uiSdkCatalogSchema } from "./a2ui-common-types.js";

/** One non-local `$ref` occurrence discovered in a schema. */
export interface NonLocalSchemaRef {
  /** RFC 6901 JSON Pointer to the schema object holding the `$ref`. */
  readonly path: string;
  /** The non-local `$ref` value. */
  readonly ref: string;
}

/** One back-edge `$ref` cycle discovered by tri-color DFS in a schema. */
export interface SchemaRefCycle {
  /** RFC 6901 JSON Pointer to the schema node carrying the cyclic `$ref`. */
  readonly from: string;
  /** The local `$ref` value pointing to an active (gray) ancestor. */
  readonly ref: string;
}

/** Default external schema documents registered for ui-render bundling. */
export const DEFAULT_EXTERNAL_UI_SCHEMAS: readonly Record<string, unknown>[] = [
  a2uiCommonTypes,
  a2uiSdkCatalogSchema
];

/** Keywords whose value is a single subschema (or boolean schema). */
const SINGLE_SUBSCHEMA_KEYWORDS = new Set<string>([
  "not",
  "if",
  "then",
  "else",
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "contentSchema"
]);

/** Keywords whose value is an array of subschemas. */
const ARRAY_SUBSCHEMA_KEYWORDS = new Set<string>([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems"
]);

/** Keywords whose value is a dictionary mapping arbitrary keys to subschemas. */
const MAP_SUBSCHEMA_KEYWORDS = new Set<string>([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripFragment(uri: string): string {
  const hashIndex = uri.indexOf("#");
  return hashIndex === -1 ? uri : uri.slice(0, hashIndex);
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointerToken(token: string): string {
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    // Keep raw token if percent-encoding is malformed; RFC 6901 unescaping still runs.
  }
  return decoded.replace(/~1/g, "/").replace(/~0/g, "~");
}

function tryResolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return undefined;
  const tokens = pointer.slice(1).split("/").map(unescapePointerToken);
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function resolveJsonPointer(document: unknown, pointer: string, label: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new Error(`Unsupported non-JSON-Pointer fragment "#${pointer}" in ${label}`);
  }
  const resolved = tryResolveJsonPointer(document, pointer);
  if (resolved === undefined) {
    throw new Error(`JSON Pointer "#${pointer}" not found in ${label}`);
  }
  return resolved;
}

function preferredDefName(pointer: string, docUri: string): string {
  if (pointer.length > 0) {
    const tokens = pointer.slice(1).split("/").map(unescapePointerToken);
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.length > 0) return last;
  }
  const tail = docUri.split("/").pop() ?? "external";
  const stem = tail.replace(/\.json$/i, "");
  return stem.length > 0 ? stem : "external";
}

function sortRecordKeys(record: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * Finds every `$ref` in schema position whose target is not a local fragment
 * (`#...`). Property names literally called `"$ref"` or data literals inside
 * `const`/`enum`/`default`/`examples`/`x-sentropic` are not flagged.
 */
export function findNonLocalSchemaRefs(schema: unknown): NonLocalSchemaRef[] {
  const found: NonLocalSchemaRef[] = [];

  function walk(node: unknown, path: string): void {
    if (!isPlainObject(node)) return;

    const ref = node["$ref"];
    if (typeof ref === "string" && !ref.startsWith("#")) {
      found.push({ path, ref });
    }

    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}/${escapePointerToken(key)}`;
      if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) walk(value, childPath);
      } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) {
            walk(value[index], `${childPath}/${index}`);
          }
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          for (const [entryKey, entryValue] of Object.entries(value)) {
            walk(entryValue, `${childPath}/${escapePointerToken(entryKey)}`);
          }
        }
      } else if (key === "dependencies" && isPlainObject(value)) {
        for (const [entryKey, entryValue] of Object.entries(value)) {
          if (isPlainObject(entryValue)) {
            walk(entryValue, `${childPath}/${escapePointerToken(entryKey)}`);
          }
        }
      }
    }
  }

  walk(schema, "");
  return found;
}

/**
 * Detects local `$ref` cycles via a single shared tri-color DFS per schema.
 *
 * Traversal order is canonical: root `""` first (skipping top-level `$defs`
 * and `definitions` during the root walk), then each lexicographically sorted
 * key under `/$defs/<k>` and `/definitions/<k>` not yet marked `"black"`.
 * Data literals (`const`, `enum`, `default`, `examples`, `x-sentropic`) and
 * properties literally named `"$ref"` are ignored. Returned back-edges are
 * deduplicated by `${from}->${ref}` in discovery order.
 */
export function findSchemaRefCycles(schema: unknown): SchemaRefCycle[] {
  if (!isPlainObject(schema)) return [];

  const state = new Map<string, "gray" | "black">();
  const cycles: SchemaRefCycle[] = [];
  const seen = new Set<string>();

  function visit(node: unknown, ptr: string, skipTopLevelDefs: boolean): void {
    if (!isPlainObject(node)) return;
    if (state.has(ptr)) return;

    state.set(ptr, "gray");

    const ref = node["$ref"];
    if (typeof ref === "string" && ref.startsWith("#")) {
      const targetPtr = ref.slice(1);
      if (state.get(targetPtr) === "gray") {
        const edgeKey = `${ptr}->${ref}`;
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey);
          cycles.push({ from: ptr, ref });
        }
      } else if (state.get(targetPtr) !== "black") {
        const targetNode = tryResolveJsonPointer(schema, targetPtr);
        if (isPlainObject(targetNode)) {
          visit(targetNode, targetPtr, targetPtr === "");
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (skipTopLevelDefs && (key === "$defs" || key === "definitions")) continue;
      const childPath = `${ptr}/${escapePointerToken(key)}`;
      if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) visit(value, childPath, false);
      } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) {
            visit(value[index], `${childPath}/${index}`, false);
          }
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          for (const [entryKey, entryValue] of Object.entries(value)) {
            visit(entryValue, `${childPath}/${escapePointerToken(entryKey)}`, false);
          }
        }
      } else if (key === "dependencies" && isPlainObject(value)) {
        for (const [entryKey, entryValue] of Object.entries(value)) {
          if (isPlainObject(entryValue)) {
            visit(entryValue, `${childPath}/${escapePointerToken(entryKey)}`, false);
          }
        }
      }
    }

    state.set(ptr, "black");
  }

  visit(schema, "", true);

  for (const container of ["$defs", "definitions"] as const) {
    const defs = schema[container];
    if (!isPlainObject(defs)) continue;
    for (const key of Object.keys(defs).sort()) {
      const ptr = `/${container}/${escapePointerToken(key)}`;
      if (state.get(ptr) !== "black") {
        visit(defs[key], ptr, false);
      }
    }
  }

  return cycles;
}

const MAX_CYCLE_DEPTH = 2;

function containsAnySchemaRef(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (typeof node["$ref"] === "string") return true;
  for (const [key, value] of Object.entries(node)) {
    if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
      if (containsAnySchemaRef(value)) return true;
    } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
      if (Array.isArray(value) && value.some((item) => containsAnySchemaRef(item))) return true;
    } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
      if (isPlainObject(value) && Object.values(value).some((entry) => containsAnySchemaRef(entry))) {
        return true;
      }
    } else if (key === "dependencies" && isPlainObject(value)) {
      if (
        Object.values(value).some((entry) => isPlainObject(entry) && containsAnySchemaRef(entry))
      ) {
        return true;
      }
    }
  }
  return false;
}

function extractLocalDefName(ref: string): { readonly name: string; readonly subPointer: string } | undefined {
  if (!ref.startsWith("#/$defs/")) return undefined;
  const suffix = ref.slice("#/$defs/".length);
  const slashIdx = suffix.indexOf("/");
  const name = unescapePointerToken(slashIdx === -1 ? suffix : suffix.slice(0, slashIdx));
  const subPointer = slashIdx === -1 ? "" : suffix.slice(slashIdx);
  return { name, subPointer };
}

function isAlwaysFalseSchema(node: unknown, alwaysFalseDefs: ReadonlySet<string>): boolean {
  if (node === false) return true;
  if (!isPlainObject(node)) return false;

  if (node["not"] === true || (isPlainObject(node["not"]) && Object.keys(node["not"]).length === 0)) {
    return true;
  }

  if (typeof node["$ref"] === "string") {
    const parsed = extractLocalDefName(node["$ref"]);
    if (parsed !== undefined && parsed.subPointer === "" && alwaysFalseDefs.has(parsed.name)) {
      return true;
    }
  }

  if (Array.isArray(node["allOf"]) && node["allOf"].some((branch) => isAlwaysFalseSchema(branch, alwaysFalseDefs))) {
    return true;
  }

  if (Array.isArray(node["oneOf"])) {
    if (
      node["oneOf"].length === 0 ||
      node["oneOf"].every((branch) => isAlwaysFalseSchema(branch, alwaysFalseDefs))
    ) {
      return true;
    }
  }

  if (Array.isArray(node["anyOf"])) {
    if (
      node["anyOf"].length === 0 ||
      node["anyOf"].every((branch) => isAlwaysFalseSchema(branch, alwaysFalseDefs))
    ) {
      return true;
    }
  }

  return false;
}

function computeAlwaysFalseDefs(defs: Record<string, unknown>): Set<string> {
  const alwaysFalse = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, defSchema] of Object.entries(defs)) {
      if (alwaysFalse.has(name)) continue;
      if (isAlwaysFalseSchema(defSchema, alwaysFalse)) {
        alwaysFalse.add(name);
        changed = true;
      }
    }
  }
  return alwaysFalse;
}

function pruneAlwaysFalseObjectRefProperties(
  defs: Record<string, unknown>,
  alwaysFalseDefs: ReadonlySet<string>
): void {
  for (const name of alwaysFalseDefs) {
    const defSchema = defs[name];
    if (!isPlainObject(defSchema) || defSchema["type"] !== "object") continue;
    const properties = defSchema["properties"];
    if (!isPlainObject(properties)) continue;
    for (const propName of Object.keys(properties)) {
      if (containsAnySchemaRef(properties[propName])) {
        properties[propName] = { type: "object" };
      }
    }
  }
}

function nonRecursiveTypeSkeleton(target: unknown): Record<string, unknown> {
  if (!isPlainObject(target)) return {};
  const nodeType = target["type"];
  if (typeof nodeType === "string") {
    return nodeType === "array" ? { type: "array", items: {} } : { type: nodeType };
  }
  if (Array.isArray(nodeType) && nodeType.every((t) => typeof t === "string")) {
    return nodeType.includes("array")
      ? { type: [...nodeType], items: {} }
      : { type: [...nodeType] };
  }
  if (isPlainObject(target["properties"]) || Array.isArray(target["required"])) {
    return { type: "object" };
  }
  if (target["items"] !== undefined || target["prefixItems"] !== undefined) {
    return { type: "array", items: {} };
  }
  return {};
}

function collectDirectDefRefs(node: unknown, skipTopLevelDefs: boolean): Set<string> {
  const refs = new Set<string>();
  function walk(cur: unknown, skipDefs: boolean): void {
    if (!isPlainObject(cur)) return;
    if (typeof cur["$ref"] === "string") {
      const parsed = extractLocalDefName(cur["$ref"]);
      if (parsed !== undefined) refs.add(parsed.name);
    }
    for (const [key, value] of Object.entries(cur)) {
      if (skipDefs && (key === "$defs" || key === "definitions")) continue;
      if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
        walk(value, false);
      } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
        if (Array.isArray(value)) {
          for (const item of value) walk(item, false);
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          for (const entryValue of Object.values(value)) walk(entryValue, false);
        }
      } else if (key === "dependencies" && isPlainObject(value)) {
        for (const entryValue of Object.values(value)) {
          if (isPlainObject(entryValue)) walk(entryValue, false);
        }
      }
    }
  }
  walk(node, skipTopLevelDefs);
  return refs;
}

function computeDefReachability(defs: Record<string, unknown>): Map<string, Set<string>> {
  const direct = new Map<string, Set<string>>();
  for (const [name, defSchema] of Object.entries(defs)) {
    direct.set(name, collectDirectDefRefs(defSchema, false));
  }
  const reachable = new Map<string, Set<string>>();
  for (const name of Object.keys(defs)) {
    const visited = new Set<string>();
    const queue = [...(direct.get(name) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      const children = direct.get(next);
      if (children !== undefined) {
        for (const child of children) {
          if (!visited.has(child)) queue.push(child);
        }
      }
    }
    reachable.set(name, visited);
  }
  return reachable;
}

function unfoldRemainingCycles(
  rootClone: Record<string, unknown>,
  rootDefs: Record<string, unknown>,
  maxCycleDepth = MAX_CYCLE_DEPTH
): Record<string, unknown> {
  const rawDefs = structuredClone(rootDefs);
  const reachableFromDef = computeDefReachability(rawDefs);
  const newDefs: Record<string, unknown> = {};
  const usedDefNames = new Set<string>(Object.keys(rawDefs));
  const memoKeyBySpec = new Map<string, string>();

  function contextSignature(targetDef: string, activeDepth: ReadonlyMap<string, number>): string {
    const reachable = reachableFromDef.get(targetDef);
    const relevant: string[] = [];
    for (const [key, depth] of activeDepth.entries()) {
      if (key === targetDef || (reachable !== undefined && reachable.has(key))) {
        relevant.push(`${key}=${depth}`);
      }
    }
    relevant.sort();
    return relevant.join(",");
  }

  function allocateUnfoldedName(targetDef: string, depth: number, preferOriginal: boolean): string {
    if (preferOriginal && !Object.prototype.hasOwnProperty.call(newDefs, targetDef)) {
      return targetDef;
    }
    const base = depth >= 1 ? `${targetDef}__d${depth}` : targetDef;
    if (!usedDefNames.has(base) && !Object.prototype.hasOwnProperty.call(newDefs, base)) {
      usedDefNames.add(base);
      return base;
    }
    let suffix = 1;
    while (
      usedDefNames.has(`${base}__${suffix}`) ||
      Object.prototype.hasOwnProperty.call(newDefs, `${base}__${suffix}`)
    ) {
      suffix += 1;
    }
    const candidate = `${base}__${suffix}`;
    usedDefNames.add(candidate);
    return candidate;
  }

  function ensureUnfoldedDef(
    targetDef: string,
    depth: number,
    activeDepth: ReadonlyMap<string, number>
  ): string {
    const sig = contextSignature(targetDef, activeDepth);
    const memoKey = `${targetDef}@${depth}|${sig}`;
    const existing = memoKeyBySpec.get(memoKey);
    if (existing !== undefined) return existing;

    const allocated = allocateUnfoldedName(targetDef, depth, depth === 0 && sig === "");
    memoKeyBySpec.set(memoKey, allocated);

    const nextActive = new Map(activeDepth);
    nextActive.set(targetDef, depth);
    newDefs[allocated] = unfoldNode(structuredClone(rawDefs[targetDef]), nextActive, false);
    return allocated;
  }

  function unfoldChildren(
    node: Record<string, unknown>,
    activeDepth: ReadonlyMap<string, number>,
    skipTopLevelDefs: boolean
  ): Record<string, unknown> {
    for (const [key, value] of Object.entries(node)) {
      if (skipTopLevelDefs && (key === "$defs" || key === "definitions")) continue;
      if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          node[key] = unfoldNode(value, activeDepth, false);
        }
      } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
        if (Array.isArray(value)) {
          node[key] = value.map((item) =>
            isPlainObject(item) ? unfoldNode(item, activeDepth, false) : item
          );
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          for (const entryKey of Object.keys(value)) {
            const entryValue = value[entryKey];
            if (isPlainObject(entryValue)) {
              value[entryKey] = unfoldNode(entryValue, activeDepth, false);
            }
          }
        }
      } else if (key === "dependencies" && isPlainObject(value)) {
        for (const entryKey of Object.keys(value)) {
          const entryValue = value[entryKey];
          if (isPlainObject(entryValue)) {
            value[entryKey] = unfoldNode(entryValue, activeDepth, false);
          }
        }
      }
    }
    return node;
  }

  function unfoldNode(
    node: unknown,
    activeDepth: ReadonlyMap<string, number>,
    skipTopLevelDefs: boolean
  ): unknown {
    if (!isPlainObject(node)) return node;

    const ref = node["$ref"];
    if (typeof ref === "string" && ref.startsWith("#")) {
      if (ref === "#") {
        const skeleton = nonRecursiveTypeSkeleton(rootClone);
        const { $ref: _dropped, ...rest } = node;
        return { ...skeleton, ...unfoldChildren(rest, activeDepth, false) };
      }
      const parsed = extractLocalDefName(ref);
      if (parsed !== undefined && Object.prototype.hasOwnProperty.call(rawDefs, parsed.name)) {
        const existingDepth = activeDepth.get(parsed.name);
        if (existingDepth !== undefined) {
          const nextDepth = existingDepth + 1;
          if (nextDepth > maxCycleDepth) {
            const targetObj =
              parsed.subPointer === ""
                ? rawDefs[parsed.name]
                : tryResolveJsonPointer(rawDefs[parsed.name], parsed.subPointer);
            const skeleton = nonRecursiveTypeSkeleton(targetObj);
            const { $ref: _dropped, ...rest } = node;
            return { ...skeleton, ...unfoldChildren(rest, activeDepth, false) };
          }
          const unfoldedName = ensureUnfoldedDef(parsed.name, nextDepth, activeDepth);
          node["$ref"] = `#/$defs/${escapePointerToken(unfoldedName)}${parsed.subPointer}`;
        } else {
          const unfoldedName = ensureUnfoldedDef(parsed.name, 0, activeDepth);
          node["$ref"] = `#/$defs/${escapePointerToken(unfoldedName)}${parsed.subPointer}`;
        }
      }
    }

    return unfoldChildren(node, activeDepth, skipTopLevelDefs);
  }

  unfoldNode(rootClone, new Map<string, number>(), true);
  return newDefs;
}

function purgeUnreachableDefs(
  rootClone: Record<string, unknown>,
  defs: Record<string, unknown>
): Record<string, unknown> {
  const reachable = new Set<string>();
  const queue = [...collectDirectDefRefs(rootClone, true)];
  while (queue.length > 0) {
    const defName = queue.shift()!;
    if (reachable.has(defName)) continue;
    if (!Object.prototype.hasOwnProperty.call(defs, defName)) continue;
    reachable.add(defName);
    for (const next of collectDirectDefRefs(defs[defName], false)) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(defs)) {
    if (reachable.has(key)) {
      kept[key] = defs[key];
    }
  }
  return kept;
}

/**
 * Returns a deep-cloned, self-contained copy of `schema` with every external
 * `$ref` (and its transitive closure, including relative sibling refs)
 * bundled into cycle-free local `#/$defs/<name>` entries.
 *
 * Dead-branch `$ref` properties under always-false object definitions
 * (such as A2UI `FunctionCall.properties.args`) are simplified to
 * `{ "type": "object" }`, any remaining live `$ref` cycle is unfolded up to
 * `maxCycleDepth = 2`, unreachable `$defs` entries are purged, and imported
 * bare `type: "array"` subschemas receive `items: {}`.
 *
 * Neither `schema` nor any document in `externalSchemas` is mutated.
 */
export function inlineExternalSchemaRefs(
  schema: Record<string, unknown>,
  externalSchemas: readonly Record<string, unknown>[] = DEFAULT_EXTERNAL_UI_SCHEMAS
): Record<string, unknown> {
  const docByUri = new Map<string, Record<string, unknown>>();
  for (const doc of externalSchemas) {
    const id = doc["$id"];
    if (typeof id === "string" && id.length > 0) {
      docByUri.set(stripFragment(id), doc);
    }
  }

  const rootClone = structuredClone(schema);
  const rawRootId = rootClone["$id"];
  const rootBaseUri =
    typeof rawRootId === "string" && rawRootId.length > 0
      ? stripFragment(rawRootId)
      : "urn:local:root";

  const hadDefs = isPlainObject(rootClone["$defs"]);
  let rootDefs: Record<string, unknown> = hadDefs
    ? (rootClone["$defs"] as Record<string, unknown>)
    : {};
  const reservedDefNames = new Set<string>(Object.keys(rootDefs));
  const localKeyByTarget = new Map<string, string>();
  let importedAny = false;

  function allocateDefName(pointer: string, docUri: string): string {
    const base = preferredDefName(pointer, docUri);
    if (!reservedDefNames.has(base)) {
      reservedDefNames.add(base);
      return base;
    }
    let suffix = 1;
    while (reservedDefNames.has(`${base}__${suffix}`)) {
      suffix += 1;
    }
    const candidate = `${base}__${suffix}`;
    reservedDefNames.add(candidate);
    return candidate;
  }

  function ensureImported(targetDocUri: string, targetPointer: string): string {
    const cacheKey = `${targetDocUri}#${targetPointer}`;
    const existing = localKeyByTarget.get(cacheKey);
    if (existing !== undefined) return existing;

    const targetDoc = docByUri.get(targetDocUri);
    if (targetDoc === undefined) {
      throw new Error(
        `Cannot inline external schema $ref "${cacheKey}": schema document "${targetDocUri}" is not registered`
      );
    }

    const rawTarget = resolveJsonPointer(targetDoc, targetPointer, targetDocUri);
    const localKey = allocateDefName(targetPointer, targetDocUri);
    // Register BEFORE recursing so mutually recursive definitions terminate cleanly.
    localKeyByTarget.set(cacheKey, localKey);
    importedAny = true;

    const clonedTarget = structuredClone(rawTarget);
    const rewritten = rewriteSchema(clonedTarget, targetDocUri, false, false);
    if (targetPointer === "" && isPlainObject(rewritten)) {
      delete rewritten["$id"];
      delete rewritten["$schema"];
    }
    rootDefs[localKey] = rewritten;
    return localKey;
  }

  function rewriteRef(ref: string, currentBaseUri: string, isRootDoc: boolean): string {
    if (ref.startsWith("#")) {
      if (isRootDoc) return ref;
      const localKey = ensureImported(currentBaseUri, ref.slice(1));
      return `#/$defs/${escapePointerToken(localKey)}`;
    }

    let resolved: URL;
    try {
      resolved = new URL(ref, currentBaseUri);
    } catch {
      throw new Error(
        `Cannot resolve external schema $ref "${ref}" against base URI "${currentBaseUri}"`
      );
    }

    const targetDocUri = stripFragment(resolved.href);
    const targetPointer = resolved.hash.startsWith("#") ? resolved.hash.slice(1) : "";

    if (targetDocUri === rootBaseUri) {
      return `#${targetPointer}`;
    }

    const localKey = ensureImported(targetDocUri, targetPointer);
    return `#/$defs/${escapePointerToken(localKey)}`;
  }

  function rewriteSchema(
    node: unknown,
    currentBaseUri: string,
    isRootDoc: boolean,
    isDocumentRoot: boolean
  ): unknown {
    if (!isPlainObject(node)) return node;

    let effectiveBaseUri = currentBaseUri;
    let effectiveIsRoot = isRootDoc;
    if (!isDocumentRoot && typeof node["$id"] === "string" && node["$id"].length > 0) {
      try {
        effectiveBaseUri = stripFragment(new URL(node["$id"], currentBaseUri).href);
        effectiveIsRoot = effectiveBaseUri === rootBaseUri;
      } catch {
        // Keep parent base URI if embedded $id is not a resolvable URI.
      }
    }

    if (typeof node["$ref"] === "string") {
      node["$ref"] = rewriteRef(node["$ref"], effectiveBaseUri, effectiveIsRoot);
    }

    // Step 5: normalize bare arrays on imported subschemas (`type: "array"` without items/prefixItems).
    if (!effectiveIsRoot) {
      const nodeType = node["type"];
      const isArrayType =
        nodeType === "array" || (Array.isArray(nodeType) && nodeType.includes("array"));
      if (isArrayType && node["items"] === undefined && node["prefixItems"] === undefined) {
        node["items"] = {};
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          node[key] = rewriteSchema(value, effectiveBaseUri, effectiveIsRoot, false);
        }
      } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
        if (Array.isArray(value)) {
          node[key] = value.map((item) =>
            isPlainObject(item)
              ? rewriteSchema(item, effectiveBaseUri, effectiveIsRoot, false)
              : item
          );
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
        if (isPlainObject(value)) {
          // Snapshot keys so defs added via ensureImported are not re-walked as root defs.
          for (const entryKey of Object.keys(value)) {
            const entryValue = value[entryKey];
            if (isPlainObject(entryValue)) {
              value[entryKey] = rewriteSchema(entryValue, effectiveBaseUri, effectiveIsRoot, false);
            }
          }
        }
      } else if (key === "dependencies" && isPlainObject(value)) {
        for (const entryKey of Object.keys(value)) {
          const entryValue = value[entryKey];
          if (isPlainObject(entryValue)) {
            value[entryKey] = rewriteSchema(entryValue, effectiveBaseUri, effectiveIsRoot, false);
          }
        }
      }
    }

    return node;
  }

  rewriteSchema(rootClone, rootBaseUri, true, true);

  if (importedAny || hadDefs) {
    // Step 1: fixed-point set of always-false definitions in #/$defs/*.
    const alwaysFalseDefs = computeAlwaysFalseDefs(rootDefs);
    // Step 2: prune $ref-bearing properties under always-false object definitions.
    pruneAlwaysFalseObjectRefProperties(rootDefs, alwaysFalseDefs);

    rootClone["$defs"] = sortRecordKeys(rootDefs);

    // Step 3: general DAG unfolding (maxCycleDepth = 2) for any remaining live cycle.
    if (findSchemaRefCycles(rootClone).length > 0) {
      rootDefs = unfoldRemainingCycles(rootClone, rootDefs, MAX_CYCLE_DEPTH);
    }

    // Step 4: purge unreachable definitions from rootClone["$defs"].
    rootDefs = purgeUnreachableDefs(rootClone, rootDefs);

    if (Object.keys(rootDefs).length > 0) {
      rootClone["$defs"] = sortRecordKeys(rootDefs);
    } else {
      delete rootClone["$defs"];
    }
  }

  return rootClone;
}
