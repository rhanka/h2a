// cli-seat-codecs.ts
//
// Per-host codecs for the five CLI seats (L2-s, synthetic only).
//
// REUSE (read, not duplicated):
// - PR #327 (origin/pr-327): claude-seat-input.ts (no secret-bearing
//   argv/env/MCP interfaces), claude-code-cli-isolation.ts (private 0700 run
//   root, 0600 credential files, symlink refusal, XDG_RUNTIME_DIR base),
//   llm-mesh-accounts.ts (source-mode vocabulary).
// - origin/feat/live-cross-cli-messaging scripts/xcli-lab.mjs: the documented
//   auth-only file map (authFiles), the per-CLI interactive host args
//   (argsFor), the allowlisted qualification environment shape, and cleanup
//   discipline. copyLogin is REPLACED by seat materialization below: nothing
//   here ever copies an owner's live store; only synthetic stand-ins are
//   written, into disposable temp dirs owned by the test.
//
// Every payload this module writes is synthetic. Native profile variants,
// access-only acceptance and tool enforceability stay UNVERIFIED until the
// live probes (P-NOREFRESH/P-STREAM/P-TOOLS); the `notes` fields record that.

import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SeatCli5 } from "./cli-seat-fixtures.js";
import { SEAT_CLIS_5 } from "./cli-seat-fixtures.js";

export type ProjectedNativeMode = "access-only" | "static-key";

export interface CliSeatCodec {
  readonly cli: SeatCli5;
  readonly packageProviderId: string;
  /** Auth-only files relative to the isolated HOME (lab authFiles map, gemini excluded). */
  readonly homeRelAuthFiles: readonly string[];
  /** Auth-only files relative to the isolated config dir (CLAUDE_CONFIG_DIR / XDG_CONFIG_HOME). */
  readonly configRelAuthFiles: readonly string[];
  /** Credential env vars in precedence order; empty means file-only. */
  readonly credentialEnvVars: readonly string[];
  /** Isolated home/config selector env var for this CLI. */
  readonly homeEnvVar: string;
  /** Non-secret MCP config hint (production rendering stays in packages/h2a/src/hosts/*). */
  readonly mcpConfigExample: string;
  /** Non-secret per-host launch args (lab argsFor minus prompt, gateway-off). */
  readonly hostArgs: readonly string[];
  /** h2a MCP scenario operations allowed for this seat. */
  readonly toolAllow: readonly string[];
  /** Tool families denied for this seat (§6.1). */
  readonly toolDeny: readonly string[];
  /** Synthetic projection assumption; live qualification pending (P-NOREFRESH/P-STREAM). */
  readonly projectedNativeMode: ProjectedNativeMode;
  readonly notes: string;
}

const SCENARIO_OPS = ["h2a.message", "h2a.unavailable", "h2a.loop", "h2a.negotiation"] as const;

const PACKAGE_PROVIDER_ID: Record<SeatCli5, string> = {
  agy: "cloud-code",
  codex: "codex",
  vibe: "mistral-vibe",
  muse: "muse",
  claude: "claude-code",
};

