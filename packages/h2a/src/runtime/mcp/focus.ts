import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { FocusAnchorEntry } from "@sentropic/focus/artifact";
import { isOsTemporaryPath } from "../path-safety.js";
import type { DiagramViewRefusal } from "../../focus-build.js";

export const FOCUS_TEMPLATE_KINDS = ["dossier", "evidence", "all"] as const;
export type FocusTemplateKind = (typeof FOCUS_TEMPLATE_KINDS)[number];

export interface FocusBuildRequest {
  readonly input: string;
  readonly output: string;
}

export interface FocusCheckRequest {
  readonly input: string;
  readonly previousManifest?: string;
}

export interface FocusRefusal {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly sectionId?: string;
  readonly slot?: string;
  readonly entityId?: string;
  readonly neededPx?: number;
  readonly allocatedPx?: number;
  readonly text?: string;
}

export type FocusBuildResult =
  | {
      readonly ok: true;
      readonly output: string;
      readonly bytes: number;
      readonly warnings: readonly string[];
      [key: string]: unknown;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly refusals: readonly FocusRefusal[];
      [key: string]: unknown;
    };

export type FocusCheckResult =
  | {
      readonly ok: true;
      readonly documentType: "decision" | "report";
      readonly schemaId: string;
      readonly bindingName: string;
      readonly documentDigest: string;
      readonly bytes: number;
      readonly anchors: readonly FocusAnchorEntry[];
      readonly retiredRefs: readonly string[];
      readonly revisionSeq: number;
      [key: string]: unknown;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly refusals: readonly FocusRefusal[];
      [key: string]: unknown;
    };

export type FocusTemplateResult =
  | {
      readonly ok: true;
      readonly kind: "dossier" | "evidence";
      readonly schema: string;
      readonly template: unknown;
      [key: string]: unknown;
    }
  | {
      readonly ok: true;
      readonly kind: "all";
      readonly templates: {
        readonly dossier: unknown;
        readonly evidence: unknown;
      };
      readonly schemas: {
        readonly dossier: string;
        readonly evidence: string;
      };
      [key: string]: unknown;
    }
  | {
      readonly ok: false;
      readonly error: string;
      [key: string]: unknown;
    };

const ALLOWED_BUILD_KEYS = new Set(["input", "output"]);
const ALLOWED_CHECK_KEYS = new Set(["input", "previousManifest"]);
const ALLOWED_TEMPLATE_KEYS = new Set(["kind"]);
const KIT_DIR = new URL("../../../focus-kit/", import.meta.url);

class FocusGuardError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FocusGuardError";
    this.code = code;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isTemporaryLocation(canonicalExistingPath: string): boolean {
  if (isOsTemporaryPath(canonicalExistingPath)) return true;
  if (process.platform !== "win32") {
    try {
      const systemTmp = realpathSync("/tmp");
      if (isWithin(systemTmp, canonicalExistingPath)) return true;
    } catch {
      if (isWithin("/tmp", canonicalExistingPath)) return true;
    }
  }
  return false;
}

function assertSymlinksStayWithin(
  canonicalRoot: string,
  rawRoot: string,
  lexicalPath: string,
  field: "input" | "output" | "previousManifest",
  includeLeaf: boolean,
  toolName = "h2a_focus_build"
): void {
  const rel = isWithin(canonicalRoot, lexicalPath)
    ? relative(canonicalRoot, lexicalPath)
    : isWithin(rawRoot, lexicalPath)
      ? relative(rawRoot, lexicalPath)
      : null;
  if (rel === null) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' must stay within the MCP startup workspace`
    );
  }
  const allSegments = rel.split(sep).filter((segment) => segment.length > 0 && segment !== ".");
  const segments = includeLeaf ? allSegments : allSegments.slice(0, -1);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let st;
    try {
      st = lstatSync(current);
    } catch {
      throw new FocusGuardError(
        "path_policy",
        field === "output"
          ? `${toolName}: 'output' parent directory must exist`
          : `${toolName}: '${field}' file must exist`
      );
    }
    if (st.isSymbolicLink()) {
      let target: string;
      try {
        target = realpathSync(current);
      } catch {
        throw new FocusGuardError(
          "path_policy",
          `${toolName}: '${field}' contains a broken symbolic link`
        );
      }
      if (!isWithin(canonicalRoot, target)) {
        throw new FocusGuardError(
          "path_policy",
          `${toolName}: '${field}' must not follow symbolic links outside the MCP startup workspace`
        );
      }
      if (isTemporaryLocation(target)) {
        throw new FocusGuardError(
          "path_policy",
          `${toolName}: '${field}' may not resolve under the OS temporary directory`
        );
      }
    }
  }
}

