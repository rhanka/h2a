#!/usr/bin/env node
/**
 * Idempotent, worktree-safe installer & read-only verifier for the harness
 * AI attribution trailer guard.
 *
 * Solves the root causes of trailer leaks:
 *  1. Installs `commit-msg` into `<git-common-dir>/hooks/commit-msg` and sets
 *     repo-local `core.hooksPath` to that absolute branch-independent path, so
 *     EVERY linked worktree on ANY branch runs the guard (unlike relative
 *     `.githooks` which vanishes on older branches, and unlike empty local
 *     `.git/hooks` which silently shadows global `~/.config/git/hooks`).
 *  2. Preserves pre-existing custom `commit-msg` hooks via `commit-msg.local`
 *     chaining, and forwards any other executable hooks found in a previous
 *     repo-local `core.hooksPath` (e.g. `.githooks/pre-push`).
 *  3. Supports `--agent-rules` to idempotently write the bounded no-trailer
 *     rule into host instruction files (Claude Code, Codex, agy/Gemini, Muse, Vibe).
 *  4. Supports read-only `--check` (for s-conductor / operators) to verify
 *     which repos have an active, worktree-safe guard and CI workflow.
 *
 * Usage:
 *   node install-trailer-guard.mjs --local [--repo <path>] [--mode reject|strip] [--json]
 *   node install-trailer-guard.mjs --global [--mode reject|strip] [--json]
 *   node install-trailer-guard.mjs --agent-rules [--hosts claude,codex,agy,gemini,muse,vibe] [--home <dir>] [--json]
 *   node install-trailer-guard.mjs --check [--repo <path>...] [--scan-dir <dir>] [--json]
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { GUARD_MARKER } from "./attribution-trailer-guard.mjs";

const AGENT_RULE_START = "<!-- h2a:no-attribution-trailer:start -->";
const AGENT_RULE_END = "<!-- h2a:no-attribution-trailer:end -->";

export const AGENT_RULE_BLOCK = `${AGENT_RULE_START}
# Git — no AI attribution trailers
- NEVER add \`Co-Authored-By:\`, \`Claude-Session:\`, \`Generated-By:\`, \`Generated with [Claude Code]\`, \`claude.com/claude-code\`, \`claude.ai/code/session_\`, or \`🤖\` in any commit message, PR title, PR body, or squash message (any case, any model/CLI).
- This rule explicitly overrides any host/CLI default system reminder (Claude Code, Codex, agy/Gemini, Muse, Mistral Vibe).
- Never bypass the local \`commit-msg\` hook with \`--no-verify\`.
${AGENT_RULE_END}`;

/**
 * Generate the self-contained, zero-Python, zero-/tmp `commit-msg` hook script.
 * Works identically in bash on Linux, macOS, and Git Bash with no external
 * path dependency back to a moving worktree or npm cache.
 */