export const CLI_SEAT_CODECS: Record<SeatCli5, CliSeatCodec> = {
  claude: {
    cli: "claude",
    packageProviderId: PACKAGE_PROVIDER_ID["claude"],
    homeRelAuthFiles: [],
    configRelAuthFiles: [".credentials.json"],
    credentialEnvVars: ["CLAUDE_CODE_OAUTH_TOKEN"],
    homeEnvVar: "CLAUDE_CONFIG_DIR",
    mcpConfigExample: "~/.claude.json",
    hostArgs: ["--tools", ""],
    toolAllow: [...SCENARIO_OPS],
    toolDeny: ["builtin-tools", "user-hooks", "project-hooks", "extra-plugins", "shell.exec", "file.read"],
    projectedNativeMode: "access-only",
    notes: "access-only candidate: CLAUDE_CODE_OAUTH_TOKEN or access/expiry/scopes file without refresh; UNVERIFIED P-NOREFRESH",
  },
  codex: {
    cli: "codex",
    packageProviderId: PACKAGE_PROVIDER_ID["codex"],
    homeRelAuthFiles: [".codex/auth.json"],
    configRelAuthFiles: [],
    credentialEnvVars: [],
    homeEnvVar: "CODEX_HOME",
    mcpConfigExample: "~/.codex/config.toml",
    hostArgs: ["--no-daemon", "--no-alt-screen"],
    toolAllow: [...SCENARIO_OPS],
    toolDeny: ["shell.exec", "file.read", "computer-use", "browser.open", "network.fetch"],
    projectedNativeMode: "access-only",
    notes: "access-only candidate: disposable auth.json without refresh_token, genuine last_refresh; UNVERIFIED P-NOREFRESH",
  },
  muse: {
    cli: "muse",
    packageProviderId: PACKAGE_PROVIDER_ID["muse"],
    homeRelAuthFiles: [],
    configRelAuthFiles: ["muse/auth.json"],
    credentialEnvVars: ["META_API_KEY"],
    homeEnvVar: "XDG_CONFIG_HOME",
    mcpConfigExample: "~/.config/muse/settings.json",
    hostArgs: ["--no-session-log"],
    toolAllow: [...SCENARIO_OPS],
    toolDeny: ["shell.exec", "file.read", "env.inspect", "browser.open", "extra-plugins"],
    projectedNativeMode: "access-only",
    notes: "access-only candidate: providers.meta + current access_token, renewal fields removed; UNVERIFIED P-MUSE/P-NOREFRESH",
  },
  vibe: {
    cli: "vibe",
    packageProviderId: PACKAGE_PROVIDER_ID["vibe"],
    homeRelAuthFiles: [],
    configRelAuthFiles: ["vibe/.env"],
    credentialEnvVars: ["MISTRAL_API_KEY"],
    homeEnvVar: "VIBE_HOME",
    mcpConfigExample: "~/.vibe/config.toml",
    hostArgs: [],
    toolAllow: [...SCENARIO_OPS],
    toolDeny: ["shell.exec", "file.read", "network.fetch", "extra-plugins"],
    projectedNativeMode: "static-key",
    notes: "static-key class: MISTRAL_API_KEY child env or private .vibe/.env; no refresh endpoint; expiry class UNVERIFIED P-VIBE",
  },
  agy: {
    cli: "agy",
    packageProviderId: PACKAGE_PROVIDER_ID["agy"],
    homeRelAuthFiles: [],
    configRelAuthFiles: [],
    credentialEnvVars: [],
    homeEnvVar: "HOME",
    mcpConfigExample: "~/.gemini/config/mcp_config.json",
    hostArgs: ["--prompt-interactive"],
    toolAllow: [...SCENARIO_OPS],
    toolDeny: ["terminal.builtin", "file.builtin", "network.builtin", "extra-plugins", "keyring.read", "env.inspect"],
    projectedNativeMode: "access-only",
    notes: "access-only candidate: minimal keyring profile with current access/expiry, nonrenewing metadata; ADC/API-key env stripped; UNVERIFIED P-AGY/P-NOREFRESH",
  },
};

/** Every CLI in the five-seat circuit; gemini is explicitly not a member. */
export function listCliSeatCodecs(): CliSeatCodec[] {
  return SEAT_CLIS_5.map((cli) => CLI_SEAT_CODECS[cli]);
}

/** Unknown names (including gemini) fail closed with a static error. */
export function getCliSeatCodec(cli: string): CliSeatCodec {
  const codec = (CLI_SEAT_CODECS as Record<string, CliSeatCodec>)[cli];
  if (!Object.hasOwn(CLI_SEAT_CODECS, cli) || codec === undefined) {
    throw new Error("unknown CLI seat: not part of the five-seat circuit");
  }
  return codec;
}

/** Shared CLI aliases; product enrollment still uses package provider ids. */
export function resolveSeatEnrollmentProvider(value: string): "cloud-code" | "codex" | "mistral-vibe" | "muse" | "claude-code" {
  const cli = value === "cloud-code" ? "agy" : value === "claude-code" ? "claude" : value === "mistral-vibe" ? "vibe" : value;
  return getCliSeatCodec(cli).packageProviderId as "cloud-code" | "codex" | "mistral-vibe" | "muse" | "claude-code";
}

/** Credential-bearing env vars stripped from (or never injected into) seat jobs. */
export const CREDENTIAL_ENV_VARS: readonly string[] = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "MISTRAL_API_KEY",
  "META_API_KEY",
];

/** ADC/API-key overrides that must never reach an agy seat child (§5.1). */
export const AGY_STRIPPED_ENV_VARS: readonly string[] = [
  "AGY_ADC_AUTH",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
];

export interface CredentialPrecedence {
  winner: "env" | "file";
  via?: string;
}

/** Per-CLI credential precedence: env override wins where the CLI defines one. */
export function resolveCredentialPrecedence(
  cli: SeatCli5,
  env: Readonly<Record<string, string | undefined>>,
): CredentialPrecedence {
  const codec = getCliSeatCodec(cli);
  for (const name of codec.credentialEnvVars) {
    if (env[name] !== undefined && env[name] !== "") {
      return { winner: "env", via: name };
    }
  }
  return { winner: "file" };
}

/** Absolute credential paths for an isolated home/config pair (pure). */
export function credentialFilePaths(
  cli: SeatCli5,
  locations: { homeDir: string; configDir: string },
): string[] {
  const codec = getCliSeatCodec(cli);
  return [
    ...codec.homeRelAuthFiles.map((rel) => join(locations.homeDir, rel)),
    ...codec.configRelAuthFiles.map((rel) => join(locations.configDir, rel)),
  ];
}

