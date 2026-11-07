/**
 * `h2a sentropic …` — the CLI surface of the sentropic publish client (preprod).
 *
 *   h2a sentropic login [--no-browser] [--tenant <id>] [--timeout <s>] [--no-refresh]
 *   h2a sentropic status [--json]
 *   h2a sentropic bind <workspace-id> [--verify]
 *   h2a sentropic unbind
 *   h2a sentropic logout [--local-only]
 *   h2a sentropic tools --preprod
 *
 * Named after the enrollment plan's `h2a sentropic enroll|bind|status` group
 * (docs/specs/2026-07-11-sentropic-h2a-enrollment-PLAN.md, Lot 1). `login`, not `enroll`: this
 * verb only authenticates — the runtime's top-level `enroll` is the live-session registry, and
 * the plan's enroll also covers transcript upload consent, which is not part of publishing.
 *
 * Every action runs inside one error boundary that prints a single safe line (publicErrorMessage)
 * and sets exit code 1; no stack, cause or lower-level message is ever printed.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { Command } from "commander";

import {
  bindWorkspace,
  listPublishTools,
  login,
  logout,
  readSession,
  readWorkspaceBinding,
  shortWorkspace,
  unbindWorkspace,
  type PublishRuntime,
} from "./publish-client.js";
import { PUBLISH_SCOPES } from "./oauth-pkce.js";
import { SENTROPIC_ENV_VARS, resolvePublishConfig } from "./publish-config.js";
import { SentropicPublishError, publicErrorMessage } from "./publish-errors.js";
import { resolveLocalWorkspaceId } from "./workspace-binding.js";

export interface SentropicCliDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  /** Launch a browser on `url`; false when none could be launched. */
  openBrowser: (url: string) => boolean;
  /** Results (stdout). */
  out: (text: string) => void;
  /** Progress, warnings, errors (stderr). */
  err: (text: string) => void;
  cwd: () => string;
  /** The durable ws: identity of the git workspace at `cwd`, or undefined. */
  resolveWorkspace: (cwd: string) => string | undefined;
  setExitCode: (code: number) => void;
  homeDir: () => string;
  /** The h2a version announced to the MCP server; empty = read from the runtime package. */
  clientVersion: string;
}

const PREFIX = "[h2a] sentropic:";

function runtimeVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Open `url` in the system browser, detached. The URL is the authorization request (state,
 * nonce, PKCE challenge — no secret); it is printed as the fallback either way. A missing
 * opener reports asynchronously: the error listener keeps Node from printing spawnargs.
 */
function openInSystemBrowser(url: string): boolean {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function defaultDeps(): SentropicCliDeps {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    now: () => Date.now(),
    openBrowser: openInSystemBrowser,
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
    cwd: () => process.cwd(),
    resolveWorkspace: (cwd) => resolveLocalWorkspaceId(cwd),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    homeDir: () => homedir(),
    // Resolved on first use (guarded), not at registration: registration runs on every h2a start.
    clientVersion: "",
  };
}

async function guarded(deps: SentropicCliDeps, action: (rt: PublishRuntime) => Promise<void>): Promise<void> {
  try {
    const config = resolvePublishConfig(deps.env, deps.homeDir());
    await action({
      config,
      fetch: deps.fetch,
      now: deps.now,
      log: (line) => deps.err(`${line}\n`),
      clientVersion: deps.clientVersion || runtimeVersion(),
    });
  } catch (error) {
    deps.err(`${PREFIX} ${publicErrorMessage(error)}\n`);
    deps.setExitCode(1);
  }
}

function parseTimeout(raw: string | undefined): number {
  const value = raw === undefined ? 300 : /^\d{1,4}$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!(value >= 1 && value <= 3600)) {
    throw new SentropicPublishError("usage", "--timeout must be a number of seconds between 1 and 3600");
  }
  return value;
}

