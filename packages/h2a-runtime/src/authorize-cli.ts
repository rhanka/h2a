/**
 * `h2a authorize` — owner-only one-shot human authorization CLI for
 * `central-stop` and `central-compact` (Lot 1.1+1.2, Q2 point 2).
 *
 * Strictly restricted to interactive owner terminals outside any h2a session
 * or h2a-shell (Layer 2 via `assertOwnerTerminalAccess(..., "authorize")`, plus
 * Layer 1 in `bin.ts`). Stores NO plaintext secrets on disk, in stdout/stderr,
 * in argv/env, or in audit logs.
 */

import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

import type { Command } from "commander";

import {
  isCanonicalOwnerGrantLogin,
  isOwnerGrantAct,
  issueOwnerGrant,
  listOwnerGrants,
  parseOwnerGrantTtlMs,
  purgeStaleOwnerGrants,
  revokeOwnerGrant,
  sanitizeOwnerGrantReason,
  type OwnerGrant,
  type OwnerGrantAct,
} from "./owner-grants.js";
import {
  listSessionFiches,
  resolveSessionRuntimeDir,
} from "./session-auth.js";
import {
  assertOwnerTerminalAccess,
  type TrustCliDeps,
} from "./trust-cli.js";

export interface AuthorizeCliDeps extends TrustCliDeps {
  readonly sessionRuntimeDir?: string | undefined;
  readonly isolatedTmpRoot?: string | undefined;
  readonly now?: () => number;
}

function resolveStateAuditPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const xdg = env["XDG_STATE_HOME"]?.trim();
  const home = env["HOME"]?.trim() || homedir();
  const stateBase = xdg && xdg.length > 0 ? xdg : join(home, ".local", "state");
  return join(stateBase, "h2a", "cli-identity-audit.jsonl");
}

function appendAuthorizeAudit(
  record: Record<string, unknown>,
  env: Readonly<Record<string, string | undefined>>,
  stderr: (chunk: string) => void,
): void {
  const auditPath = resolveStateAuditPath(env);
  try {
    mkdirSync(dirname(auditPath), { recursive: true, mode: 0o700 });
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(auditPath, 0o600);
    } catch {
      /* best effort */
    }
  } catch {
    stderr(`[h2a-audit-fallback] ${JSON.stringify(record)}\n`);
  }
}

function defaultAuthorizePrompt(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(prompt).finally(() => rl.close());
}

function resolveAuthorizeRuntimeDir(
  deps: AuthorizeCliDeps,
  createIfMissing: boolean,
): string {
  return resolveSessionRuntimeDir({
    env: deps.env,
    sessionRuntimeDir: deps.sessionRuntimeDir,
    isolatedTmpRoot: deps.isolatedTmpRoot,
    createIfMissing,
  }).dir;
}

function summarizeGrantForOutput(grant: OwnerGrant): Record<string, unknown> {
  return {
    grantId: grant.grantId,
    act: grant.act,
    actorId: grant.actorId,
    issuedAt: new Date(grant.issuedAt).toISOString(),
    expiresAt: new Date(grant.expiresAt).toISOString(),
    ...(grant.reason !== undefined ? { reason: grant.reason } : {}),
  };
}

