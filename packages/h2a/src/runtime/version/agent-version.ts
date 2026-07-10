/**
 * Deployed-version visibility (EVO — addressing/version convergence, slice #2).
 *
 * The binary self-upgrades (`mcp-serve --auto-upgrade`) but the **skill does
 * not** — it is copied to each host by `h2a install-skills` and then frozen.
 * So an agent can run a fresh CLI behind a stale skill, invisibly. Stamping
 * `{ cli, skill }` into the presence record at session open makes that drift
 * visible in `/h2a discover` and `h2a doctor` without polling each host.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { H2AAgentVersion } from "@sentropic/h2a";

import { currentCliVersion } from "../upgrade/index.js";

/** Where each host's installed h2a skill file lives, relative to a home dir. */
const HOST_SKILL_FILE: Record<string, (home: string) => string> = {
  claude: (home) => join(home, ".claude", "skills", "h2a", "SKILL.md"),
  codex: (home) => join(home, ".codex", "skills", "h2a", "SKILL.md"),
  gemini: (home) => join(home, ".gemini", "commands", "h2a.toml"),
  agy: (home) => join(home, ".gemini", "commands", "h2a.toml"),
  hermes: (home) => join(home, ".hermes", "skills", "h2a", "SKILL.md"),
  opencode: (home) => join(home, ".config", "opencode", "skills", "h2a", "SKILL.md")
};

/**
 * Read the `version` stamp from the installed h2a skill for `host`, best-effort.
 * Accepts both YAML frontmatter (`version: x`, SKILL.md) and TOML (`version = "x"`,
 * gemini command file). Returns undefined for an unknown host, a missing/unreadable
 * file, or a skill with no version stamp.
 */
export function readInstalledSkillVersion(host: string, home: string = homedir()): string | undefined {
  const resolve = HOST_SKILL_FILE[host];
  if (!resolve) return undefined;
  try {
    const raw = readFileSync(resolve(home), "utf8");
    const match = /^\s*version\s*[:=]\s*["']?(\d+\.\d+\.\d+[^"'\s]*)/m.exec(raw);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compose the deployed-version stamp for a session: the running CLI version and
 * (when a host is known) its installed skill version. Fields are omitted rather
 * than set to undefined so the presence record stays clean.
 */
export function agentVersion(host?: string, home: string = homedir()): H2AAgentVersion {
  const cli = currentCliVersion();
  const skill = host ? readInstalledSkillVersion(host, home) : undefined;
  return {
    ...(cli ? { cli } : {}),
    ...(skill ? { skill } : {})
  };
}
