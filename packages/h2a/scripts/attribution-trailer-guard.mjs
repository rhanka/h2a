#!/usr/bin/env node
/**
 * Attribution trailer guard — single source of truth for commit-msg hooks,
 * PreToolUse guards, and reusable GitHub Actions PR/commit checks.
 *
 * Zero dependencies, Node-only, no /tmp writes.
 *
 * CLI usage:
 *   node attribution-trailer-guard.mjs check-file <msg-file> [--mode reject|strip] [--strip]
 *   node attribution-trailer-guard.mjs check-range <git-rev-range> [--repo <path>]
 *   node attribution-trailer-guard.mjs check-pr [--repo <path>] [--base <sha>] [--head <sha>]
 *                                               [--pr-title-env <VAR>] [--pr-body-env <VAR>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const GUARD_VERSION = "1";
export const GUARD_MARKER = "# h2a-attribution-trailer-guard: v1";

const SCISSORS_RE = /^# -{3,} >8 -{3,}$/;

/**
 * Forbidden attribution trailer / AI-generation patterns (all case-insensitive).
 *
 * Line-anchored rules (`co-authored-by`, `claude-session`, `generated-by`) avoid
 * false positives when prose merely mentions them mid-sentence. Specific AI
 * generation footers/links/markers match anywhere on a non-comment line.
 */
export const TRAILER_RULES = Object.freeze([
  {
    id: "co-authored-by-ai",
    label: "Co-Authored-By: <AI>",
    pattern: /^\s*co-authored-by\s*:\s*(?:(?:claude(?:\s+(?:code|haiku|opus|sonnet)(?:\s+[\d.]+)?)?|anthropic|codex|openai|gemini(?:\s+cli)?|antigravity|agy|mistral(?:\s+vibe)?|vibe|muse(?:\s+code)?|(?:github\s+)?copilot|cursor(?:\s*agent)?)(?:\[bot\])?\s*(?:<|$)|.*@(?:anthropic\.com|openai\.com|mistral\.ai|cursor\.com|cursor\.sh)>\s*$)/i,
  },
  {
    id: "claude-session",
    label: "Claude-Session: …",
    pattern: /^\s*claude-session\s*:/i,
  },
  {
    id: "generated-by-ai",
    label: "Generated-By: <AI>",
    pattern:
      /^\s*generated-by\s*:.*\b(?:claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor|ai)\b/i,
  },
  {
    id: "generated-with-ai",
    label: "Generated with/by [<AI tool>]",
    pattern:
      /generated\s+(?:with|by)\s+\[?(?:claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor|ai)\b/i,
  },
  {
    id: "claude-code-url",
    label: "claude.com/claude-code",
    pattern: /claude\.com\/claude-code/i,
  },
  {
    id: "claude-session-url",
    label: "claude.ai/code/session_…",
    pattern: /claude\.ai\/code\/session_[a-z0-9_-]+/i,
  },
  {
    id: "robot-marker",
    label: "🤖",
    pattern: /🤖/u,
  },
]);

/**
 * Split text into authored lines and optional git scissors suffix.
 */
function splitScissors(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((line) => SCISSORS_RE.test(line));
  if (idx === -1) return { bodyLines: lines, suffixLines: [] };
  return { bodyLines: lines.slice(0, idx), suffixLines: lines.slice(idx) };
}

/**
 * Find the first matching trailer rule for a single line, or null.
 */
export function matchTrailerLine(line, allowStandaloneRobot = false) {
  for (const rule of TRAILER_RULES) {
    if (allowStandaloneRobot && rule.id === "robot-marker" && !/🤖\uFE0F?\s*generated\s+(?:with|by)\b/i.test(line)) continue;
    if (rule.pattern.test(line)) return rule;
  }
  return null;
}

/**
 * Scan arbitrary text for attribution trailers.
 * - For commit messages: ignoreComments=true, respectScissors=true.
 * - For PR titles/bodies: ignoreComments=false, respectScissors=false.
 */
export function scanText(
  text,
  { ignoreComments = true, respectScissors = true, allowStandaloneRobot = false } = {},
) {
  const { bodyLines } = respectScissors
    ? splitScissors(text)
    : { bodyLines: String(text ?? "").replace(/\r\n/g, "\n").split("\n") };
  const matches = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (ignoreComments && line.startsWith("#")) continue;
    const rule = matchTrailerLine(line, allowStandaloneRobot);
    if (rule) {
      matches.push({ line: i + 1, rule: rule.id, label: rule.label, text: line });
    }
  }
  return { ok: matches.length === 0, matches };
}

