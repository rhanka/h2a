import { readFileSync } from "node:fs";

import {
  buildFocusReleaseBundle,
  extractFocusRefusals,
  writeFocusArtifactFile
} from "../../focus-build.js";
import {
  FOCUS_WORKER_RESULT_MARKER,
  type FocusWorkerPayload,
  type FocusWorkerResult
} from "./focus-jobs.js";

async function readStdinUtf8(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function emitResult(result: FocusWorkerResult): void {
  process.stdout.write(`${FOCUS_WORKER_RESULT_MARKER}${JSON.stringify(result)}\n`);
}

async function runWorker(): Promise<void> {
  let payload: FocusWorkerPayload;
  try {
    payload = JSON.parse(await readStdinUtf8()) as FocusWorkerPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitResult({
      ok: false,
      error: `invalid Focus worker payload: ${message}`,
      refusals: [{ code: "invalid_worker_payload", message }]
    });
    process.exitCode = 1;
    return;
  }

  let document: unknown;
  try {
    document = JSON.parse(readFileSync(payload.input, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitResult({
      ok: false,
      error: message,
      refusals: [{ code: "invalid_json", message }]
    });
    return;
  }

  let previousManifest: unknown;
  if (payload.publish?.previousManifest !== undefined) {
    try {
      previousManifest = JSON.parse(readFileSync(payload.publish.previousManifest, "utf8")) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitResult({
        ok: false,
        error: message,
        refusals: [{ path: "$.previousManifest", code: "invalid_json", message }]
      });
      return;
    }
  }

  try {
    const wantHtml = payload.output !== undefined;
    const wantArtifact = payload.publish !== undefined;
    const bundle = buildFocusReleaseBundle(document, {
      ...payload.options,
      includeHtml: wantHtml,
      includeArtifact: wantArtifact,
      ...(previousManifest !== undefined ? { previousManifest } : {})
    });

    let publishResult;
    let artifactBytes = 0;
    if (wantArtifact) {
      if (!bundle.artifact) {
        throw new Error("Focus artifact release bundle missing after compilation");
      }
      artifactBytes =
        Buffer.byteLength(bundle.artifact.documentJson, "utf8") +
        Buffer.byteLength(bundle.artifact.manifestJson, "utf8") +
        (bundle.artifact.viewsJson !== undefined ? Buffer.byteLength(bundle.artifact.viewsJson, "utf8") : 0);

      // Lazily load @sentropic/h2a-runtime ONLY when publishing so @sentropic/h2a stays a strict leaf package.
      const runtimePkg: string = "@sentropic/h2a-runtime";
      const runtime = (await import(runtimePkg)) as {
        publishFocusRelease?: (req: Record<string, unknown>) => Promise<{
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
        }>;
      };
      if (typeof runtime.publishFocusRelease !== "function") {
        throw new Error("@sentropic/h2a-runtime does not export publishFocusRelease");
      }
      publishResult = await runtime.publishFocusRelease({
        workspaceRoot: payload.workspaceRoot,
        bindingName: bundle.artifact.bindingName,
        documentJson: bundle.artifact.documentJson,
        manifestJson: bundle.artifact.manifestJson,
        ...(bundle.artifact.viewsJson !== undefined ? { viewsJson: bundle.artifact.viewsJson } : {}),
        idempotencyKey: payload.publish!.idempotencyKey ?? `focus:${payload.jobId}`,
        ...(payload.publish!.federation !== undefined ? { federation: payload.publish!.federation } : {}),
        ...(payload.publish!.workspaceRef !== undefined ? { workspaceRef: payload.publish!.workspaceRef } : {}),
        ...(payload.publish!.artifactId !== undefined ? { artifactId: payload.publish!.artifactId } : {}),
        ...(payload.publish!.title !== undefined ? { title: payload.publish!.title } : {}),
        ...(payload.publish!.description !== undefined ? { description: payload.publish!.description } : {}),
        ...(payload.publish!.icon !== undefined ? { icon: payload.publish!.icon } : {}),
        ...(payload.publish!.expectedCurrentReleaseId !== undefined
          ? { expectedCurrentReleaseId: payload.publish!.expectedCurrentReleaseId }
          : {}),
        profile: {
          artifactType: "focus-dossier",
          contract: "focus-dossier/1",
          templateId: "focus-dossier",
          documentDigest: bundle.artifact.documentDigest
        }
      });
    }

    let outputBytes = artifactBytes;
    if (wantHtml) {
      if (bundle.html === undefined) {
        throw new Error("Focus HTML output missing after compilation");
      }
      writeFocusArtifactFile(payload.output!, bundle.html);
      outputBytes = Buffer.byteLength(bundle.html, "utf8");
    }

    emitResult({
      ok: true,
      ...(payload.output !== undefined ? { output: payload.output } : {}),
      bytes: outputBytes,
      warnings: bundle.warnings,
      ...(publishResult !== undefined ? { publish: publishResult } : {})
    });
  } catch (error) {
    const { message, refusals } = extractFocusRefusals(error);
    emitResult({
      ok: false,
      error: message,
      refusals
    });
  }
}

void runWorker();