function statusLines(rt: PublishRuntime, deps: SentropicCliDeps): { lines: string[]; json: Record<string, unknown> } {
  const { config } = rt;
  const session = readSession(rt);
  const local = deps.resolveWorkspace(deps.cwd());
  let binding: ReturnType<typeof readWorkspaceBinding>;
  let bindingProblem: string | undefined;
  try {
    binding = readWorkspaceBinding(rt, local);
  } catch (error) {
    bindingProblem = publicErrorMessage(error);
  }

  const row = (label: string, value: string) => `  ${label.padEnd(22)}${value}`;
  const lines = [
    `sentropic ${config.environment}`,
    row("authorization server", config.issuer),
    row("resource server", config.mcpUrl),
    row("client id", config.clientId ?? `not configured (set ${SENTROPIC_ENV_VARS.clientId})`),
  ];
  if (!session.loggedIn) {
    lines.push(row("account", "not logged in — run `h2a sentropic login`"));
  } else {
    lines.push(row("account", session.subject ?? "unknown subject"));
    lines.push(row("tenant", session.tenantId ?? "none in the token — run `h2a sentropic login --tenant <id>`"));
    if (session.expired) {
      lines.push(
        row(
          "token",
          session.refreshable
            ? `expired at ${session.expiresAt ?? "unknown"} (a refresh token is stored: the next use refreshes it)`
            : `expired at ${session.expiresAt ?? "unknown"} — run \`h2a sentropic login\``,
        ),
      );
    } else {
      lines.push(row("token", `valid until ${session.expiresAt} (refresh token: ${session.refreshable ? "yes" : "no"})`));
    }
    if (session.scope !== undefined) lines.push(row("scopes", session.scope));
    if (session.foreignIssuer) lines.push(row("warning", "the stored token comes from another authorization server — log in again"));
  }
  if (local === undefined) {
    lines.push(row("workspace", "not inside a git workspace"));
  } else if (bindingProblem !== undefined) {
    lines.push(row("workspace", `${shortWorkspace(local)}: ${bindingProblem}`));
  } else if (binding === undefined) {
    lines.push(row("workspace", `${shortWorkspace(local)} not bound — run \`h2a sentropic bind <workspace-id>\``));
  } else {
    lines.push(
      row(
        "workspace",
        `${shortWorkspace(local)} bound to ${binding.workspaceId}` +
          `${binding.tenantId ? ` (tenant ${binding.tenantId})` : ""}, ${binding.boundAt}`,
      ),
    );
    if (session.loggedIn && binding.tenantId !== undefined && session.tenantId !== undefined && binding.tenantId !== session.tenantId) {
      lines.push(row("warning", `the binding was made in tenant ${binding.tenantId}, the token is for tenant ${session.tenantId}`));
    }
    if (session.loggedIn && binding.subject !== undefined && session.subject !== undefined && binding.subject !== session.subject) {
      lines.push(row("warning", "the binding was made by another account than the one logged in"));
    }
  }

  const json: Record<string, unknown> = {
    environment: config.environment,
    issuer: config.issuer,
    mcpUrl: config.mcpUrl,
    clientId: config.clientId ?? null,
    loggedIn: session.loggedIn,
    subject: session.subject ?? null,
    tenantId: session.tenantId ?? null,
    scope: session.scope ?? null,
    expiresAt: session.expiresAt ?? null,
    expired: session.expired,
    refreshable: session.refreshable,
    localWorkspace: local ?? null,
    binding: binding === undefined ? null : { ...binding },
    bindingProblem: bindingProblem ?? null,
  };
  return { lines, json };
}

