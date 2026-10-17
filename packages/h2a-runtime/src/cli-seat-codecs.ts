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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
    homeRelAuthFiles: [".claude/.credentials.json"],
    configRelAuthFiles: [".claude.json"],
    credentialEnvVars: ["CLAUDE_CODE_OAUTH_TOKEN"],
    homeEnvVar: "CLAUDE_CONFIG_DIR",
    mcpConfigExample: "~/.claude.json",
    hostArgs: [],
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
    homeRelAuthFiles: [".vibe/.env"],
    configRelAuthFiles: [],
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
    homeRelAuthFiles: [".gemini/oauth_creds.json", ".gemini/google_accounts.json"],
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
  if (codec === undefined) {
    throw new Error(`unknown CLI seat "${cli}": not part of the five-seat circuit`);
  }
  return codec;
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
    config: { mcpServers: { h2a: { command: "h2a", args: ["mcp-serve"] } } },
    path: { example: codec.mcpConfigExample },
  };
}

function writePrivateFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
}

/**
 * Write synthetic credential stand-ins (canary-bearing) into an isolated
 * home/config pair. Replaces lab copyLogin: no owner store is ever read.
 */
export function writeSyntheticCredentialFiles(
  cli: SeatCli5,
  locations: { homeDir: string; configDir: string; canary: string },
): string[] {
  const paths = credentialFilePaths(cli, locations);
  const { canary } = locations;
  if (cli === "claude") {
    writePrivateFile(
      paths[0] as string,
      JSON.stringify({ type: "synthetic", access: canary, expiresAt: "2026-10-16T00:00:00.000Z", scopes: ["synthetic"] }) + "\n",
    );
    writePrivateFile(
      paths[1] as string,
      JSON.stringify({ loginMetadataOnly: true, hasCompletedOnboarding: true }) + "\n",
    );
  } else if (cli === "codex") {
    writePrivateFile(
      paths[0] as string,
      JSON.stringify({ type: "synthetic", auth: canary, last_refresh: "2026-10-15T00:00:00.000Z" }) + "\n",
    );
  } else if (cli === "muse") {
    writePrivateFile(
      paths[0] as string,
      JSON.stringify({ schema_version: 1, providers: { meta: { access_token: canary } } }) + "\n",
    );
  } else if (cli === "vibe") {
    writePrivateFile(paths[0] as string, `MISTRAL_API_KEY=${canary}\n`);
  } else {
    writePrivateFile(
      paths[0] as string,
      JSON.stringify({ type: "synthetic", access: canary, expiry: "2026-10-16T00:00:00.000Z" }) + "\n",
    );
    writePrivateFile(paths[1] as string, JSON.stringify({ type: "synthetic", accounts: [] }) + "\n");
  }
  return paths;
}