/** h2a-only MCP manifest for a seat (synthetic; vendor merge is live work). */
export function renderSeatMcpManifest(cli: SeatCli5): {
  config: { mcpServers: { h2a: { command: string; args: string[] } } };
  path: { example: string };
} {
  const codec = getCliSeatCodec(cli);
  return {
    config: { mcpServers: { h2a: { command: process.execPath, args: [fileURLToPath(new URL("../../h2a/dist/bin.js", import.meta.url)), "mcp-serve"] } } },
    path: { example: codec.mcpConfigExample },
  };
}

/** Refuse symlinks in every existing path component, including ancestors. */
export function assertNoSymlinkPath(path: string): void {
  if (!isAbsolute(path)) throw new Error("private path must be absolute");
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("private path refused: symbolic link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function ensurePrivateSeatDirectory(path: string): void {
  assertNoSymlinkPath(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || (process.geteuid && stat.uid !== process.geteuid())) {
    throw new Error("private directory refused: ownership or permissions");
  }
}

export function writePrivateSeatFile(path: string, content: string): void {
  ensurePrivateSeatDirectory(dirname(path));
  assertNoSymlinkPath(path);
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeFileSync(fd, content, { encoding: "utf8" }); } finally { closeSync(fd); }
}

export function readPrivateSeatFile(path: string): string {
  assertNoSymlinkPath(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || (process.geteuid && stat.uid !== process.geteuid())) throw new Error("private file refused");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}

/** Render at each native selector, rather than an invented environment hint. */
export function writeSeatMcpConfiguration(cli: SeatCli5, locations: { homeDir: string; configDir: string }, env: Record<string, string> = {}): string {
  const server = { ...renderSeatMcpManifest(cli).config.mcpServers.h2a, env };
  const envToml = Object.entries(env).map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`).join("\n") + "\n";
  let path: string;
  let content: string;
  if (cli === "codex") {
    path = join(locations.homeDir, ".codex/config.toml");
    content = `[mcp_servers.h2a]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`;
    content += `[mcp_servers.h2a.env]\n${envToml}`;
  } else if (cli === "vibe") {
    path = join(locations.configDir, "vibe/config.toml");
    content = `[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`;
    content += `env = { ${Object.entries(env).map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`).join(", ")} }\n`;
  } else {
    path = cli === "claude" ? join(locations.configDir, ".claude.json") : cli === "muse" ? join(locations.configDir, "muse/settings.json") : join(locations.homeDir, ".gemini/config/mcp_config.json");
    content = JSON.stringify({ ...(cli === "claude" ? { hasCompletedOnboarding: true } : {}), mcpServers: { h2a: server } }) + "\n";
  }
  writePrivateSeatFile(path, content);
  return path;
}

/**
 * Write synthetic credential stand-ins (canary-bearing) into an isolated
 * home/config pair. Replaces lab copyLogin: no owner store is ever read.
 */
export interface SyntheticCredentialMaterial {
  kind: "renewable" | "access-only" | "static-key";
  materialRef: string;
}

export function writeSyntheticCredentialFiles(
  cli: SeatCli5,
  locations: { homeDir: string; configDir: string; canary: string; material?: SyntheticCredentialMaterial },
): string[] {
  const paths = credentialFilePaths(cli, locations);
  // References are invented payloads in L2-s, never resolved from a live store.
  const canary = locations.material ? `${locations.canary}:${locations.material.materialRef}` : locations.canary;
  const renewable = locations.material?.kind === "renewable";
  if (cli === "claude") {
    writePrivateSeatFile(
      paths[0] as string,
      JSON.stringify({ claudeAiOauth: { accessToken: canary, ...(renewable ? { refreshToken: canary } : {}), expiresAt: 1792195200000, scopes: ["user:inference"] } }) + "\n",
    );
  } else if (cli === "codex") {
    writePrivateSeatFile(
      paths[0] as string,
      JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: canary, ...(renewable ? { refresh_token: canary } : {}), id_token: `synthetic-id-${canary}`, account_id: "synthetic-account" }, last_refresh: "2026-10-15T00:00:00.000Z" }) + "\n",
    );
  } else if (cli === "muse") {
    writePrivateSeatFile(
      paths[0] as string,
      JSON.stringify({ schema_version: 1, providers: { meta: { access_token: canary, ...(renewable ? { refresh_token: canary } : {}) } } }) + "\n",
    );
  } else if (cli === "vibe") {
    writePrivateSeatFile(paths[0] as string, `MISTRAL_API_KEY=${canary}\n`);
  }
  return paths;
}