/** Register `h2a sentropic` on `program`. `overrides` replace the process-bound defaults (tests). */
export function registerSentropicCommand(program: Command, overrides: Partial<SentropicCliDeps> = {}): Command {
  const deps: SentropicCliDeps = { ...defaultDeps(), ...overrides };
  const sentropic = program
    .command("sentropic")
    .description("Sign in to sentropic (preprod), bind this workspace, and check the publish path");

  sentropic
    .command("login")
    .description("Sign in through the browser (OAuth authorization code + PKCE, 127.0.0.1 loopback redirect)")
    .option("--no-browser", "print the sign-in URL instead of opening a browser")
    .option("--tenant <id>", "the sentropic organization (tid) to sign in to, for an account in several")
    .option("--timeout <seconds>", "how long to wait for the browser sign-in (default 300)")
    .option("--no-refresh", "do not ask for a refresh token even when the server offers one")
    .action((opts: { browser: boolean; tenant?: string; timeout?: string; refresh: boolean }) =>
      guarded(deps, async (rt) => {
        const timeoutSeconds = parseTimeout(opts.timeout);
        const browser = opts.browser && deps.env.H2A_NO_BROWSER !== "1" ? deps.openBrowser : undefined;
        const result = await login(rt, {
          openBrowser: browser,
          ...(opts.tenant !== undefined ? { tenant: opts.tenant } : {}),
          timeoutSeconds,
          refresh: opts.refresh,
        });
        const who = result.email !== undefined ? `${result.email} (account ${result.subject})` : `account ${result.subject}`;
        rt.log(`${PREFIX} signed in as ${who}${result.tenantId !== undefined ? `, tenant ${result.tenantId}` : ""}`);
        rt.log(
          `${PREFIX} token valid until ${result.expiresAt}; ` +
            (result.refreshable
              ? "a refresh token is stored and rotated on every refresh"
              : "no refresh token: run `h2a sentropic login` again when it expires"),
        );
        if (result.tenantId === undefined) {
          rt.log(
            `${PREFIX} warning: the token carries no tenant (tid), and the MCP resource server refuses such a token; ` +
              "an account in several organizations must pick one: `h2a sentropic login --tenant <id>`",
          );
        }
        if (result.grantedScope !== undefined) {
          const granted = new Set(result.grantedScope.split(" ").filter(Boolean));
          const missing = PUBLISH_SCOPES.filter((scope) => !granted.has(scope));
          if (missing.length > 0) {
            rt.log(
              `${PREFIX} warning: ${missing.join(" ")} ${missing.length === 1 ? "was" : "were"} not granted: ` +
                "the resource server will refuse what needs it (the h2a-cli client must be allowed the MCP scopes)",
            );
          }
        }
      }),
    );

  sentropic
    .command("status")
    .description("Show the sentropic account, tenant, token expiry and this workspace's binding (never the token)")
    .option("--json", "machine-readable output")
    .action((opts: { json?: boolean }) =>
      guarded(deps, async (rt) => {
        const { lines, json } = statusLines(rt, deps);
        deps.out(opts.json ? `${JSON.stringify(json, null, 2)}\n` : `${lines.join("\n")}\n`);
      }),
    );

  sentropic
    .command("bind <workspace-id>")
    .description("Bind this local workspace to one sentropic workspace (explicit id, recorded locally)")
    .option("--verify", "first ask the preprod MCP resource server whether it accepts this workspace")
    .action((workspaceId: string, opts: { verify?: boolean }) =>
      guarded(deps, async (rt) => {
        const binding = await bindWorkspace(rt, {
          localWorkspace: deps.resolveWorkspace(deps.cwd()),
          workspaceId,
          verify: opts.verify === true,
        });
        rt.log(
          `${PREFIX} bound ${shortWorkspace(binding.localWorkspace)} to sentropic workspace ${binding.workspaceId}` +
            (opts.verify === true ? " (accepted by the resource server)" : " (not verified: `--verify` asks the resource server)"),
        );
      }),
    );

  sentropic
    .command("unbind")
    .description("Remove this local workspace's sentropic binding")
    .action(() =>
      guarded(deps, async (rt) => {
        const removed = unbindWorkspace(rt, deps.resolveWorkspace(deps.cwd()));
        rt.log(removed ? `${PREFIX} binding removed` : `${PREFIX} this workspace was not bound`);
      }),
    );

  sentropic
    .command("logout")
    .description("Revoke the token on the authorization server when it offers revocation, then remove it locally")
    .option("--local-only", "only remove the local token; do not call the authorization server")
    .action((opts: { localOnly?: boolean }) =>
      guarded(deps, async (rt) => {
        const result = await logout(rt, { localOnly: opts.localOnly === true });
        if (!result.wasLoggedIn) {
          rt.log(`${PREFIX} not logged in`);
          return;
        }
        if (result.server === "revoked") rt.log(`${PREFIX} token revoked on the authorization server`);
        rt.log(`${PREFIX} logged out (local token removed)`);
      }),
    );

  sentropic
    .command("tools")
    .description("Probe the publish path: MCP tools/list on the preprod resource server with the stored token")
    .option("--preprod", "confirm the call to the live sentropic preprod MCP resource server")
    .action((opts: { preprod?: boolean }) =>
      guarded(deps, async (rt) => {
        if (opts.preprod !== true) {
          throw new SentropicPublishError(
            "usage",
            "this probe calls the live sentropic preprod MCP resource server; pass --preprod to confirm",
          );
        }
        if (rt.config.environment !== "preprod") {
          throw new SentropicPublishError("usage", "the MCP probe is limited to sentropic preprod");
        }
        const { tools, workspaceId } = await listPublishTools(rt, deps.resolveWorkspace(deps.cwd()));
        deps.out(tools.map((name) => `${name}\n`).join(""));
        rt.log(
          `${PREFIX} ${tools.length} tools on ${rt.config.mcpUrl} for ` +
            (workspaceId !== undefined ? `workspace ${workspaceId}` : "the account's default workspace (this workspace is not bound)"),
        );
      }),
    );

  return sentropic;
}
