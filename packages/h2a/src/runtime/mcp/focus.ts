import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { FocusAnchorEntry } from "@sentropic/focus/artifact";
import { isOsTemporaryPath } from "../path-safety.js";
import { extractFocusRefusals } from "./focus-refusals.js";
import {
  createFocusBuildManager,
  FOCUS_BUILD_RESULT_MAX_WAIT_MS,
  isValidFocusJobId,
  type FocusBuildJobResultResponse,
  type FocusBuildManager,
  type FocusBuildSubmitResult,
  type FocusBuildWorkerOptions,
  type FocusPublishRequestSpec,
  type FocusRefusal
} from "./focus-jobs.js";

export type { FocusRefusal } from "./focus-jobs.js";

export const FOCUS_TEMPLATE_KINDS = ["dossier", "evidence", "all"] as const;
export type FocusTemplateKind = (typeof FOCUS_TEMPLATE_KINDS)[number];

export interface FocusBuildRequest {
  readonly input: string;
  readonly output: string;
}

export interface FocusSubmitBuildRequest {
  readonly input: string;
  readonly output?: string;
  readonly publish?: FocusPublishRequestSpec;
  readonly options: FocusBuildWorkerOptions;
}

export interface FocusBuildResultQuery {
  readonly jobId: string;
  readonly waitMs?: number;
}

export interface FocusCheckRequest {
  readonly input: string;
  readonly previousManifest?: string;
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
      readonly ok: true;
      readonly pending: true;
      readonly jobId: string;
      readonly state: "queued" | "running";
      readonly output: string;
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
const ALLOWED_SUBMIT_BUILD_KEYS = new Set([
  "input",
  "output",
  "publish",
  "mode",
  "target",
  "renderer",
  "themeCss",
  "themeId"
]);
const ALLOWED_PUBLISH_KEYS = new Set([
  "enabled",
  "federation",
  "workspaceRef",
  "artifactId",
  "previousManifest",
  "expectedCurrentReleaseId",
  "title",
  "description",
  "icon",
  "idempotencyKey"
]);
const ALLOWED_BUILD_RESULT_KEYS = new Set(["jobId", "waitMs"]);
const ALLOWED_CHECK_KEYS = new Set(["input", "previousManifest"]);
const ALLOWED_TEMPLATE_KEYS = new Set(["kind"]);
const KIT_DIR = new URL("../../../focus-kit/", import.meta.url);
const MAX_THEME_CSS_BYTES = 262_144;
const PUBLISH_WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PUBLISH_FEDERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

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

function resolveWritableHtmlOutput(
  rawOutput: string,
  canonicalInput: string,
  rawRoot: string,
  canonicalRoot: string,
  toolName: string
): string {
  assertSymlinksStayWithin(canonicalRoot, rawRoot, resolve(rawOutput), "output", false, toolName);
  const lexicalOutput = resolve(rawOutput);
  const lexicalOutputParent = dirname(lexicalOutput);
  let canonicalOutputParent: string;
  try {
    canonicalOutputParent = realpathSync(lexicalOutputParent);
  } catch {
    throw new FocusGuardError("path_policy", `${toolName}: 'output' parent directory must exist`);
  }
  if (!statSync(canonicalOutputParent).isDirectory()) {
    throw new FocusGuardError("path_policy", `${toolName}: 'output' parent must be a directory`);
  }
  if (!isWithin(canonicalRoot, canonicalOutputParent)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: 'output' must stay within the MCP startup workspace`
    );
  }
  if (isTemporaryLocation(canonicalOutputParent)) {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: 'output' may not be under the OS temporary directory (/tmp is refused)`
    );
  }