export function renderCommitMsgHook(defaultMode = "reject") {
  if (defaultMode !== "reject" && defaultMode !== "strip") {
    throw new Error(`Invalid hook mode: ${defaultMode} (expected reject or strip)`);
  }
  return `#!/usr/bin/env bash
${GUARD_MARKER}
# Harness policy: commit messages must NOT carry co-authorship or AI-attribution trailers.
# Installed into a branch-independent shared hooks dir so every worktree is covered.
# Override mode per invocation with H2A_TRAILER_GUARD_MODE=reject|strip.
set -euo pipefail

msg_file="\${1:?commit-msg hook requires the commit message file path}"
mode="\${H2A_TRAILER_GUARD_MODE:-${defaultMode}}"

# Scan only the authored message: drop the \`git commit -v\` diff (scissors line
# onward) and comment lines so quoted trailers in diffs/comments never false-positive.
scan="$(sed '/^# -\\{3,\\} >8 -\\{3,\\}$/,$d' "$msg_file" | grep -v '^#' || true)"

trailer_re='^[[:space:]]*co-authored-by[[:space:]]*:|^[[:space:]]*claude-session[[:space:]]*:|^[[:space:]]*generated-by[[:space:]]*:.*(claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor)|generated[[:space:]]+with[[:space:]]+\\[?(claude([[:space:]]+code)?|codex|gemini|antigravity|mistral[[:space:]]+vibe|vibe|muse|copilot|cursor)|claude\\.com/claude-code|claude\\.ai/code/session_[a-z0-9_-]+|🤖'

if printf '%s\\n' "$scan" | grep -iEq "$trailer_re"; then
  if [ "$mode" = "strip" ]; then
    tmp_file="\${msg_file}.h2a-strip.$$"
    trap 'rm -f "$tmp_file"' EXIT
    awk '
      BEGIN { in_scissors = 0; n = 0; s = 0 }
      /^# ---+ >8 ---+$/ { in_scissors = 1 }
      in_scissors { suffix[++s] = $0; next }
      {
        drop = 0
        if (substr($0, 1, 1) != "#") {
          low = tolower($0)
          if (low ~ /^[[:space:]]*co-authored-by[[:space:]]*:/) drop = 1
          else if (low ~ /^[[:space:]]*claude-session[[:space:]]*:/) drop = 1
          else if (low ~ /^[[:space:]]*generated-by[[:space:]]*:/ && low ~ /(claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor)/) drop = 1
          else if (low ~ /generated[[:space:]]+with[[:space:]]+\\[?(claude([[:space:]]+code)?|codex|gemini|antigravity|mistral[[:space:]]+vibe|vibe|muse|copilot|cursor)/) drop = 1
          else if (low ~ /claude\\.com\\/claude-code/) drop = 1
          else if (low ~ /claude\\.ai\\/code\\/session_[a-z0-9_-]+/) drop = 1
          else if (index($0, "🤖") > 0) drop = 1
        }
        if (drop) next
        body[++n] = $0
      }
      END {
        while (n > 0 && body[n] ~ /^[[:space:]]*$/) n--
        for (i = 1; i <= n; i++) print body[i]
        if (s > 0) {
          print ""
          for (i = 1; i <= s; i++) print suffix[i]
        }
      }
    ' "$msg_file" > "$tmp_file"
    remaining="$(sed '/^# -\\{3,\\} >8 -\\{3,\\}$/,$d' "$tmp_file" | grep -v '^#' | tr -d '[:space:]' || true)"
    if [ -z "$remaining" ]; then
      echo "✗ commit blocked — stripping AI attribution trailers left an empty commit message." >&2
      exit 1
    fi
    mv "$tmp_file" "$msg_file"
    trap - EXIT
    echo "⚠ stripped AI attribution trailer(s) from commit message." >&2
  else
    {
      echo "✗ commit blocked — co-authorship / AI-attribution trailer detected."
      echo
      echo "  This repo forbids these lines in commit messages (case-insensitive):"
      echo "    • Co-Authored-By: …"
      echo "    • Claude-Session: …"
      echo "    • Generated-By: <AI>"
      echo "    • Generated with [<AI tool>] / claude.com/claude-code / claude.ai/code/session_…"
      echo "    • 🤖"
      echo
      echo "  Remove the offending line(s) from the commit message and try again."
    } >&2
    exit 1
  fi
fi

# Chain any preserved local commit-msg hook.
hook_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
if [ -x "$hook_dir/commit-msg.local" ]; then
  exec "$hook_dir/commit-msg.local" "$@"
fi
exit 0
`;
}

function runGit(cwd, args, extraEnv = undefined) {
  return execFileSync("git", cwd ? ["-C", cwd, ...args] : args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
  }).trim();
}

function safeGit(cwd, args, extraEnv = undefined) {
  try {
    return runGit(cwd, args, extraEnv);
  } catch {
    return null;
  }
}

