#!/usr/bin/env bash
# Claude Code PreToolUse hook: protect uncommitted Track dogfood state from destructive git commands.
set -euo pipefail

# Explicit bypass for intentional destructive operations.
if [[ "${TRACK_ALLOW_DESTRUCTIVE_GIT:-}" == "1" ]]; then
  exit 0
fi

payload="$(cat)"
# Zero-Python rule: classification runs on Node (was a python3 heredoc).
classification="$(PAYLOAD="$payload" node -e "
const payload = process.env.PAYLOAD || \"\";
let kind = \"ALLOW\";
let tail = \"\";
let cmd = \"\";
let parsed = null;
try {
  parsed = JSON.parse(payload);
} catch (e) {
  parsed = null;
}
if (parsed !== null && typeof parsed === \"object\") {
  const ti = parsed.tool_input || {};
  const ti2 = parsed.toolInput || {};
  cmd = (ti.command || parsed.command || ti2.command || \"\");
}
if (typeof cmd === \"string\" && cmd.trim()) {
  tail = cmd;
  // Inline bypass, e.g. TRACK_ALLOW_DESTRUCTIVE_GIT=1 git reset --hard ...
  if (/(^|[\s;&|])TRACK_ALLOW_DESTRUCTIVE_GIT=1([\s;&|]|$)/.test(cmd)) {
    kind = \"BYPASS\";
  } else {
    // Split common shell command separators while preserving enough text for grep-able diagnostics.
    const segments = [];
    for (const line of cmd.split(/\r\n|[\n\r\v\f]/)) {
      segments.push(...line.split(/\s*(?:&&|;|\|\|)\s*/));
    }
    // Minimal POSIX shlex.split (posix=True, comments=False) equivalent:
    // whitespace splitting, single/double quotes, backslash escapes.
    // Returns [] on unterminated quotes, like the shlex ValueError path.
    const shlexSplit = (s) => {
      const out = [];
      let cur = null;
      let quote = null;
      let i = 0;
      const push = () => { if (cur !== null) { out.push(cur); cur = null; } };
      const isWs = (c) => c === \" \" || c === \"\t\" || c === \"\n\" || c === \"\r\" || c === \"\v\" || c === \"\f\";
      while (i < s.length) {
        const c = s[i];
        if (quote === \"'\") {
          if (c === \"'\") quote = null;
          else cur = (cur === null ? \"\" : cur) + c;
          i += 1;
          continue;
        }
        if (quote === \"\\\"\") {
          if (c === \"\\\"\") { quote = null; i += 1; continue; }
          if (c === \"\\\\\") {
            const n = s[i + 1];
            if (n === undefined) { cur = (cur === null ? \"\" : cur) + c; i += 1; continue; }
            if (n === \"\n\") { i += 2; continue; }
            if (n === \"\$\" || n === \"\\x60\" || n === \"\\\"\" || n === \"\\\\\") { cur = (cur === null ? \"\" : cur) + n; i += 2; continue; }
            cur = (cur === null ? \"\" : cur) + c;
            i += 1;
            continue;
          }
          cur = (cur === null ? \"\" : cur) + c;
          i += 1;
          continue;
        }
        if (c === \"'\" || c === \"\\\"\") {
          quote = c;
          if (cur === null) cur = \"\";
          i += 1;
          continue;
        }
        if (c === \"\\\\\") {
          const n = s[i + 1];
          if (n === undefined) { cur = (cur === null ? \"\" : cur) + c; i += 1; continue; }
          if (n === \"\n\") { i += 2; continue; }
          cur = (cur === null ? \"\" : cur) + n;
          i += 2;
          continue;
        }
        if (isWs(c)) { push(); i += 1; continue; }
        cur = (cur === null ? \"\" : cur) + c;
        i += 1;
      }
      if (quote !== null) return [];
      push();
      return out;
    };
    // Conservative destructive git detector. It intentionally catches common wrappers:
    //   cd repo && git reset --hard ...
    //   git -C repo reset --hard ...
    //   /usr/bin/git checkout main
    // It does not execute the command or fully parse shell syntax.
    const git_argv = (segment) => {
      const t = shlexSplit(segment);
      for (let i = 0; i < t.length; i += 1) {
        if (t[i] === \"git\" || t[i].endsWith(\"/git\")) return t.slice(i);
      }
      return [];
    };
    const clean_is_dry_run = (argv) => argv.some((a) => a === \"--dry-run\" || /^-[A-Za-z]*n[A-Za-z]*$/.test(a || \"\"));
    const is_destructive_git = (segment) => {
      const argv = git_argv(segment);
      if (!argv.length) return false;
      // Drop global git options (git -C path reset --hard, git -c k=v reset --hard).
      let i = 1;
      while (i < argv.length) {
        const a = argv[i];
        if ((a === \"-C\" || a === \"-c\" || a === \"--git-dir\" || a === \"--work-tree\" || a === \"--namespace\") && i + 1 < argv.length) {
          i += 2;
          continue;
        }
        if (a.startsWith(\"-\")) { i += 1; continue; }
        break;
      }
      if (i >= argv.length) return false;
      const sub = argv[i];
      const rest = argv.slice(i + 1);
      if (sub === \"reset\" && rest.includes(\"--hard\")) return true;
      if (sub === \"clean\" && !clean_is_dry_run(rest)) return true;
      if (sub === \"checkout\" || sub === \"switch\") {
        // Conservative: branch/ref checkout can replace worktree state. git checkout -- path
        // is also worktree-discarding, so blocking when .track is dirty is acceptable.
        return true;
      }
      return false;
    };
    if (segments.some(is_destructive_git)) kind = \"DESTRUCTIVE\";
  }
}
console.log(kind + \"\n\" + tail);
")"

kind="${classification%%$'\n'*}"
command_text="${classification#*$'\n'}"

case "$kind" in
  ALLOW|BYPASS) exit 0 ;;
  DESTRUCTIVE) ;;
  *) exit 0 ;;
esac

# If not in a git worktree, allow; there is no .track state to protect here.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Protect only Track dogfood state.
dirty="$(git status --porcelain -- .track 2>/dev/null || true)"
[[ -n "$dirty" ]] || exit 0

cat >&2 <<MSG
BLOCKED: destructive git command while .track has uncommitted changes.
Risk: uncommitted Track dogfood events would be discarded/regressed.
Remediation: commit or stash .track first, or set TRACK_ALLOW_DESTRUCTIVE_GIT=1 if you intentionally accept losing that state.

Command:
  $command_text

Dirty .track entries:
$dirty
MSG
exit 2