export function scanCommitMessage(text) {
  return scanText(text, { ignoreComments: true, respectScissors: true });
}

export function scanPrText(text, { allowStandaloneRobot = false } = {}) {
  return scanText(text, { ignoreComments: false, respectScissors: false, allowStandaloneRobot });
}

/**
 * Strip matching attribution trailer lines from a commit message while
 * preserving comments and any git `commit -v` scissors diff suffix verbatim.
 */
export function stripCommitTrailers(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const hadTrailingNewline = raw.endsWith("\n");
  const { bodyLines, suffixLines } = splitScissors(raw);
  const kept = [];
  const removed = [];

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!line.startsWith("#")) {
      const rule = matchTrailerLine(line);
      if (rule) {
        removed.push({ line: i + 1, rule: rule.id, text: line });
        continue;
      }
    }
    kept.push(line);
  }

  // Trim blank lines left dangling at the end of the authored message after removal.
  if (removed.length > 0) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
      kept.pop();
    }
  }

  const remainingAuthored = kept
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();

  const outLines =
    suffixLines.length > 0 ? [...kept, "", ...suffixLines] : kept;
  let out = outLines.join("\n");
  if (hadTrailingNewline && out.length > 0 && !out.endsWith("\n")) {
    out += "\n";
  }

  return {
    text: out,
    removed,
    empty: remainingAuthored.length === 0,
  };
}

/**
 * Inspect a shell command string (PreToolUse / pre_tool hook) for `git commit`
 * or `gh pr create|edit|merge` invocations carrying forbidden trailers.
 *
 * Deliberately scoped to git commit / gh pr commands so unrelated commands
 * (e.g. `grep Co-Authored-By`, `git log --grep`, unit test fixtures) pass.
 */