export async function runAuthorizeIssueCommand(
  actRaw: string,
  options: {
    readonly for?: string | undefined;
    readonly ttl?: string | undefined;
    readonly reason?: string | undefined;
    readonly json?: boolean | undefined;
  },
  deps: AuthorizeCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const promptLine = deps.promptLine ?? defaultAuthorizePrompt;
  const nowFn = deps.now ?? Date.now;

  // Validate owner terminal BEFORE reading/mutating runtime state.
  assertOwnerTerminalAccess(deps, "authorize");

  if (!isOwnerGrantAct(actRaw)) {
    stderr(
      `[h2a authorize] unsupported act "${actRaw}": allowed acts are central-stop, central-compact.\n`,
    );
    return 1;
  }
  const act: OwnerGrantAct = actRaw;

  const actorId = options.for?.trim() ?? "";
  if (!actorId || !isCanonicalOwnerGrantLogin(actorId)) {
    stderr(
      `[h2a authorize] --for <login> is required and must be a canonical login (<host>:<slug>:<uuid12>, got "${options.for ?? ""}").\n`,
    );
    return 1;
  }

  const ttlParsed = parseOwnerGrantTtlMs(options.ttl);
  if (!ttlParsed.ok) {
    stderr(`[h2a authorize] ${ttlParsed.error}\n`);
    return 1;
  }

  const reasonParsed = sanitizeOwnerGrantReason(options.reason);
  if (!reasonParsed.ok) {
    stderr(`[h2a authorize] ${reasonParsed.error}\n`);
    return 1;
  }

  const runtimeDir = resolveAuthorizeRuntimeDir(deps, true);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  purgeStaleOwnerGrants(runtimeDir, { now: nowFn(), expectedUid: uid });

  // NB-8: warn if no active session fiche matches `--for` (catch typos, while noting subagents share login).
  const activeFiches = listSessionFiches(runtimeDir, uid);
  if (!activeFiches.some((f) => f.actorId === actorId)) {
    stderr(
      `[h2a authorize] warning: no active session fiche currently matches ${actorId}; verify spelling (grant applies to that login and its in-process subagents).\n`,
    );
  }
  if (reasonParsed.reason !== undefined) {
    stderr(
      `[h2a authorize] note: --reason text is visible in process argv and recorded in the identity audit log.\n`,
    );
  }

  const nowMs = nowFn();
  const expiresIso = new Date(nowMs + ttlParsed.ttlMs).toISOString();
  stdout(
    `Act:    ${act}\n` +
      `Target: ${actorId} (single-use scope for this login and its in-process subagents)\n` +
      `TTL:    ${Math.round(ttlParsed.ttlMs / 1000)}s (expires ${expiresIso})\n`,
  );
  if (reasonParsed.reason !== undefined) {
    stdout(`Reason: ${reasonParsed.reason}\n`);
  }

  const reply = (
    await promptLine(`Type "${act}" to authorize one execution of ${act}: `)
  ).trim();
  if (reply !== act) {
    stderr(`[h2a authorize] confirmation mismatch (expected "${act}"); aborted with no changes.\n`);
    return 1;
  }

  const grant = issueOwnerGrant(runtimeDir, {
    act,
    actorId,
    ttlMs: ttlParsed.ttlMs,
    reason: reasonParsed.reason,
    issuerPid: process.pid,
    issuerTty: process.stdin.isTTY ? "tty" : null,
    now: nowMs,
    expectedUid: uid,
  });

  appendAuthorizeAudit(
    {
      at: new Date(nowMs).toISOString(),
      stage: "cli",
      outcome: "allowed",
      reasonCode: "owner-grant-issued",
      verificationMode: "owner",
      codexThreadAudit: null,
      grantId: grant.grantId,
      grantAct: grant.act,
      claimedLogin: grant.actorId,
      verifiedLogin: null,
      sessionKey: null,
      host: null,
      sessionClass: null,
      delegatorInstance: null,
      commandVerb: "authorize",
      callerPid: process.pid,
      leaderPid: null,
      scopeUnit: null,
      isTty: true,
    },
    env,
    stderr,
  );

  if (options.json) {
    stdout(`${JSON.stringify({ ok: true, grant: summarizeGrantForOutput(grant) }, null, 2)}\n`);
  } else {
    stdout(
      `[h2a authorize] issued one-shot grant ${grant.grantId} for ${grant.act} (--for ${grant.actorId}, expires ${new Date(grant.expiresAt).toISOString()}).\n`,
    );
  }
  return 0;
}

export async function runAuthorizeListCommand(
  options: { readonly json?: boolean | undefined } = {},
  deps: AuthorizeCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const nowFn = deps.now ?? Date.now;
  assertOwnerTerminalAccess(deps, "authorize");

  const runtimeDir = resolveAuthorizeRuntimeDir(deps, false);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const grants = listOwnerGrants(runtimeDir, {
    now: nowFn(),
    expectedUid: uid,
    purgeExpired: true,
  });

  if (options.json) {
    stdout(
      `${JSON.stringify({ ok: true, grants: grants.map(summarizeGrantForOutput) }, null, 2)}\n`,
    );
    return 0;
  }
  if (grants.length === 0) {
    stdout("[h2a authorize] no active owner authorizations.\n");
    return 0;
  }
  stdout(`Active owner authorizations (${grants.length}):\n`);
  for (const g of grants) {
    stdout(
      `  ${g.grantId}  ${g.act}  for=${g.actorId}  expires=${new Date(g.expiresAt).toISOString()}` +
        `${g.reason !== undefined ? `  reason=${JSON.stringify(g.reason)}` : ""}\n`,
    );
  }
  return 0;
}