function requiredPathString(
  args: Record<string, unknown>,
  field: "input" | "output" | "previousManifest",
  toolName = "h2a_focus_build"
): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new FocusGuardError(
      "invalid_arguments",
      `${toolName}: '${field}' must be a non-empty string`
    );
  }
  if (value.includes("\0")) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' must not contain NUL bytes`
    );
  }
  if (!isAbsolute(value)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' must be an absolute path`
    );
  }
  return value;
}

function resolveWorkspaceRoot(workspaceRoot: string, toolName: string): { rawRoot: string; canonicalRoot: string } {
  const rawRoot = resolve(workspaceRoot);
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(rawRoot);
  } catch {
    throw new FocusGuardError("path_policy", `${toolName}: MCP workspace root must exist`);
  }
  if (!statSync(canonicalRoot).isDirectory()) {
    throw new FocusGuardError("path_policy", `${toolName}: MCP workspace root must be a directory`);
  }
  if (isTemporaryLocation(canonicalRoot)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: Focus dossier paths may not be under the OS temporary directory (/tmp is refused)`
    );
  }
  return { rawRoot, canonicalRoot };
}

function resolveExistingInputFile(
  rawPath: string,
  field: "input" | "previousManifest",
  rawRoot: string,
  canonicalRoot: string,
  toolName: string
): string {
  const lexicalPath = resolve(rawPath);
  assertSymlinksStayWithin(canonicalRoot, rawRoot, lexicalPath, field, true, toolName);
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(lexicalPath);
  } catch {
    throw new FocusGuardError("path_policy", `${toolName}: '${field}' file must exist`);
  }
  if (!isWithin(canonicalRoot, canonicalPath)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' must stay within the MCP startup workspace`
    );
  }
  if (isTemporaryLocation(canonicalPath)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' may not be under the OS temporary directory (/tmp is refused)`
    );
  }
  if (!statSync(canonicalPath).isFile()) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: '${field}' must be a regular JSON file`
    );
  }
  return canonicalPath;
}

export function validateFocusCheckRequest(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): FocusCheckRequest {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new FocusGuardError("invalid_arguments", "h2a_focus_check: missing arguments");
  }
  const unknown = Object.keys(args).filter((key) => !ALLOWED_CHECK_KEYS.has(key));
  if (unknown.length > 0) {
    throw new FocusGuardError(
      "invalid_arguments",
      `h2a_focus_check: unknown field(s): ${unknown.join(", ")}`
    );
  }
  const rawInput = requiredPathString(args, "input", "h2a_focus_check");
  const rawPreviousManifest =
    args.previousManifest !== undefined
      ? requiredPathString(args, "previousManifest", "h2a_focus_check")
      : undefined;

  const { rawRoot, canonicalRoot } = resolveWorkspaceRoot(workspaceRoot, "h2a_focus_check");
  const canonicalInput = resolveExistingInputFile(rawInput, "input", rawRoot, canonicalRoot, "h2a_focus_check");
  const canonicalPreviousManifest =
    rawPreviousManifest !== undefined
      ? resolveExistingInputFile(rawPreviousManifest, "previousManifest", rawRoot, canonicalRoot, "h2a_focus_check")
      : undefined;

  return canonicalPreviousManifest !== undefined
    ? { input: canonicalInput, previousManifest: canonicalPreviousManifest }
    : { input: canonicalInput };
}

export function validateFocusBuildRequest(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): FocusBuildRequest {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new FocusGuardError("invalid_arguments", "h2a_focus_build: missing arguments");
  }
  const unknown = Object.keys(args).filter((key) => !ALLOWED_BUILD_KEYS.has(key));
  if (unknown.length > 0) {
    throw new FocusGuardError(
      "invalid_arguments",
      `h2a_focus_build: unknown field(s): ${unknown.join(", ")}`
    );
  }

  const rawInput = requiredPathString(args, "input");
  const rawOutput = requiredPathString(args, "output");

  if (rawOutput.endsWith("/") || rawOutput.endsWith("\\") || extname(rawOutput).toLowerCase() !== ".html") {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' must be a .html file path (non-.html files are never overwritten)"
    );
  }

  const rawRoot = resolve(workspaceRoot);
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(rawRoot);
  } catch {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: MCP workspace root must exist"
    );
  }
  if (!statSync(canonicalRoot).isDirectory()) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: MCP workspace root must be a directory"
    );
  }
  if (isTemporaryLocation(canonicalRoot)) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: Focus dossier paths may not be under the OS temporary directory (/tmp is refused)"
    );
  }

  const lexicalInput = resolve(rawInput);
  const lexicalOutput = resolve(rawOutput);

  assertSymlinksStayWithin(canonicalRoot, rawRoot, lexicalInput, "input", true);
  let canonicalInput: string;
  try {
    canonicalInput = realpathSync(lexicalInput);
  } catch {
    throw new FocusGuardError("path_policy", "h2a_focus_build: 'input' file must exist");
  }
  if (!isWithin(canonicalRoot, canonicalInput)) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'input' must stay within the MCP startup workspace"
    );
  }
  if (isTemporaryLocation(canonicalInput)) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'input' may not be under the OS temporary directory (/tmp is refused)"
    );
  }
  if (!statSync(canonicalInput).isFile()) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'input' must be a regular JSON file"
    );
  }

  assertSymlinksStayWithin(canonicalRoot, rawRoot, lexicalOutput, "output", false);
  const lexicalOutputParent = dirname(lexicalOutput);
  let canonicalOutputParent: string;
  try {
    canonicalOutputParent = realpathSync(lexicalOutputParent);
  } catch {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' parent directory must exist"
    );
  }
  if (!statSync(canonicalOutputParent).isDirectory()) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' parent must be a directory"
    );
  }
  if (!isWithin(canonicalRoot, canonicalOutputParent)) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' must stay within the MCP startup workspace"
    );
  }
  if (isTemporaryLocation(canonicalOutputParent)) {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' may not be under the OS temporary directory (/tmp is refused)"
    );
  }

  const outputName = basename(lexicalOutput);
  if (extname(outputName).toLowerCase() !== ".html") {
    throw new FocusGuardError(
      "path_policy",
      "h2a_focus_build: 'output' must be a .html file path (non-.html files are never overwritten)"
    );
  }
  const canonicalOutput = join(canonicalOutputParent, outputName);
  try {
    const outputStat = lstatSync(canonicalOutput);
    if (outputStat.isSymbolicLink()) {
      throw new FocusGuardError(
        "path_policy",
        "h2a_focus_build: 'output' must not be a symbolic link"
      );
    }
    if (!outputStat.isFile()) {
      throw new FocusGuardError(
        "path_policy",
        "h2a_focus_build: 'output' must be a regular .html file"
      );
    }
  } catch (error) {
    if (error instanceof FocusGuardError) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new FocusGuardError(
        "path_policy",
        `h2a_focus_build: cannot inspect 'output': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (canonicalOutput === canonicalInput) {
    throw new FocusGuardError(
      "path_policy",
      "Output must differ from the input dossier"
    );
  }

  return { input: canonicalInput, output: canonicalOutput };
}