export function scanBashCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return { ok: true, matches: [] };
  }
  const targetsGitCommit =
    /(?:^|[;|&\n]\s*)(?:(?:env\s+(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*)|command\s+|sudo\s+(?:-\w+\s+)*)*(?:git\b[^\n;|&]*\bcommit\b|gh\s+pr\s+(?:create|edit|merge)\b)/m.test(
      command,
    );
  if (!targetsGitCommit) {
    return { ok: true, matches: [] };
  }

  // Check both line-by-line (heredocs, multiline quotes) and escaped \n sequences
  // passed inside `-m "..."` or `--body "..."`.
  const expanded = command.replace(/\\n/g, "\n");
  const direct = scanText(expanded, {
    ignoreComments: false,
    respectScissors: false,
  });
  if (!direct.ok) return direct;

  // Also catch inline `-m "feat: x; Co-Authored-By: Claude"` or single-line
  // quote payloads where `Co-Authored-By:` immediately follows a quote.
  const inlineTrailerRe =
    /(?:["'`]|^|\n)\s*(co-authored-by|claude-session)\s*:/im;
  const inlineMatch = expanded.match(inlineTrailerRe);
  if (inlineMatch) {
    return {
      ok: false,
      matches: [
        {
          line: 1,
          rule: inlineMatch[1].toLowerCase(),
          label: inlineMatch[1],
          text: inlineMatch[0].trim(),
        },
      ],
    };
  }
  return { ok: true, matches: [] };
}

export function formatRejection(matches, context = "commit message") {
  const lines = [
    `✗ blocked — AI attribution / co-authorship trailer detected in ${context}.`,
    "",
    "  Forbidden lines (case-insensitive):",
    "    • Co-Authored-By: <AI>",
    "    • Claude-Session: …",
    "    • Generated-By: <AI>",
    "    • Generated with [<AI tool>] / claude.com/claude-code / claude.ai/code/session_…",
    "    • 🤖",
    "",
  ];
  if (matches?.length) {
    lines.push("  Matched:");
    for (const m of matches.slice(0, 5)) {
      lines.push(`    line ${m.line} [${m.rule}]: ${m.text.trim()}`);
    }
    lines.push("");
  }
  lines.push("  Remove the offending line(s) and try again.");
  return lines.join("\n") + "\n";
}

function readGitCommits(repo, revArgs) {
  const REC = "\x1e";
  const FLD = "\x1f";
  const raw = execFileSync(
    "git",
    ["-C", repo, "log", ...revArgs, `--format=${REC}%H${FLD}%s${FLD}%B`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return raw
    .split(REC)
    .filter(Boolean)
    .map((entry) => {
      const first = entry.indexOf(FLD);
      const second = entry.indexOf(FLD, first + 1);
      return {
        sha: entry.slice(0, first).trim(),
        subject: entry.slice(first + 1, second),
        body: entry.slice(second + 1),
      };
    });
}

function runCheckFile(filePath, mode) {
  const content = readFileSync(filePath, "utf8");
  if (mode === "strip") {
    const stripped = stripCommitTrailers(content);
    if (stripped.removed.length === 0) return 0;
    if (stripped.empty) {
      process.stderr.write(
        "✗ commit blocked — stripping AI attribution trailers left an empty commit message.\n",
      );
      return 1;
    }
    // Atomic same-directory rename (never touches /tmp).
    const tmp = join(
      dirname(resolve(filePath)),
      `.${basename(filePath)}.h2a-strip.${process.pid}`,
    );
    writeFileSync(tmp, stripped.text, "utf8");
    renameSync(tmp, filePath);
    process.stderr.write(
      `⚠ stripped ${stripped.removed.length} AI attribution line(s) from commit message.\n`,
    );
    return 0;
  }

  const result = scanCommitMessage(content);
  if (!result.ok) {
    process.stderr.write(formatRejection(result.matches, "commit message"));
    return 1;
  }
  return 0;
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
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
  const cmd = positionals[0];
  const repo = typeof flags.repo === "string" ? flags.repo : process.cwd();

  if (cmd === "check-file") {
    const target = positionals[1];
    if (!target) {
      process.stderr.write("usage: attribution-trailer-guard.mjs check-file <msg-file> [--mode reject|strip]\n");
      return 2;
    }
    const envMode = process.env.H2A_TRAILER_GUARD_MODE;
    const mode =
      flags.strip === true
        ? "strip"
        : typeof flags.mode === "string"
          ? flags.mode
          : envMode === "strip"
            ? "strip"
            : "reject";
    if (mode !== "reject" && mode !== "strip") {
      process.stderr.write(`invalid mode: ${mode} (expected reject or strip)\n`);
      return 2;
    }
    return runCheckFile(target, mode);
  }

  if (cmd === "check-range") {
    const range = positionals[1];
    if (!range) {
      process.stderr.write("usage: attribution-trailer-guard.mjs check-range <rev-range> [--repo <path>]\n");
      return 2;
    }
    const commits = readGitCommits(repo, [range]);
    let failed = 0;
    for (const c of commits) {
      const res = scanCommitMessage(c.body);
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::${c.sha.slice(0, 10)} ${c.subject} carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})\n`,
        );
      }
    }
    if (failed > 0) {
      process.stderr.write(
        `FAIL — ${failed} commit(s) carry forbidden AI attribution trailers.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `OK — ${commits.length} commit(s) scanned, no forbidden attribution trailers.\n`,
    );
    return 0;
  }

  if (cmd === "check-pr") {
    const base = typeof flags.base === "string" ? flags.base : "";
    const head = typeof flags.head === "string" ? flags.head : "";
    const prTitleEnv = typeof flags["pr-title-env"] === "string" ? flags["pr-title-env"] : "";
    const prBodyEnv = typeof flags["pr-body-env"] === "string" ? flags["pr-body-env"] : "";
    const prTitle =
      typeof flags["pr-title"] === "string"
        ? flags["pr-title"]
        : prTitleEnv
          ? process.env[prTitleEnv] ?? ""
          : "";
    const prBody =
      typeof flags["pr-body"] === "string"
        ? flags["pr-body"]
        : prBodyEnv
          ? process.env[prBodyEnv] ?? ""
          : "";

    let failed = 0;
    let scannedCommits = 0;
    if (base && head) {
      const commits = readGitCommits(repo, [`${base}..${head}`]);
      scannedCommits = commits.length;
      for (const c of commits) {
        const res = scanCommitMessage(c.body);
        if (!res.ok) {
          failed++;
          process.stderr.write(
            `::error::commit ${c.sha.slice(0, 10)} (${c.subject}) carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})\n`,
          );
        }
      }
    }
    if (prTitle) {
      const res = scanPrText(prTitle);
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::PR title carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})\n`,
        );
      }
    }
    if (prBody) {
      const res = scanPrText(prBody, { allowStandaloneRobot: true });
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::PR body / squash message carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})\n`,
        );
      }
    }
    if (failed > 0) {
      process.stderr.write(
        `FAIL — ${failed} violation(s) found across ${scannedCommits} commit(s) and PR metadata.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `OK — ${scannedCommits} commit(s) and PR metadata clean.\n`,
    );
    return 0;
  }

  process.stderr.write(
    "usage: attribution-trailer-guard.mjs <check-file|check-range|check-pr> ...\n",
  );
  return 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}
