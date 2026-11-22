/**
 * Multi-host JSON Schema contract linter for exported MCP tool descriptors.
 *
 * Enforces the strict intersection of the schema requirements of all 6
 * qualified CLIs in `QUALIFIED_CLIS` (`claude`, `codex`, `gemini`, `vibe`,
 * `agy`, `muse`). Unqualified adapters (`hermes`, `opencode`) delegate their
 * stdio MCP snippet to `codex.ts` and are covered by this intersection.
 */

import { QUALIFIED_CLIS, type QualifiedCli } from "../../hosts/capture-qualification.js";
import { findNonLocalSchemaRefs, findSchemaRefCycles } from "./ui-render/schema-inline.js";

/** Default serialized UTF-8 ceiling per tool inputSchema (128 KiB, Claude profile). */
export const DEFAULT_MAX_TOOL_SCHEMA_BYTES = 131_072;

const CLAUDE_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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

const ARRAY_SUBSCHEMA_KEYWORDS = new Set<string>([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems"
]);

const MAP_SUBSCHEMA_KEYWORDS = new Set<string>([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas"
]);

/** Rule identifiers emitted by `lintMcpToolSchemas`. */
export type McpSchemaLintRule =
  | "nonLocalRef"
  | "refCycle"
  | "dynamicOrRecursiveKeyword"
  | "orphanDef"
  | "bareArray"
  | "unresolvedLocalRef"
  | "rootNotObject"
  | "invalidToolName"
  | "duplicateToolName"
  | "emptyDescription"
  | "schemaTooLarge";

/** Declarative schema-compatibility profile for one qualified host CLI. */
export interface McpHostSchemaProfile {
  readonly cli: QualifiedCli;
  readonly hostModule: string;
  readonly rules: readonly McpSchemaLintRule[];
  readonly maxToolBytes?: number;
}

/**
 * Normative host schema profiles covering all 6 qualified CLIs in
 * `QUALIFIED_CLIS` (`claude`, `codex`, `gemini`, `vibe`, `agy`, `muse`).
 */
export const MCP_HOST_SCHEMA_PROFILES: Readonly<Record<QualifiedCli, McpHostSchemaProfile>> = {
  claude: {
    cli: "claude",
    hostModule: "hosts/claude.ts",
    rules: [
      "invalidToolName",
      "duplicateToolName",
      "emptyDescription",
      "rootNotObject",
      "schemaTooLarge"
    ],
    maxToolBytes: DEFAULT_MAX_TOOL_SCHEMA_BYTES
  },
  codex: {
    cli: "codex",
    hostModule: "hosts/codex.ts",
    rules: ["rootNotObject", "bareArray", "unresolvedLocalRef"]
  },
  gemini: {
    cli: "gemini",
    hostModule: "hosts/gemini.ts",
    rules: ["nonLocalRef", "dynamicOrRecursiveKeyword", "rootNotObject", "bareArray"]
  },
  vibe: {
    cli: "vibe",
    hostModule: "hosts/vibe-mcp.ts",
    rules: ["rootNotObject", "invalidToolName", "nonLocalRef", "unresolvedLocalRef", "refCycle"]
  },
  agy: {
    cli: "agy",
    hostModule: "hosts/agy.ts",
    rules: ["nonLocalRef", "dynamicOrRecursiveKeyword"]
  },
  muse: {
    cli: "muse",
    hostModule: "hosts/muse.ts",
    rules: ["refCycle", "dynamicOrRecursiveKeyword", "orphanDef"]
  }
} as const;

/** Minimal tool descriptor shape accepted by `lintMcpToolSchemas`. */
export interface McpSchemaLintToolInput {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

/** Options controlling which profiles and limits `lintMcpToolSchemas` checks. */
export interface McpSchemaLintOptions {
  readonly profiles?: readonly QualifiedCli[];
  readonly maxToolBytes?: number;
}

/** One lint violation found on a tool descriptor or schema. */
export interface McpSchemaLintViolation {
  readonly tool: string;
  readonly rule: McpSchemaLintRule;
  readonly profiles: readonly QualifiedCli[];
  readonly path: string;
  readonly message: string;
  readonly ref?: string;
  readonly bytes?: number;
}

/** Aggregate result of `lintMcpToolSchemas`. */
export interface McpSchemaLintResult {
  readonly ok: boolean;
  readonly profiles: readonly QualifiedCli[];
  readonly toolCount: number;
  readonly maxBytes: number;
  readonly violations: readonly McpSchemaLintViolation[];
  readonly byProfile: Readonly<Record<QualifiedCli, readonly McpSchemaLintViolation[]>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function walkSchemaNodes(
  node: unknown,
  path: string,
  visitor: (schemaNode: Record<string, unknown>, nodePath: string) => void,
  skipTopLevelDefs = false
): void {
  if (!isPlainObject(node)) return;
  visitor(node, path);

  for (const [key, value] of Object.entries(node)) {
    if (skipTopLevelDefs && (key === "$defs" || key === "definitions")) continue;
    const childPath = `${path}/${escapePointerToken(key)}`;
    if (SINGLE_SUBSCHEMA_KEYWORDS.has(key)) {
      if (isPlainObject(value)) walkSchemaNodes(value, childPath, visitor, false);
    } else if (ARRAY_SUBSCHEMA_KEYWORDS.has(key)) {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          walkSchemaNodes(value[index], `${childPath}/${index}`, visitor, false);
        }
      }
    } else if (MAP_SUBSCHEMA_KEYWORDS.has(key)) {
      if (isPlainObject(value)) {
        for (const [entryKey, entryValue] of Object.entries(value)) {
          walkSchemaNodes(entryValue, `${childPath}/${escapePointerToken(entryKey)}`, visitor, false);
        }
      }
    } else if (key === "dependencies" && isPlainObject(value)) {
      for (const [entryKey, entryValue] of Object.entries(value)) {
        if (isPlainObject(entryValue)) {
          walkSchemaNodes(entryValue, `${childPath}/${escapePointerToken(entryKey)}`, visitor, false);
        }
      }
    }
  }
}