  const outputName = basename(lexicalOutput);
  if (extname(outputName).toLowerCase() !== ".html") {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: 'output' must be a .html file path (non-.html files are never overwritten)`
    );
  }
  const canonicalOutput = join(canonicalOutputParent, outputName);
  try {
    const outputStat = lstatSync(canonicalOutput);
    if (outputStat.isSymbolicLink()) {
      throw new FocusGuardError("path_policy", `${toolName}: 'output' must not be a symbolic link`);
    }
    if (!outputStat.isFile()) {
      throw new FocusGuardError("path_policy", `${toolName}: 'output' must be a regular .html file`);
    }
  } catch (error) {
    if (error instanceof FocusGuardError) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new FocusGuardError(
        "path_policy",
        `${toolName}: cannot inspect 'output': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (canonicalOutput === canonicalInput) {
    throw new FocusGuardError("path_policy", "Output must differ from the input dossier");
  }

  return canonicalOutput;
}

function assertHtmlExtension(rawOutput: string, toolName: string): void {
  if (rawOutput.endsWith("/") || rawOutput.endsWith("\\") || extname(rawOutput).toLowerCase() !== ".html") {
    throw new FocusGuardError(
      "path_policy",
      `${toolName}: 'output' must be a .html file path (non-.html files are never overwritten)`
    );
  }
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

  const rawInput = requiredPathString(args, "input", "h2a_focus_build");
  const rawOutput = requiredPathString(args, "output", "h2a_focus_build");
  assertHtmlExtension(rawOutput, "h2a_focus_build");

  const { rawRoot, canonicalRoot } = resolveWorkspaceRoot(workspaceRoot, "h2a_focus_build");
  const canonicalInput = resolveExistingInputFile(rawInput, "input", rawRoot, canonicalRoot, "h2a_focus_build");
  const canonicalOutput = resolveWritableHtmlOutput(rawOutput, canonicalInput, rawRoot, canonicalRoot, "h2a_focus_build");

  return { input: canonicalInput, output: canonicalOutput };
}

function validateOptionalShortString(
  obj: Record<string, unknown>,
  field: string,
  toolName: string,
  maxLength: number
): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || /[\u0000-\u001f]/u.test(value)) {
    throw new FocusGuardError(
      "invalid_arguments",
      `${toolName}: '${field}' must be a non-empty string (max ${maxLength} chars, no control chars)`
    );
  }
  return value;
}