function isExecutableFile(filePath) {
  try {
    const st = statSync(filePath);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function writeHookIdempotent(hooksDir, hookContent) {
  mkdirSync(hooksDir, { recursive: true });
  const target = join(hooksDir, "commit-msg");
  const localBackup = join(hooksDir, "commit-msg.local");
  let preservedLocal = false;

  if (existsSync(target)) {
    const existing = readFileSync(target, "utf8");
    const isManaged =
      existing.includes(GUARD_MARKER) ||
      existing.includes("Repo policy: commit messages must NOT carry co-authorship");
    if (!isManaged && !existsSync(localBackup)) {
      writeFileSync(localBackup, existing, "utf8");
      chmodSync(localBackup, 0o755);
      preservedLocal = true;
    }
    if (existing === hookContent && isExecutableFile(target)) {
      return { target, changed: false, preservedLocal };
    }
  }

  writeFileSync(target, hookContent, "utf8");
  chmodSync(target, 0o755);
  return { target, changed: true, preservedLocal };
}

/**
 * Forward non-sample executable sibling hooks (e.g. `pre-push` from `.githooks`)
 * when migrating a repo whose previous local `core.hooksPath` pointed elsewhere.
 */
function forwardSiblingHooks(previousDir, targetDir) {
  const forwarded = [];
  if (!previousDir || resolve(previousDir) === resolve(targetDir)) return forwarded;
  if (!existsSync(previousDir)) return forwarded;
  let entries;
  try {
    entries = readdirSync(previousDir);
  } catch {
    return forwarded;
  }
  for (const name of entries) {
    if (name === "commit-msg" || name === "commit-msg.local" || name.endsWith(".sample") || name.includes(".")) {
      continue;
    }
    const src = join(previousDir, name);
    const dst = join(targetDir, name);
    if (!isExecutableFile(src) || existsSync(dst)) continue;
    const wrapper = `#!/usr/bin/env bash
# h2a-forwarded-hook from ${previousDir}
set -euo pipefail
target=${JSON.stringify(src)}
if [ -x "$target" ]; then
  exec "$target" "$@"
fi
exit 0
`;
    writeFileSync(dst, wrapper, "utf8");
    chmodSync(dst, 0o755);
    forwarded.push(name);
  }
  return forwarded;
}

/**
 * Install the guard for a single repository (worktree-safe, idempotent).
 */
export function installLocal({ repo = process.cwd(), mode = "reject" } = {}) {
  const repoRoot = resolve(repo);
  const top = runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  const commonDirRaw = runGit(repoRoot, ["rev-parse", "--git-common-dir"]);
  const commonDir = isAbsolute(commonDirRaw)
    ? resolve(commonDirRaw)
    : resolve(repoRoot, commonDirRaw);
  const targetHooksDir = join(commonDir, "hooks");

  const prevLocal = safeGit(repoRoot, ["config", "--local", "--get", "core.hooksPath"]);
  const prevDir = prevLocal
    ? isAbsolute(prevLocal)
      ? resolve(prevLocal)
      : resolve(top, prevLocal)
    : null;

  const hookContent = renderCommitMsgHook(mode);
  const writeRes = writeHookIdempotent(targetHooksDir, hookContent);
  const forwarded = forwardSiblingHooks(prevDir, targetHooksDir);

  let configChanged = false;
  if (prevLocal !== targetHooksDir) {
    runGit(repoRoot, ["config", "--local", "core.hooksPath", targetHooksDir]);
    configChanged = true;
  }

  return {
    scope: "local",
    repo: top,
    commonGitDir: commonDir,
    hooksDir: targetHooksDir,
    hookPath: writeRes.target,
    mode,
    changed: writeRes.changed || configChanged || forwarded.length > 0,
    hookChanged: writeRes.changed,
    configChanged,
    preservedLocal: writeRes.preservedLocal,
    forwardedHooks: forwarded,
  };
}

/**
 * Install the guard globally in `${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks`.
 */
export function installGlobal({
  mode = "reject",
  home = homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
  gitConfigGlobal = process.env.GIT_CONFIG_GLOBAL,
} = {}) {
  const configRoot = xdgConfigHome || join(home, ".config");
  const gdir = resolve(configRoot, "git", "hooks");
  const hookContent = renderCommitMsgHook(mode);
  const writeRes = writeHookIdempotent(gdir, hookContent);

  const env = gitConfigGlobal ? { GIT_CONFIG_GLOBAL: gitConfigGlobal } : undefined;
  const prevGlobal = safeGit(null, ["config", "--global", "--get", "core.hooksPath"], env);
  let configChanged = false;
  if (prevGlobal !== gdir) {
    runGit(null, ["config", "--global", "core.hooksPath", gdir], env);
    configChanged = true;
  }

  return {
    scope: "global",
    hooksDir: gdir,
    hookPath: writeRes.target,
    mode,
    changed: writeRes.changed || configChanged,
    hookChanged: writeRes.changed,
    configChanged,
    preservedLocal: writeRes.preservedLocal,
  };
}

export const AGENT_INSTRUCTION_TARGETS = Object.freeze({
  claude: (home) => join(home, ".claude", "CLAUDE.md"),
  codex: (home) => join(home, ".codex", "AGENTS.md"),
  agy: (home) => join(home, ".gemini", "GEMINI.md"),
  gemini: (home) => join(home, ".gemini", "GEMINI.md"),
  muse: (home) => join(home, ".config", "muse", "AGENTS.md"),
  vibe: (home) => join(home, ".vibe", "AGENTS.md"),
});

/**
 * Idempotently upsert the marked no-attribution-trailer rule block into
 * per-host global instruction files (Claude Code, Codex, agy/Gemini, Muse, Vibe).
 */
export function installAgentRules({
  hosts = ["claude", "codex", "agy", "gemini", "muse", "vibe"],
  home = homedir(),
} = {}) {
  const seenPaths = new Set();
  const results = [];

  for (const host of hosts) {
    const resolver = AGENT_INSTRUCTION_TARGETS[host];
    if (!resolver) {
      throw new Error(`Unsupported host for agent rules: ${host}`);
    }
    const target = resolve(resolver(home));
    if (seenPaths.has(target)) {
      results.push({ host, path: target, changed: false, sharedWithPrevious: true });
      continue;
    }
    seenPaths.add(target);
    mkdirSync(dirname(target), { recursive: true });
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    let next;
    const startIdx = existing.indexOf(AGENT_RULE_START);
    const endIdx = existing.indexOf(AGENT_RULE_END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      next =
        existing.slice(0, startIdx) +
        AGENT_RULE_BLOCK +
        existing.slice(endIdx + AGENT_RULE_END.length);
    } else if (existing.trim().length === 0) {
      next = AGENT_RULE_BLOCK + "\n";
    } else {
      const sep = existing.endsWith("\n\n")
        ? ""
        : existing.endsWith("\n")
          ? "\n"
          : "\n\n";
      next = `${existing}${sep}${AGENT_RULE_BLOCK}\n`;
    }
    const changed = next !== existing;
    if (changed) {
      writeFileSync(target, next, "utf8");
    }
    results.push({ host, path: target, changed });
  }

  return results;
}

/**
 * Read-only check of whether a repo has an active, worktree-safe commit-msg
 * attribution trailer guard and CI workflow. Makes ZERO filesystem writes.
 */
export function checkRepo(repoPath) {
  const dir = resolve(repoPath);
  const top = safeGit(dir, ["rev-parse", "--show-toplevel"]);
  if (!top) {
    return {
      repo: dir,
      name: basename(dir),
      active: false,
      worktreeSafe: false,
      ciActive: false,
      reasons: ["not a git repository"],
    };
  }
  const commonRaw = safeGit(dir, ["rev-parse", "--git-common-dir"]) ?? ".git";
  const commonDir = isAbsolute(commonRaw) ? resolve(commonRaw) : resolve(dir, commonRaw);
  const localHooksPath = safeGit(dir, ["config", "--local", "--get", "core.hooksPath"]);
  const effectiveRaw = safeGit(dir, ["config", "--get", "core.hooksPath"]);

  let effectiveHooksDir;
  let source;
  if (effectiveRaw) {
    effectiveHooksDir = isAbsolute(effectiveRaw)
      ? resolve(effectiveRaw)
      : resolve(top, effectiveRaw);
    source = localHooksPath ? "local" : "global";
  } else {
    effectiveHooksDir = join(commonDir, "hooks");
    source = "default";
  }

  const reasons = [];
  const hookFile = join(effectiveHooksDir, "commit-msg");
  const hooksDirExists = existsSync(effectiveHooksDir);
  if (!hooksDirExists) {
    reasons.push(`hooksPath directory missing on disk: ${effectiveHooksDir}`);
  }

  const hookExecutable = hooksDirExists && isExecutableFile(hookFile);
  let hasGuardSignature = false;
  let managedVersion = null;
  if (hookExecutable) {
    try {
      const content = readFileSync(hookFile, "utf8");
      if (content.includes(GUARD_MARKER)) {
        hasGuardSignature = true;
        managedVersion = "v1";
      } else if (/co-authored-by/i.test(content) && /claude-session/i.test(content)) {
        hasGuardSignature = true;
        managedVersion = "legacy";
      } else {
        reasons.push("commit-msg exists but does not check Co-Authored-By / Claude-Session");
      }
    } catch {
      reasons.push("commit-msg unreadable");
    }
  } else if (hooksDirExists) {
    reasons.push(
      localHooksPath
        ? `local core.hooksPath (${localHooksPath}) shadows global hooks and has no executable commit-msg`
        : `no executable commit-msg in ${effectiveHooksDir}`,
    );
  }

  // Worktree safety: relative core.hooksPath OR path inside the checked-out worktree
  // tree outside <git-common-dir> breaks when another branch without that dir is checked out.
  let worktreeSafe = true;
  if (effectiveRaw && !isAbsolute(effectiveRaw)) {
    worktreeSafe = false;
    reasons.push(`relative core.hooksPath (${effectiveRaw}) breaks across worktrees/branches`);
  } else if (
    effectiveHooksDir.startsWith(top + "/") &&
    !effectiveHooksDir.startsWith(commonDir + "/") &&
    effectiveHooksDir !== commonDir
  ) {
    worktreeSafe = false;
    reasons.push(
      `core.hooksPath (${effectiveHooksDir}) points into branch-tracked worktree files instead of git-common-dir or global hooks`,
    );
  }

  // Check CI workflow presence (read-only).
  const wfDir = join(top, ".github", "workflows");
  let ciWorkflow = null;
  if (existsSync(wfDir)) {
    try {
      for (const f of readdirSync(wfDir)) {
        if (!/\.ya?ml$/i.test(f)) continue;
        const full = join(wfDir, f);
        try {
          const text = readFileSync(full, "utf8");
          if (
            text.includes("no-coauthor-trailer") ||
            text.includes("attribution-trailer-guard") ||
            (/co-authored-by/i.test(text) && /pull_request/i.test(text))
          ) {
            ciWorkflow = `.github/workflows/${f}`;
            break;
          }
        } catch {
          // ignore unreadable workflow file
        }
      }
    } catch {
      // ignore
    }
  }

  const active = hookExecutable && hasGuardSignature && worktreeSafe;
  return {
    repo: top,
    name: basename(top),
    active,
    hookActive: hookExecutable && hasGuardSignature,
    worktreeSafe,
    managedVersion,
    source,
    effectiveHooksDir,
    localHooksPath: localHooksPath ?? null,
    ciActive: ciWorkflow !== null,
    ciWorkflow,
    reasons,
  };
}

function discoverReposInDir(scanDir) {
  const base = resolve(scanDir);
  const repos = [];
  for (const entry of readdirSync(base).sort()) {
    if (entry.startsWith(".")) continue;
    const full = join(base, entry);
    try {
      if (!lstatSync(full).isDirectory()) continue;
      // Only include primary repo roots (`.git` directory), skip linked worktrees (`.git` file).
      const gitEntry = join(full, ".git");
      if (existsSync(gitEntry) && lstatSync(gitEntry).isDirectory()) {
        repos.push(full);
      }
    } catch {
      // ignore inaccessible entries
    }
  }
  return repos;
}

function parseArgs(argv) {
  const positionals = [];
  const flags = { repo: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) {
      flags.repo.push(argv[++i]);
    } else if (a.startsWith("--repo=")) {
      flags.repo.push(a.slice("--repo=".length));
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (
          next !== undefined &&
          !next.startsWith("--") &&
          ["mode", "hosts", "home", "scan-dir"].includes(key)
        ) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function runCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const json = flags.json === true;
  const mode = typeof flags.mode === "string" ? flags.mode : "reject";

  if (flags.check === true) {
    const targets = [
      ...flags.repo,
      ...positionals,
      ...(typeof flags["scan-dir"] === "string"
        ? discoverReposInDir(flags["scan-dir"])
        : []),
    ];
    if (targets.length === 0) targets.push(process.cwd());
    const results = targets.map(checkRepo);
    if (json) {
      process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    } else {
      for (const r of results) {
        const status = r.active ? "ACTIVE" : "INACTIVE";
        const ci = r.ciActive ? `CI:${r.ciWorkflow}` : "CI:absent";
        const detail = r.reasons.length ? ` — ${r.reasons.join("; ")}` : "";
        process.stdout.write(
          `${status.padEnd(8)} ${r.name.padEnd(28)} hook:${r.source.padEnd(7)} ${ci}${detail}\n`,
        );
      }
    }
    return results.every((r) => r.active) ? 0 : 1;
  }

  if (flags["agent-rules"] === true) {
    const hosts =
      typeof flags.hosts === "string"
        ? flags.hosts
            .split(",")
            .map((h) => h.trim())
            .filter(Boolean)
        : undefined;
    const home = typeof flags.home === "string" ? flags.home : homedir();
    const res = installAgentRules({ ...(hosts ? { hosts } : {}), home });
    if (json) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    } else {
      for (const r of res) {
        process.stdout.write(
          `${r.changed ? "updated" : "ok     "} ${r.host.padEnd(8)} ${r.path}\n`,
        );
      }
    }
    return 0;
  }

  if (flags.global === true) {
    const res = installGlobal({ mode });
    if (json) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    } else {
      process.stdout.write(
        `global core.hooksPath -> ${res.hooksDir} (mode: ${res.mode}, changed: ${res.changed})\n`,
      );
    }
    return 0;
  }

  // Default: --local per-repo install (worktree-safe).
  const repo = flags.repo[0] ?? positionals[0] ?? process.cwd();
  const res = installLocal({ repo, mode });
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  } else {
    process.stdout.write(
      `repo core.hooksPath -> ${res.hooksDir} (${res.repo}, mode: ${res.mode}, changed: ${res.changed})\n`,
    );
    if (res.forwardedHooks.length > 0) {
      process.stdout.write(
        `forwarded existing hooks: ${res.forwardedHooks.join(", ")}\n`,
      );
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}
