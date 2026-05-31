/**
 * Drumbeat D4 cross-host resume request body. The remote transport remains a
 * delivery sink: one host drops this envelope into the remote host's inbox,
 * then the remote host consumes it and relances locally with its own adapters.
 */

export const H2A_DRUMBEAT_RESUME_BODY_KIND = "drumbeat.resume" as const;

export interface H2ADrumbeatResumeBody {
  readonly kind: typeof H2A_DRUMBEAT_RESUME_BODY_KIND;
  readonly target: string;
  readonly reason: string;
  readonly requestedBy: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Total parser: malformed, unknown, or incomplete bodies return undefined. */
export function parseDrumbeatResumeBody(value: unknown): H2ADrumbeatResumeBody | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== H2A_DRUMBEAT_RESUME_BODY_KIND) return undefined;
  if (typeof value.target !== "string") return undefined;
  if (typeof value.reason !== "string") return undefined;
  if (typeof value.requestedBy !== "string") return undefined;
  return {
    kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
    target: value.target,
    reason: value.reason,
    requestedBy: value.requestedBy
  };
}