interface StructuralValidationIssue {
  readonly path?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
}

function extractRefusals(error: unknown): { message: string; refusals: FocusRefusal[] } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FocusGuardError) {
    return { message, refusals: [{ code: error.code, message }] };
  }
  if (error && typeof error === "object") {
    const maybeIssues = (error as { issues?: unknown }).issues;
    if (Array.isArray(maybeIssues) && maybeIssues.length > 0) {
      const refusals: FocusRefusal[] = maybeIssues.map((entry) => {
        const issue = entry as StructuralValidationIssue;
        return {
          ...(typeof issue.path === "string" ? { path: issue.path } : {}),
          code: typeof issue.code === "string" ? issue.code : "validation_error",
          message: typeof issue.message === "string" ? issue.message : String(issue.message ?? "")
        };
      });
      return { message, refusals };
    }
    const maybeDiagnostics = (error as { diagnostics?: unknown; sectionId?: unknown }).diagnostics;
    if (Array.isArray(maybeDiagnostics) && maybeDiagnostics.length > 0) {
      const sectionId =
        typeof (error as { sectionId?: unknown }).sectionId === "string"
          ? ((error as { sectionId: string }).sectionId)
          : undefined;
      const refusals: FocusRefusal[] = (maybeDiagnostics as readonly DiagramViewRefusal[]).map((d) => ({
        code: d.code,
        ...(sectionId !== undefined ? { sectionId } : {}),
        slot: d.slot,
        entityId: d.entityId,
        neededPx: d.neededPx,
        allocatedPx: d.allocatedPx,
        ...(d.text !== undefined ? { text: d.text } : {}),
        message: `${d.code} ${d.slot} ${d.entityId} needed ${d.neededPx}px > ${d.allocatedPx}px${d.text === undefined ? "" : ` « ${d.text} »`}`
      }));
      return { message, refusals };
    }
  }
  return { message, refusals: [{ code: "build_refused", message }] };
}