function findOrphanDefPointers(schema: Record<string, unknown>): string[] {
  const reachablePointers = new Set<string>([""]);
  const reachableDefs = new Set<string>();
  const queue: { node: unknown; path: string; skipTopLevelDefs: boolean }[] = [
    { node: schema, path: "", skipTopLevelDefs: true }
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    walkSchemaNodes(
      item.node,
      item.path,
      (node) => {
        const ref = node["$ref"];
        if (typeof ref !== "string" || !ref.startsWith("#")) return;
        const targetPtr = ref.slice(1);
        if (targetPtr === "" || !targetPtr.startsWith("/")) return;

        const segments = targetPtr.slice(1).split("/").map(unescapePointerToken);
        if ((segments[0] === "$defs" || segments[0] === "definitions") && segments.length >= 2) {
          const defPtr = `/${segments[0]}/${escapePointerToken(segments[1]!)}`;
          reachableDefs.add(defPtr);
          if (!reachablePointers.has(defPtr)) {
            reachablePointers.add(defPtr);
            const defNode = tryResolveJsonPointer(schema, defPtr);
            if (isPlainObject(defNode)) {
              queue.push({ node: defNode, path: defPtr, skipTopLevelDefs: false });
            }
          }
        } else if (!reachablePointers.has(targetPtr)) {
          reachablePointers.add(targetPtr);
          const targetNode = tryResolveJsonPointer(schema, targetPtr);
          if (isPlainObject(targetNode)) {
            queue.push({ node: targetNode, path: targetPtr, skipTopLevelDefs: false });
          }
        }
      },
      item.skipTopLevelDefs
    );
  }

  const orphans: string[] = [];
  for (const container of ["$defs", "definitions"] as const) {
    const defs = schema[container];
    if (!isPlainObject(defs)) continue;
    for (const key of Object.keys(defs).sort()) {
      const ptr = `/${container}/${escapePointerToken(key)}`;
      if (!reachableDefs.has(ptr)) {
        orphans.push(ptr);
      }
    }
  }
  return orphans;
}

/**
 * Lints a list of MCP tool descriptors against the selected host profiles
 * (default: all 6 `QUALIFIED_CLIS`).
 */