function parsePublishSpec(
  rawPublish: unknown,
  rawRoot: string,
  canonicalRoot: string
): FocusPublishRequestSpec | undefined {
  const toolName = "h2a_focus_submit_build";
  if (rawPublish === undefined) return undefined;
  if (typeof rawPublish === "boolean") {
    return rawPublish ? {} : undefined;
  }
  if (typeof rawPublish !== "object" || rawPublish === null || Array.isArray(rawPublish)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'publish' must be an object or boolean`);
  }
  const obj = rawPublish as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((key) => !ALLOWED_PUBLISH_KEYS.has(key));
  if (unknown.length > 0) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: unknown publish field(s): ${unknown.join(", ")}`);
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'publish.enabled' must be a boolean`);
  }
  if (obj.enabled === false) {
    if (Object.keys(obj).some((k) => k !== "enabled")) {
      throw new FocusGuardError(
        "invalid_arguments",
        `${toolName}: 'publish.enabled = false' cannot be combined with other publish fields`
      );
    }
    return undefined;
  }

  const federation = validateOptionalShortString(obj, "federation", toolName, 64);
  if (federation !== undefined && !PUBLISH_FEDERATION_PATTERN.test(federation)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'publish.federation' has an invalid identifier`);
  }
  const workspaceRef = validateOptionalShortString(obj, "workspaceRef", toolName, 128);
  if (workspaceRef !== undefined && !PUBLISH_WORKSPACE_ID_PATTERN.test(workspaceRef)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'publish.workspaceRef' has an invalid identifier`);
  }
  const artifactId = validateOptionalShortString(obj, "artifactId", toolName, 128);
  const title = validateOptionalShortString(obj, "title", toolName, 160);
  const icon = validateOptionalShortString(obj, "icon", toolName, 32);
  const idempotencyKey = validateOptionalShortString(obj, "idempotencyKey", toolName, 256);

  let description: string | undefined;
  if (obj.description !== undefined) {
    if (typeof obj.description !== "string" || obj.description.length > 2000) {
      throw new FocusGuardError("invalid_arguments", `${toolName}: 'publish.description' must be a string <= 2000 chars`);
    }
    description = obj.description;
  }

  let expectedCurrentReleaseId: string | null | undefined;
  if (obj.expectedCurrentReleaseId !== undefined) {
    if (obj.expectedCurrentReleaseId === null) {
      expectedCurrentReleaseId = null;
    } else if (typeof obj.expectedCurrentReleaseId === "string" && obj.expectedCurrentReleaseId.trim().length > 0 && obj.expectedCurrentReleaseId.length <= 128) {
      expectedCurrentReleaseId = obj.expectedCurrentReleaseId;
    } else {
      throw new FocusGuardError(
        "invalid_arguments",
        `${toolName}: 'publish.expectedCurrentReleaseId' must be a non-empty string or null`
      );
    }
  }

  const previousManifest =
    obj.previousManifest !== undefined
      ? resolveExistingInputFile(
          requiredPathString(obj, "previousManifest", toolName),
          "previousManifest",
          rawRoot,
          canonicalRoot,
          toolName
        )
      : undefined;

  return {
    ...(federation !== undefined ? { federation } : {}),
    ...(workspaceRef !== undefined ? { workspaceRef } : {}),
    ...(artifactId !== undefined ? { artifactId } : {}),
    ...(previousManifest !== undefined ? { previousManifest } : {}),
    ...(expectedCurrentReleaseId !== undefined ? { expectedCurrentReleaseId } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {})
  };
}

export async function validateFocusSubmitBuildRequest(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string
): Promise<FocusSubmitBuildRequest> {
  const toolName = "h2a_focus_submit_build";
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: missing arguments`);
  }
  const unknown = Object.keys(args).filter((key) => !ALLOWED_SUBMIT_BUILD_KEYS.has(key));
  if (unknown.length > 0) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: unknown field(s): ${unknown.join(", ")}`);
  }

  const rawInput = requiredPathString(args, "input", toolName);
  const rawOutput = args.output !== undefined ? requiredPathString(args, "output", toolName) : undefined;
  if (rawOutput !== undefined) {
    assertHtmlExtension(rawOutput, toolName);
  }

  const renderer = args.renderer as unknown;
  if (renderer !== undefined && renderer !== "svelte" && renderer !== "vue") {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'renderer' must be 'svelte' or 'vue'`);
  }
  const mode = args.mode as unknown;
  if (mode !== undefined && mode !== "decision" && mode !== "report") {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'mode' must be 'decision' or 'report'`);
  }
  if (mode === "report" && (renderer ?? "svelte") !== "vue") {
    throw new FocusGuardError(
      "invalid_arguments",
      `${toolName}: 'mode' = 'report' requires 'renderer' = 'vue'`
    );
  }
  const target = args.target as unknown;
  if (target !== undefined && target !== "document" && target !== "artifact") {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'target' must be 'document' or 'artifact'`);
  }

  if (args.themeId !== undefined && (typeof args.themeId !== "string" || args.themeId.length === 0)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'themeId' must be a non-empty string`);
  }
  if (args.themeCss !== undefined) {
    if (typeof args.themeCss !== "string" || args.themeCss.length === 0) {
      throw new FocusGuardError("invalid_arguments", `${toolName}: 'themeCss' must be a non-empty string`);
    }
    if (Buffer.byteLength(args.themeCss, "utf8") > MAX_THEME_CSS_BYTES) {
      throw new FocusGuardError(
        "invalid_arguments",
        `${toolName}: 'themeCss' exceeds maximum size of ${MAX_THEME_CSS_BYTES} bytes`
      );
    }
  }

  let validatedThemeId: string | undefined;
  let validatedThemeCss: string | undefined;
  if (args.themeId !== undefined || args.themeCss !== undefined) {
    const { validateThemeCss, validateThemeId } = await import("@sentropic/focus");
    if (typeof args.themeId === "string") {
      try {
        validatedThemeId = validateThemeId(args.themeId);
      } catch (error) {
        throw new FocusGuardError("invalid_arguments", error instanceof Error ? error.message : String(error));
      }
    }
    if (typeof args.themeCss === "string") {
      try {
        validatedThemeCss = validateThemeCss(args.themeCss);
      } catch (error) {
        throw new FocusGuardError("invalid_arguments", error instanceof Error ? error.message : String(error));
      }
    }
  }

  const { rawRoot, canonicalRoot } = resolveWorkspaceRoot(workspaceRoot, toolName);
  const canonicalInput = resolveExistingInputFile(rawInput, "input", rawRoot, canonicalRoot, toolName);
  const canonicalOutput =
    rawOutput !== undefined
      ? resolveWritableHtmlOutput(rawOutput, canonicalInput, rawRoot, canonicalRoot, toolName)
      : undefined;
  const publish = parsePublishSpec(args.publish, rawRoot, canonicalRoot);

  if (canonicalOutput === undefined && publish === undefined) {
    throw new FocusGuardError(
      "invalid_arguments",
      `${toolName}: at least one of 'output' or 'publish' must be specified`
    );
  }

  const options: FocusBuildWorkerOptions = {
    ...(renderer !== undefined ? { renderer } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(validatedThemeCss !== undefined ? { themeCss: validatedThemeCss } : {}),
    ...(validatedThemeId !== undefined ? { themeId: validatedThemeId } : {})
  };

  return {
    input: canonicalInput,
    ...(canonicalOutput !== undefined ? { output: canonicalOutput } : {}),
    ...(publish !== undefined ? { publish } : {}),
    options
  };
}

export function validateFocusBuildResultRequest(
  args: Record<string, unknown> | undefined
): FocusBuildResultQuery {
  const toolName = "h2a_focus_build_result";
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: missing arguments`);
  }
  const unknown = Object.keys(args).filter((key) => !ALLOWED_BUILD_RESULT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: unknown field(s): ${unknown.join(", ")}`);
  }
  const jobId = args.jobId;
  if (!isValidFocusJobId(jobId)) {
    throw new FocusGuardError("invalid_arguments", `${toolName}: 'jobId' must be a valid UUID string`);
  }
  let waitMs: number | undefined;
  if (args.waitMs !== undefined) {
    if (typeof args.waitMs !== "number" || !Number.isFinite(args.waitMs) || args.waitMs < 0) {
      throw new FocusGuardError(
        "invalid_arguments",
        `${toolName}: 'waitMs' must be a non-negative number (0..${FOCUS_BUILD_RESULT_MAX_WAIT_MS})`
      );
    }
    waitMs = args.waitMs;
  }
  return waitMs !== undefined ? { jobId, waitMs } : { jobId };
}

function extractRefusals(error: unknown): { message: string; refusals: FocusRefusal[] } {
  if (error instanceof FocusGuardError) {
    return { message: error.message, refusals: [{ code: error.code, message: error.message }] };
  }
  const extracted = extractFocusRefusals(error);
  return { message: extracted.message, refusals: extracted.refusals };
}

export async function handleH2aFocusSubmitBuild(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string,
  manager: FocusBuildManager,
  env?: Readonly<Record<string, string | undefined>>
): Promise<FocusBuildSubmitResult> {
  let request: FocusSubmitBuildRequest;
  try {
    request = await validateFocusSubmitBuildRequest(args, workspaceRoot);
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }

  return manager.submit({
    workspaceRoot,
    input: request.input,
    ...(request.output !== undefined ? { output: request.output } : {}),
    ...(request.publish !== undefined ? { publish: request.publish } : {}),
    options: request.options,
    ...(env !== undefined ? { env } : {})
  });
}

export async function handleH2aFocusBuildResult(
  args: Record<string, unknown> | undefined,
  manager: FocusBuildManager
): Promise<FocusBuildJobResultResponse> {
  let query: FocusBuildResultQuery;
  try {
    query = validateFocusBuildResultRequest(args);
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }
  return manager.getResult(query.jobId, query.waitMs);
}

export async function handleH2aFocusBuild(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string,
  manager?: FocusBuildManager
): Promise<FocusBuildResult> {
  let request: FocusBuildRequest;
  try {
    request = validateFocusBuildRequest(args, workspaceRoot);
  } catch (error) {
    const { message, refusals } = extractRefusals(error);
    return { ok: false, error: message, refusals };
  }

  let ephemeralRoot: string | undefined;
  let activeManager = manager;
  if (!activeManager) {
    ephemeralRoot = join(dirname(request.output), `.h2a-focus-job-${randomUUID()}`);
    mkdirSync(ephemeralRoot, { recursive: true, mode: 0o700 });
    activeManager = createFocusBuildManager({ stateRoot: ephemeralRoot });
  }

  try {
    const submitted = activeManager.submit({
      workspaceRoot,
      input: request.input,
      output: request.output,
      options: {}
    });
    if (!submitted.ok) {
      return { ok: false, error: submitted.error, refusals: submitted.refusals };
    }

    const boundedWait = Math.min(FOCUS_BUILD_RESULT_MAX_WAIT_MS, activeManager.syncBuildWaitMs);
    const outcome = await activeManager.getResult(submitted.jobId, boundedWait);

    if (!outcome.ok) {
      return {
        ok: false,
        error: outcome.error,
        refusals: outcome.refusals
      };
    }
    if (outcome.state === "succeeded") {
      return {
        ok: true,
        output: outcome.output ?? request.output,
        bytes: outcome.bytes,
        warnings: [...outcome.warnings]
      };
    }
    if (!manager) {
      const msg = "Focus build exceeded bounded wait without a persistent job manager";
      return {
        ok: false,
        error: msg,
        refusals: [{ code: "build_timeout", message: msg }]
      };
    }
    return {
      ok: true,
      pending: true,
      jobId: submitted.jobId,
      state: outcome.state,
      output: request.output
    };
  } finally {
    if (ephemeralRoot !== undefined && !manager) {
      await activeManager.close().catch(() => {});
      rmSync(ephemeralRoot, { recursive: true, force: true });
    }
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