export async function handleH2aFocusBuild(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): Promise<FocusBuildResult> {
  let request: FocusBuildRequest;
  try {
    request = validateFocusBuildRequest(args, workspaceRoot);
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }

  let document: unknown;
  try {
    const raw = readFileSync(request.input, "utf8");
    document = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      refusals: [{ code: "invalid_json", message }]
    };
  }

  try {
    // Same in-process builder & atomic file writer as `h2a focus build` (no subprocess).
    const { buildFocusDossier, writeFocusArtifactFile } = await import("../../focus-build.js");
    const html = buildFocusDossier(document);
    writeFocusArtifactFile(request.output, html);
    return {
      ok: true,
      output: request.output,
      bytes: Buffer.byteLength(html, "utf8"),
      warnings: []
    };
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }
}

export async function handleH2aFocusCheck(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): Promise<FocusCheckResult> {
  let request: FocusCheckRequest;
  try {
    request = validateFocusCheckRequest(args, workspaceRoot);
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }

  let document: unknown;
  try {
    document = JSON.parse(readFileSync(request.input, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      refusals: [{ code: "invalid_json", message }]
    };
  }

  let previousManifest: unknown;
  if (request.previousManifest !== undefined) {
    try {
      previousManifest = JSON.parse(readFileSync(request.previousManifest, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: message,
        refusals: [{ path: "$.previousManifest", code: "invalid_json", message }]
      };
    }
  }

  const { checkFocusArtifact } = await import("@sentropic/focus/artifact");
  const result = checkFocusArtifact(
    document,
    previousManifest !== undefined ? { previousManifest } : undefined
  );
  if (!result.ok) {
    const error = `invalid DecisionDossierDocument: ${result.issues
      .map((i) => `${i.path} ${i.code}: ${i.message}`)
      .join("; ")}`;
    return {
      ok: false,
      error,
      refusals: result.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message
      }))
    };
  }

  return {
    ok: true,
    documentType: result.documentType,
    schemaId: result.schemaId,
    bindingName: result.bindingName,
    documentDigest: result.documentDigest,
    bytes: result.bytes,
    anchors: result.anchors,
    retiredRefs: result.retiredRefs,
    revisionSeq: result.revisionSeq
  };
}

function readShippedTemplate(name: "dossier.template.json" | "dossier.evidence.template.json"): unknown {
  return JSON.parse(readFileSync(new URL(name, KIT_DIR), "utf8")) as unknown;
}

export function handleH2aFocusTemplate(
  args: Record<string, unknown> | undefined
): FocusTemplateResult {
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return { ok: false, error: "h2a_focus_template: arguments must be an object" };
  }
  const provided = args ?? {};
  const unknown = Object.keys(provided).filter((key) => !ALLOWED_TEMPLATE_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, error: `h2a_focus_template: unknown field(s): ${unknown.join(", ")}` };
  }
  const kind = provided.kind ?? "all";
  if (typeof kind !== "string" || !(FOCUS_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "h2a_focus_template: 'kind' must be dossier|evidence|all" };
  }
  try {
    if (kind === "dossier") {
      return {
        ok: true,
        kind: "dossier",
        schema: "focus-kit/dossier.schema.json",
        template: readShippedTemplate("dossier.template.json")
      };
    }
    if (kind === "evidence") {
      return {
        ok: true,
        kind: "evidence",
        schema: "focus-kit/dossier.v2.schema.json",
        template: readShippedTemplate("dossier.evidence.template.json")
      };
    }
    return {
      ok: true,
      kind: "all",
      templates: {
        dossier: readShippedTemplate("dossier.template.json"),
        evidence: readShippedTemplate("dossier.evidence.template.json")
      },
      schemas: {
        dossier: "focus-kit/dossier.schema.json",
        evidence: "focus-kit/dossier.v2.schema.json"
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
