import type { DiagramViewRefusal } from "../../focus-build.js";

export interface FocusExtractedRefusal {
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

/** Extract structured validation, diagram geometry, path or publish refusals into a uniform envelope. */
export function extractFocusRefusals(error: unknown): {
  readonly message: string;
  readonly refusals: FocusExtractedRefusal[];
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === "object") {
    const maybeIssues = (error as { issues?: unknown }).issues;
    if (Array.isArray(maybeIssues) && maybeIssues.length > 0) {
      const refusals: FocusExtractedRefusal[] = maybeIssues.map((entry) => {
        const issue = entry as { path?: unknown; code?: unknown; message?: unknown };
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
          ? (error as { sectionId: string }).sectionId
          : undefined;
      const refusals: FocusExtractedRefusal[] = (maybeDiagnostics as readonly DiagramViewRefusal[]).map((d) => ({
        code: d.code,
        ...(sectionId !== undefined ? { sectionId } : {}),
        slot: d.slot,
        entityId: d.entityId,
        neededPx: d.neededPx,
        allocatedPx: d.allocatedPx,
        ...(d.text !== undefined ? { text: d.text } : {}),
        message: `${d.code} ${d.slot} ${d.entityId} needed ${d.neededPx}px > ${d.allocatedPx}px${
          d.text === undefined ? "" : ` « ${d.text} »`
        }`
      }));
      return { message, refusals };
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return { message, refusals: [{ code, message }] };
    }
  }
  return { message, refusals: [{ code: "build_refused", message }] };
}