export async function runAuthorizeRevokeCommand(
  grantId: string,
  options: { readonly json?: boolean | undefined } = {},
  deps: AuthorizeCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const nowFn = deps.now ?? Date.now;

  assertOwnerTerminalAccess(deps, "authorize");
  const runtimeDir = resolveAuthorizeRuntimeDir(deps, false);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  purgeStaleOwnerGrants(runtimeDir, { now: nowFn(), expectedUid: uid });

  const revoked = revokeOwnerGrant(runtimeDir, grantId, { expectedUid: uid });
  if (!revoked.ok) {
    stderr(
      `[h2a authorize] cannot revoke "${grantId}" (${revoked.reason}).\n`,
    );
    return revoked.reason === "invalid-id" ? 1 : 2;
  }

  appendAuthorizeAudit(
    {
      at: new Date(nowFn()).toISOString(),
      stage: "cli",
      outcome: "allowed",
      reasonCode: "owner-grant-revoked",
      verificationMode: "owner",
      codexThreadAudit: null,
      grantId: revoked.revoked.grantId,
      grantAct: revoked.revoked.act,
      claimedLogin: revoked.revoked.actorId,
      verifiedLogin: null,
      sessionKey: null,
      host: null,
      sessionClass: null,
      delegatorInstance: null,
      commandVerb: "authorize",
      callerPid: process.pid,
      leaderPid: null,
      scopeUnit: null,
      isTty: true,
    },
    env,
    stderr,
  );

  if (options.json) {
    stdout(
      `${JSON.stringify({ ok: true, revoked: summarizeGrantForOutput(revoked.revoked) }, null, 2)}\n`,
    );
  } else {
    stdout(
      `[h2a authorize] revoked grant ${revoked.revoked.grantId} (${revoked.revoked.act} for ${revoked.revoked.actorId}).\n`,
    );
  }
  return 0;
}

export function registerAuthorizeCommand(
  program: Command,
  deps: AuthorizeCliDeps = {},
): void {
  const authorize = program
    .command("authorize")
    .description(
      "Owner-only one-shot authorizations for central stop and central compact (interactive TTY only).",
    );

  authorize
    .command("list")
    .description("List active one-shot owner authorizations (no secrets)")
    .option("--json", "output JSON summary")
    .action(async (opts: { json?: boolean }) => {
      try {
        process.exitCode = await runAuthorizeListCommand(opts, deps);
      } catch (err) {
        process.stderr.write(
          `[h2a authorize] ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 2;
      }
    });

  authorize
    .command("revoke <grantId>")
    .description("Revoke a pending one-shot owner authorization before use")
    .option("--json", "output JSON result")
    .action(async (grantId: string, opts: { json?: boolean }) => {
      try {
        process.exitCode = await runAuthorizeRevokeCommand(grantId, opts, deps);
      } catch (err) {
        process.stderr.write(
          `[h2a authorize] ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 2;
      }
    });

  for (const act of ["central-stop", "central-compact"] as const) {
    authorize
      .command(act)
      .description(`Issue a one-shot owner authorization for h2a ${act.replace("-", " ")}`)
      .requiredOption("--for <login>", "canonical target agent login (<host>:<slug>:<uuid12>)")
      .option("--ttl <duration>", "grant lifetime between 10s and 15m (default 5m)")
      .option("--reason <text>", "optional audit note (visible in argv and audit log)")
      .option("--json", "output JSON result")
      .action(
        async (opts: { for?: string; ttl?: string; reason?: string; json?: boolean }) => {
          try {
            process.exitCode = await runAuthorizeIssueCommand(act, opts, deps);
          } catch (err) {
            process.stderr.write(
              `[h2a authorize] ${err instanceof Error ? err.message : String(err)}\n`,
            );
            process.exitCode = 2;
          }
        },
      );
  }
}