export function lintMcpToolSchemas(
  tools: readonly McpSchemaLintToolInput[],
  options: McpSchemaLintOptions = {}
): McpSchemaLintResult {
  const selectedProfiles: readonly QualifiedCli[] =
    options.profiles && options.profiles.length > 0 ? [...options.profiles] : [...QUALIFIED_CLIS];
  const activeSet = new Set<QualifiedCli>(selectedProfiles);
  const maxToolBytes = options.maxToolBytes ?? DEFAULT_MAX_TOOL_SCHEMA_BYTES;

  const violations: McpSchemaLintViolation[] = [];
  const byProfileMutable: Record<QualifiedCli, McpSchemaLintViolation[]> = {
    claude: [],
    codex: [],
    gemini: [],
    vibe: [],
    agy: [],
    muse: []
  };

  function record(
    tool: string,
    rule: McpSchemaLintRule,
    candidates: readonly QualifiedCli[],
    path: string,
    message: string,
    extra?: { readonly ref?: string; readonly bytes?: number }
  ): void {
    const matched = candidates.filter((cli) => activeSet.has(cli));
    if (matched.length === 0) return;
    const violation: McpSchemaLintViolation = {
      tool,
      rule,
      profiles: matched,
      path,
      message,
      ...(extra?.ref !== undefined ? { ref: extra.ref } : {}),
      ...(extra?.bytes !== undefined ? { bytes: extra.bytes } : {})
    };
    violations.push(violation);
    for (const cli of matched) {
      byProfileMutable[cli].push(violation);
    }
  }

  const seenNames = new Set<string>();
  let maxBytes = 0;

  for (const tool of tools) {
    const rawName = typeof tool.name === "string" ? tool.name : "";
    const toolLabel = rawName.length > 0 ? rawName : "<unnamed>";

    // Tool name validation (vibe: non-empty; claude: unique + ^[a-zA-Z0-9_-]{1,64}$).
    if (rawName.trim().length === 0) {
      record(
        toolLabel,
        "invalidToolName",
        ["claude", "vibe"],
        "",
        "Tool name must be a non-empty string"
      );
    } else {
      if (!CLAUDE_TOOL_NAME_RE.test(rawName)) {
        record(
          toolLabel,
          "invalidToolName",
          ["claude"],
          "",
          `Tool name "${rawName}" does not match ${CLAUDE_TOOL_NAME_RE}`
        );
      }
      if (seenNames.has(rawName)) {
        record(
          toolLabel,
          "duplicateToolName",
          ["claude"],
          "",
          `Duplicate MCP tool name "${rawName}"`
        );
      }
      seenNames.add(rawName);
    }

    // Description validation (claude).
    if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
      record(
        toolLabel,
        "emptyDescription",
        ["claude"],
        "",
        "Tool description must be a non-empty string"
      );
    }

    // Serialized UTF-8 size ceiling (claude: <= 128 KiB).
    const serialized = JSON.stringify(tool.inputSchema ?? null);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > maxBytes) maxBytes = bytes;
    if (bytes > maxToolBytes) {
      record(
        toolLabel,
        "schemaTooLarge",
        ["claude"],
        "",
        `Serialized inputSchema size ${bytes} bytes exceeds ${maxToolBytes} byte limit`,
        { bytes }
      );
    }

    // Root schema type === "object" (claude, codex, gemini, vibe).
    if (!isPlainObject(tool.inputSchema) || tool.inputSchema["type"] !== "object") {
      record(
        toolLabel,
        "rootNotObject",
        ["claude", "codex", "gemini", "vibe"],
        "",
        `Root inputSchema must be an object with explicit type: "object"`
      );
      if (!isPlainObject(tool.inputSchema)) continue;
    }

    const schema = tool.inputSchema;

    // Non-local $ref check (agy, gemini, vibe).
    for (const nonLocal of findNonLocalSchemaRefs(schema)) {
      record(
        toolLabel,
        "nonLocalRef",
        ["agy", "gemini", "vibe"],
        nonLocal.path,
        `Non-local $ref "${nonLocal.ref}" is rejected by offline JSON Schema loaders`,
        { ref: nonLocal.ref }
      );
    }

    // $ref cycle check (muse, vibe).
    for (const cycle of findSchemaRefCycles(schema)) {
      record(
        toolLabel,
        "refCycle",
        ["muse", "vibe"],
        cycle.from,
        `Recursive $ref cycle "${cycle.from}" -> "${cycle.ref}" is not supported`,
        { ref: cycle.ref }
      );
    }

    // Orphan $defs / definitions check (muse).
    for (const orphanPtr of findOrphanDefPointers(schema)) {
      record(
        toolLabel,
        "orphanDef",
        ["muse"],
        orphanPtr,
        `Unreachable schema definition "${orphanPtr}"`
      );
    }

    // Structural per-node checks: bareArray, unresolvedLocalRef, dynamic/recursive keywords.
    walkSchemaNodes(schema, "", (node, nodePath) => {
      // Bare array: type === "array" (or union including "array") without items or prefixItems.
      const nodeType = node["type"];
      const isArrayType =
        nodeType === "array" || (Array.isArray(nodeType) && nodeType.includes("array"));
      if (isArrayType && node["items"] === undefined && node["prefixItems"] === undefined) {
        record(
          toolLabel,
          "bareArray",
          ["codex", "gemini"],
          nodePath,
          `Array schema at "${nodePath || "/"}" is missing "items" or "prefixItems"`
        );
      }

      // Unresolved local $ref pointer (codex, vibe).
      const ref = node["$ref"];
      if (typeof ref === "string" && ref.startsWith("#")) {
        const targetPtr = ref.slice(1);
        if (tryResolveJsonPointer(schema, targetPtr) === undefined) {
          record(
            toolLabel,
            "unresolvedLocalRef",
            ["codex", "vibe"],
            nodePath,
            `Local $ref "${ref}" at "${nodePath || "/"}" does not resolve`,
            { ref }
          );
        }
      }

      // $dynamicRef / $recursiveRef / $dynamicAnchor / $recursiveAnchor.
      for (const kw of ["$dynamicRef", "$recursiveRef"] as const) {
        const val = node[kw];
        if (typeof val === "string") {
          const isExternal = !val.startsWith("#");
          record(
            toolLabel,
            "dynamicOrRecursiveKeyword",
            isExternal ? ["agy", "gemini", "muse"] : ["muse"],
            nodePath,
            `Schema keyword "${kw}" ("${val}") is disallowed`,
            { ref: val }
          );
        }
      }
      for (const kw of ["$dynamicAnchor", "$recursiveAnchor"] as const) {
        if (node[kw] !== undefined) {
          record(
            toolLabel,
            "dynamicOrRecursiveKeyword",
            ["muse"],
            nodePath,
            `Schema keyword "${kw}" is disallowed`
          );
        }
      }
    });
  }

  return {
    ok: violations.length === 0,
    profiles: selectedProfiles,
    toolCount: tools.length,
    maxBytes,
    violations,
    byProfile: byProfileMutable
  };
}
