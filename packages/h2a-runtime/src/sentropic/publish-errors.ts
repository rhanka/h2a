/**
 * Errors of the sentropic publish client.
 *
 * Every message is fixed text plus values the client itself decided are fit to show: URLs and
 * names from configuration, ISO dates, the non-secret claims a human reads in `status` (sub,
 * tid, scope), and OAuth/MCP error CODES filtered through {@link safeErrorCode}. A message never
 * carries a token, an authorization code, a code verifier, a server response body, an
 * error_description, nor the text of a lower-level error — V8's JSON.parse SyntaxError quotes
 * the bytes it failed on, and a fetch failure can quote a URL that holds a code.
 */

import { AuthFileConcurrentWriteError, DamagedAuthFileError } from "./auth-token.js";

export type SentropicPublishErrorCode =
  | "config"
  | "usage"
  | "discovery"
  | "authorization"
  | "callback"
  | "timeout"
  | "token"
  | "id_token"
  | "login_required"
  | "binding"
  | "workspace_access"
  | "mcp";

export class SentropicPublishError extends Error {
  constructor(readonly code: SentropicPublishErrorCode, message: string) {
    super(message);
    this.name = "SentropicPublishError";
  }
}

/** The sentropic session is over (absent, expired, refused refresh, revoked): log in again. */
export class SentropicLoginRequiredError extends SentropicPublishError {
  constructor(reason: string) {
    super("login_required", `${reason}; run \`h2a sentropic login\``);
    this.name = "SentropicLoginRequiredError";
  }
}

/**
 * The resource server will not let this account use the bound workspace NOW, whatever the bind
 * recorded: the membership or the role changed since (the server re-checks at every call; the
 * `publishable` flag of workspaces_list is only a hint, and no list is ever cached).
 */
export class SentropicWorkspaceAccessError extends SentropicPublishError {
  constructor(readonly workspaceRef: string, reason: "access_denied" | "no_tools") {
    const head =
      reason === "access_denied"
        ? `the resource server refused workspace ${workspaceRef} (access_denied)`
        : `the resource server lists no publish tool for workspace ${workspaceRef}`;
    super(
      "workspace_access",
      `${head}: this account cannot use it now (the server re-checks at every call, whatever the bind recorded); ` +
        "run `h2a sentropic workspaces` to list the workspaces it can publish to, then `h2a sentropic bind <workspace-id>`",
    );
    this.name = "SentropicWorkspaceAccessError";
  }
}

/** RFC 6749 §5.2 error codes are printable ASCII without quotes; ours stay short and plain. */
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * An OAuth / MCP error CODE fit to print, or "unrecognized". Only the code is ever shown — an
 * error_description (or an MCP error message that is not a plain code) is server-chosen text
 * and may echo the very token that was refused.
 */
export function safeErrorCode(value: unknown): string {
  return typeof value === "string" && ERROR_CODE.test(value) ? value : "unrecognized";
}

/**
 * The one line the CLI prints for a failure. Our own errors and the token store's typed
 * refusals (whose messages carry a file path only) are shown as is; anything else is named by
 * its class alone, so an unexpected lower-level message can never leak what it quotes.
 */
export function publicErrorMessage(error: unknown): string {
  if (error instanceof SentropicPublishError) return error.message;
  if (error instanceof DamagedAuthFileError || error instanceof AuthFileConcurrentWriteError) {
    return error.message;
  }
  // assertServerBound (auth-token.ts): fixed text + two server keys (scheme://host).
  if (error instanceof Error && error.message.startsWith("sentropic auth: token is bound to ")) {
    return error.message;
  }
  const name = error instanceof Error ? error.name : typeof error;
  return `unexpected internal error (${name})`;
}
