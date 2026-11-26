/**
 * Focus dossier publication to a bound Sentropic MCP workspace (`artifacts_ensure` +
 * `artifacts_publish`), keeping artifact access `restricted` by construction.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import type { FetchLike } from "./oauth-pkce.js";
import { preparePublishSession, type PublishRuntime } from "./publish-client.js";
import { resolvePublishConfig } from "./publish-config.js";
import { SentropicPublishError, safeErrorCode } from "./publish-errors.js";
import { REFRESH_LOCK_WAIT_MS } from "./refresh-lock.js";
import { resolveLocalWorkspaceId } from "./workspace-binding.js";

export interface FocusPublishRequest {
  readonly workspaceRoot: string;
  readonly bindingName: string;
  readonly documentJson: string;
  readonly manifestJson: string;
  readonly viewsJson?: string;
  readonly idempotencyKey: string;
  readonly federation?: string;
  readonly workspaceRef?: string;
  readonly artifactId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly expectedCurrentReleaseId?: string | null;
  readonly profile?: Readonly<Record<string, string | number | boolean | null>>;
  // Isolated test seams (default to standard process runtime).
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly homeDir?: () => string;
  readonly now?: () => number;
  readonly resolveWorkspace?: (cwd: string) => string | undefined;
  readonly clientVersion?: string;
  readonly refreshLockWaitMs?: number;
}

export interface FocusPublishOutcome {
  readonly federation: string;
  readonly workspaceRef: string;
  readonly bindingName: string;
  readonly artifactId: string;
  readonly releaseId?: string;
  readonly digest?: string;
  readonly stableUrl?: string;
  readonly versionUrl?: string;
  readonly files: readonly string[];
  readonly restricted: true;
}

function runtimeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Supports both v1 flat payloads and v2 `{ ok, output }` receipts from Sentropic artifacts MCP. */
function unwrapArtifactOutput(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  if (isRecord(payload.output)) return payload.output;
  if (isRecord(payload.result)) return payload.result;
  return payload;
}

function extractMcpFailureCode(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "unrecognized";
  if (isRecord(payload.error)) {
    const nested = safeErrorCode(payload.error.code ?? payload.error.variant ?? payload.error.message);
    if (nested !== "unrecognized") return nested;
  }
  const direct = safeErrorCode(payload.error ?? payload.code ?? payload.variant);
  if (direct !== "unrecognized") return direct;
  return "unrecognized";
}

function optionalStringField(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Ensure the binding-scoped artifact on the bound Sentropic workspace and publish the
 * canonical Focus release files (`dossier.json`, `focus.manifest.json`, and optional `views.json`).
 * Never alters visibility to public; artifacts stay `restricted`.
 */
export async function publishFocusRelease(request: FocusPublishRequest): Promise<FocusPublishOutcome> {
  const env = request.env ?? process.env;
  const home = (request.homeDir ?? homedir)();
  const config = resolvePublishConfig(env, home, request.federation !== undefined ? { federation: request.federation } : {});
  const rt: PublishRuntime = {
    config,
    fetch: request.fetch ?? globalThis.fetch,
    now: request.now ?? (() => Date.now()),
    log: () => {},
    clientVersion: request.clientVersion ?? runtimeVersion(),
    refreshLockWaitMs: request.refreshLockWaitMs ?? REFRESH_LOCK_WAIT_MS,
  };

  const localWorkspace = (request.resolveWorkspace ?? resolveLocalWorkspaceId)(request.workspaceRoot);
  const { session, workspaceRef } = await preparePublishSession(rt, {
    localWorkspace,
    ...(request.workspaceRef !== undefined ? { workspaceRef: request.workspaceRef } : {}),
  });

  const metadata: Record<string, string> = {};
  if (request.title !== undefined) metadata.title = request.title;
  if (request.description !== undefined) metadata.description = request.description;
  if (request.icon !== undefined) metadata.icon = request.icon;

  let artifactId = request.artifactId;
  if (artifactId === undefined) {
    const ensured = await session.callTool({
      name: "artifacts_ensure",
      workspaceRef,
      arguments: {
        bindingName: request.bindingName,
        parameters: {},
        idempotencyKey: `${request.idempotencyKey}:ensure`,
        ...metadata,
      },
    });
    const ensuredOutput = unwrapArtifactOutput(ensured.payload);
    if (ensured.isError || typeof ensuredOutput?.artifactId !== "string" || ensuredOutput.artifactId.length === 0) {
      const code = extractMcpFailureCode(ensured.payload ?? ensuredOutput);
      throw new SentropicPublishError("mcp", `artifacts_ensure failed (${code})`);
    }
    artifactId = ensuredOutput.artifactId;
  }

  const files: Array<{ path: string; mimeType: "application/json"; text: string }> = [
    { path: "dossier.json", mimeType: "application/json", text: request.documentJson },
    { path: "focus.manifest.json", mimeType: "application/json", text: request.manifestJson },
  ];
  if (request.viewsJson !== undefined) {
    files.push({ path: "views.json", mimeType: "application/json", text: request.viewsJson });
  }

  const publishArgs: Record<string, unknown> = {
    artifactId,
    idempotencyKey: `${request.idempotencyKey}:publish`,
    files,
    ...metadata,
  };
  if (request.expectedCurrentReleaseId !== undefined) {
    publishArgs.expectedCurrentReleaseId = request.expectedCurrentReleaseId;
  }
  if (request.profile !== undefined) {
    publishArgs.profile = request.profile;
  }

  const published = await session.callTool({
    name: "artifacts_publish",
    workspaceRef,
    arguments: publishArgs,
  });
  const publishOutput = unwrapArtifactOutput(published.payload);
  if (published.isError) {
    const code = extractMcpFailureCode(published.payload ?? publishOutput);
    throw new SentropicPublishError("mcp", `artifacts_publish failed (${code})`);
  }

  const resolvedArtifactId = optionalStringField(publishOutput, "artifactId") ?? artifactId;
  const releaseId = optionalStringField(publishOutput, "releaseId");
  const digest = optionalStringField(publishOutput, "digest");
  const stableUrl = optionalStringField(publishOutput, "stableUrl");
  const versionUrl = optionalStringField(publishOutput, "versionUrl");

  return {
    federation: config.federation,
    workspaceRef,
    bindingName: request.bindingName,
    artifactId: resolvedArtifactId,
    ...(releaseId !== undefined ? { releaseId } : {}),
    ...(digest !== undefined ? { digest } : {}),
    ...(stableUrl !== undefined ? { stableUrl } : {}),
    ...(versionUrl !== undefined ? { versionUrl } : {}),
    files: files.map((file) => file.path),
    restricted: true,
  };
}
