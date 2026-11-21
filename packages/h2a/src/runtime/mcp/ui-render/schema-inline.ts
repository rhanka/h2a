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

function resolveJsonPointer(document: unknown, pointer: string, label: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new Error(`Unsupported non-JSON-Pointer fragment "#${pointer}" in ${label}`);
  }
  const tokens = pointer.slice(1).split("/").map(unescapePointerToken);
  let current: unknown = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`JSON Pointer "#${pointer}" not found in ${label}`);
      }
      current = current[index];
    } else if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      throw new Error(`JSON Pointer "#${pointer}" not found in ${label}`);
    }
  }
  return current;
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
 * Returns a deep-cloned, self-contained copy of `schema` with every external
 * `$ref` (and its transitive closure, including relative sibling refs and
 * recursive definitions) bundled into local `#/$defs/<name>` entries.
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
  const rootDefs: Record<string, unknown> = hadDefs
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
    rootClone["$defs"] = sortRecordKeys(rootDefs);
  }

  return rootClone;
}
