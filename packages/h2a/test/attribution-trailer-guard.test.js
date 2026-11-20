import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  scanBashCommand,
  scanCommitMessage,
  scanPrText,
  stripCommitTrailers,
} from "../scripts/attribution-trailer-guard.mjs";
import {
  AGENT_RULE_BLOCK,
  checkRepo,
  installAgentRules,
  installGlobal,
  installLocal,
} from "../scripts/install-trailer-guard.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const GUARD_CLI = fileURLToPath(
  new URL("../scripts/attribution-trailer-guard.mjs", import.meta.url),
);
const INSTALLER_CLI = fileURLToPath(
  new URL("../scripts/install-trailer-guard.mjs", import.meta.url),
);
const PRETOOL_HOOK = fileURLToPath(
  new URL("../hooks/deny-attribution-trailer.mjs", import.meta.url),
);
const WORKFLOW_FILE = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "no-coauthor-trailer.yml",
);

function makeSandbox(t, prefix = "trailer-guard-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, args, extraEnv = {}) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      ...extraEnv,
    },
  }).trim();
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  writeFileSync(join(dir, "README.md"), "init\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "chore: init"]);
}

test("scanCommitMessage detects case-insensitive AI attribution trailers and allows clean prose/scissors", () => {
  const blocked = [
    "feat: a\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>",
    "feat: b\n\nco-authored-by: Mistral Vibe <vibe@mistral.ai>",
    "feat: c\n\nCO-AUTHORED-BY: Codex <noreply@openai.com>",
    "feat: d\n\n  Co-Authored-By : Gemini <noreply@google.com>",
    "feat: e\n\nClaude-Session: https://claude.ai/code/session_01ABC",
    "feat: f\n\nclaude-session: https://claude.ai/code/session_01XYZ",
    "feat: g\n\nGenerated-By: Claude Code",
    "feat: h\n\nGenerated with [Claude Code](https://claude.com/claude-code)",
    "feat: i\n\ngenerated with mistral vibe",
    "feat: j\n\nSee https://claude.com/claude-code",
    "feat: k\n\nSession https://claude.ai/code/session_01DEF",
    "feat: l\n\n🤖 automated change",
  ];
  for (const msg of blocked) {
    const res = scanCommitMessage(msg);
    assert.equal(res.ok, false, `expected blocked: ${msg}`);
    assert.ok(res.matches.length > 0);
  }

  const allowed = [
    "chore: routine maintenance",
    "docs: forbid Co-Authored-By: and Claude-Session: trailers in commit messages",
    "fix: keep Signed-off-by trailer\n\nSigned-off-by: Jane Doe <jane@example.com>",
    "docs: edit\n# Co-Authored-By: Claude <noreply@anthropic.com>\n# Claude-Session: x",
    "docs: edit\n\n# ------------------------ >8 ------------------------\n+Co-Authored-By: Claude <noreply@anthropic.com>\n+🤖\n",
  ];
  for (const msg of allowed) {
    const res = scanCommitMessage(msg);
    assert.equal(res.ok, true, `expected allowed: ${msg}`);
  }
});

test("stripCommitTrailers removes forbidden lines, preserves body and scissors, and flags empty result", () => {
  const input = [
    "feat(core): add guard",
    "",
    "Keeps body paragraph.",
    "",
    "Co-Authored-By: Mistral Vibe <vibe@mistral.ai>",
    "Claude-Session: https://claude.ai/code/session_01ABC",
    "🤖 Generated with [Claude Code]",
    "",
    "# ------------------------ >8 ------------------------",
    "+Co-Authored-By: example in diff",
    "",
  ].join("\n");

  const stripped = stripCommitTrailers(input);
  assert.equal(stripped.empty, false);
  assert.equal(stripped.removed.length, 3);
  assert.match(stripped.text, /feat\(core\): add guard/);
  assert.match(stripped.text, /Keeps body paragraph\./);
  assert.match(stripped.text, /\+Co-Authored-By: example in diff/);
  assert.equal(scanCommitMessage(stripped.text).ok, true);

  const onlyTrailer = stripCommitTrailers(
    "Co-Authored-By: Claude <noreply@anthropic.com>\n",
  );
  assert.equal(onlyTrailer.empty, true);
});

test("installLocal is idempotent, worktree-safe across branches without .githooks, chains custom commit-msg, and forwards sibling hooks", (t) => {
  const dir = makeSandbox(t);
  const repo = join(dir, "repo");
  initRepo(repo);

  // Pre-existing custom commit-msg + sibling pre-push hook in a tracked .githooks dir.
  const trackedHooks = join(repo, ".githooks");
  mkdirSync(trackedHooks, { recursive: true });
  const pushMarker = join(dir, "pre-push-ran");
  writeFileSync(
    join(trackedHooks, "pre-push"),
    `#!/usr/bin/env bash\necho ran > ${JSON.stringify(pushMarker)}\nexit 0\n`,
  );
  chmodSync(join(trackedHooks, "pre-push"), 0o755);
  git(repo, ["config", "--local", "core.hooksPath", ".githooks"]);

  const commonCommitMsg = join(repo, ".git", "hooks", "commit-msg");
  const customMarker = join(dir, "custom-hook-ran");
  writeFileSync(
    commonCommitMsg,
    `#!/usr/bin/env bash\necho custom > ${JSON.stringify(customMarker)}\nexit 0\n`,
  );
  chmodSync(commonCommitMsg, 0o755);

  const first = installLocal({ repo, mode: "reject" });
  assert.equal(first.changed, true);
  assert.equal(first.preservedLocal, true);
  assert.deepEqual(first.forwardedHooks, ["pre-push"]);
  assert.equal(
    git(repo, ["config", "--local", "--get", "core.hooksPath"]),
    join(repo, ".git", "hooks"),
  );
  assert.equal(existsSync(join(repo, ".git", "hooks", "pre-push")), true);

  // Second run is strictly idempotent.
  const second = installLocal({ repo, mode: "reject" });
  assert.equal(second.changed, false);
  assert.equal(second.hookChanged, false);
  assert.equal(second.configChanged, false);

  // Create a linked worktree on an orphan branch with NO .githooks directory.
  const wt = join(dir, "wt-orphan");
  git(repo, ["worktree", "add", "-q", "--orphan", "-b", "legacy-no-githooks", wt]);
  assert.equal(existsSync(join(wt, ".githooks")), false);
  writeFileSync(join(wt, "file.txt"), "hello\n");
  git(wt, ["add", "file.txt"]);

  // Trailer commit in the linked worktree MUST be blocked.
  const blocked = spawnSync(
    "git",
    [
      "-C",
      wt,
      "commit",
      "-m",
      "feat: test\n\nCo-Authored-By: Codex <noreply@openai.com>",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    },
  );
  assert.notEqual(blocked.status, 0, "trailer commit must fail in worktree");
  assert.match(blocked.stderr, /commit blocked/);
  assert.equal(existsSync(customMarker), false);

  // Clean commit in the linked worktree MUST pass and chain commit-msg.local.
  const allowed = spawnSync("git", ["-C", wt, "commit", "-m", "feat: clean"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(existsSync(customMarker), true, "preserved commit-msg.local ran");

  // Strip mode removes trailers in-place in the linked worktree.
  writeFileSync(join(wt, "file2.txt"), "strip\n");
  git(wt, ["add", "file2.txt"]);
  const stripped = spawnSync(
    "git",
    [
      "-C",
      wt,
      "commit",
      "-m",
      "feat: stripped\n\nCo-Authored-By: Mistral Vibe <vibe@mistral.ai>",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        H2A_TRAILER_GUARD_MODE: "strip",
      },
    },
  );
  assert.equal(stripped.status, 0, stripped.stderr);
  const committedMsg = git(wt, ["log", "-1", "--format=%B"]);
  assert.equal(committedMsg, "feat: stripped");
});

test("checkRepo detects shadowed empty .git/hooks, missing branch-tracked .githooks, and active worktree-safe installs", (t) => {
  const dir = makeSandbox(t);
  const globalCfg = join(dir, "gitconfig");
  const fakeHome = join(dir, "home");
  installGlobal({ home: fakeHome, xdgConfigHome: join(fakeHome, ".config"), gitConfigGlobal: globalCfg });

  // 1. Repo with empty local core.hooksPath shadowing global -> INACTIVE.
  const shadowed = join(dir, "shadowed");
  initRepo(shadowed);
  git(shadowed, ["config", "--local", "core.hooksPath", join(shadowed, ".git", "hooks")]);
  const resShadowed = checkRepo(shadowed);
  assert.equal(resShadowed.active, false);
  assert.match(resShadowed.reasons.join(" "), /shadows global hooks/);

  // 2. Repo with local core.hooksPath pointing into a non-existent .githooks -> INACTIVE & not worktreeSafe.
  const missingGithooks = join(dir, "missing-githooks");
  initRepo(missingGithooks);
  git(missingGithooks, ["config", "--local", "core.hooksPath", join(missingGithooks, ".githooks")]);
  const resMissing = checkRepo(missingGithooks);
  assert.equal(resMissing.active, false);
  assert.equal(resMissing.worktreeSafe, false);

  // 3. Repo installed via installLocal + reusable CI workflow -> ACTIVE & ciActive.
  const healthy = join(dir, "healthy");
  initRepo(healthy);
  installLocal({ repo: healthy });
  mkdirSync(join(healthy, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(healthy, ".github", "workflows", "no-coauthor-trailer.yml"),
    "jobs:\n  trailer-guard:\n    uses: rhanka/h2a/.github/workflows/no-coauthor-trailer.yml@main\n",
  );
  const resHealthy = checkRepo(healthy);
  assert.equal(resHealthy.active, true);
  assert.equal(resHealthy.worktreeSafe, true);
  assert.equal(resHealthy.ciActive, true);
  assert.equal(resHealthy.managedVersion, "v1");

  // CLI --check exits 0 for healthy, 1 when any repo is inactive.
  const okCli = spawnSync(process.execPath, [INSTALLER_CLI, "--check", healthy, "--json"], { encoding: "utf8" });
  assert.equal(okCli.status, 0, okCli.stderr);
  const failCli = spawnSync(process.execPath, [INSTALLER_CLI, "--check", healthy, shadowed], { encoding: "utf8" });
  assert.equal(failCli.status, 1);
  assert.match(failCli.stdout, /ACTIVE\s+healthy/);
  assert.match(failCli.stdout, /INACTIVE\s+shadowed/);
});

test("check-pr CLI rejects trailers in PR commits, PR title, or PR body / squash message", (t) => {
  const dir = makeSandbox(t);
  const repo = join(dir, "pr-repo");
  initRepo(repo);
  const base = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "a.txt"), "1\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-q", "--no-verify", "-m", "feat: clean commit"]);
  const headClean = git(repo, ["rev-parse", "HEAD"]);

  // Clean commit + clean PR title/body passes.
  const pass = spawnSync(
    process.execPath,
    [GUARD_CLI, "check-pr", "--repo", repo, "--base", base, "--head", headClean, "--pr-title-env", "T", "--pr-body-env", "B"],
    { encoding: "utf8", env: { ...process.env, T: "feat: clean PR", B: "## Summary\n- Adds guard" } },
  );
  assert.equal(pass.status, 0, pass.stderr);

  // Clean commit + PR body carrying Claude footer fails (squash message vector).
  const badBody = spawnSync(
    process.execPath,
    [GUARD_CLI, "check-pr", "--repo", repo, "--base", base, "--head", headClean, "--pr-title-env", "T", "--pr-body-env", "B"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        T: "feat: clean PR",
        B: "## Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      },
    },
  );
  assert.equal(badBody.status, 1);
  assert.match(badBody.stderr, /PR body \/ squash message/);

  // Dirty commit in PR range fails even with clean PR body.
  writeFileSync(join(repo, "b.txt"), "2\n");
  git(repo, ["add", "b.txt"]);
  git(repo, [
    "commit",
    "-q",
    "--no-verify",
    "-m",
    "feat: dirty\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>",
  ]);
  const headDirty = git(repo, ["rev-parse", "HEAD"]);
  const badCommit = spawnSync(
    process.execPath,
    [GUARD_CLI, "check-pr", "--repo", repo, "--base", base, "--head", headDirty, "--pr-title-env", "T", "--pr-body-env", "B"],
    { encoding: "utf8", env: { ...process.env, T: "feat: clean", B: "Clean body" } },
  );
  assert.equal(badCommit.status, 1);
  assert.match(badCommit.stderr, /commit /);
});

test("reusable GitHub Actions workflow uses workflow_call, Node only (no Python, no /tmp), and scans commits + PR body", (t) => {
  const yml = readFileSync(WORKFLOW_FILE, "utf8");
  assert.match(yml, /\bworkflow_call:/);
  assert.match(yml, /types:\s*\[opened,\s*edited,\s*synchronize,\s*reopened\]/);
  assert.match(yml, /PR_BODY/);
  assert.match(yml, /PR_TITLE/);
  assert.doesNotMatch(yml, /\/tmp\//, "workflow must never touch /tmp");
  assert.doesNotMatch(yml, /\bpython\d*\b/i, "workflow must not invoke python");

  // Extract the embedded Node script from the workflow and execute it against a real fixture repo.
  const match = yml.match(/node - <<'EOF'\n([\s\S]*?)\n\s+EOF/);
  assert.ok(match, "reusable workflow embeds a Node script");
  const script = match[1].replace(/^ {10}/gm, "");

  const dir = makeSandbox(t);
  const repo = join(dir, "wf-repo");
  initRepo(repo);
  const base = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "x.txt"), "1\n");
  git(repo, ["add", "x.txt"]);
  git(repo, ["commit", "-q", "--no-verify", "-m", "feat: ok"]);
  const head = git(repo, ["rev-parse", "HEAD"]);

  const okRun = spawnSync(process.execPath, ["-e", script], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      EVENT_NAME: "pull_request",
      PR_BASE_SHA: base,
      PR_HEAD_SHA: head,
      PR_TITLE: "feat: clean title",
      PR_BODY: "Clean body mentioning Co-Authored-By: in prose.",
      CHECK_PR_BODY: "true",
    },
  });
  assert.equal(okRun.status, 0, okRun.stderr);

  const badPrBodyRun = spawnSync(process.execPath, ["-e", script], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      EVENT_NAME: "pull_request",
      PR_BASE_SHA: base,
      PR_HEAD_SHA: head,
      PR_TITLE: "feat: clean title",
      PR_BODY: "Summary\n\nCo-Authored-By: Mistral Vibe <vibe@mistral.ai>",
      CHECK_PR_BODY: "true",
    },
  });
  assert.equal(badPrBodyRun.status, 1);
  assert.match(badPrBodyRun.stderr, /PR body \/ squash message/);
});

test("PreToolUse hook blocks git commit and gh pr commands with trailers (even with --no-verify) and allows clean commands", () => {
  const invoke = (command) =>
    spawnSync(process.execPath, [PRETOOL_HOOK], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: "utf8",
    });

  for (const cmd of [
    'git commit -m "feat: x\\n\\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"',
    'git commit --no-verify -m "feat: x\\n\\nClaude-Session: https://claude.ai/code/session_01ABC"',
    'git commit -m "$(cat <<EOF\nfeat: x\n\nCo-Authored-By: Codex <noreply@openai.com>\nEOF\n)"',
    'gh pr create --title "feat: x" --body "Generated with [Claude Code]"',
    'gh pr edit 42 --body "Done\\n🤖"',
  ]) {
    const r = invoke(cmd);
    assert.equal(r.status, 2, `expected block for: ${cmd}`);
    assert.equal(JSON.parse(r.stdout).decision, "block");
  }

  for (const cmd of [
    'git commit -m "docs: forbid Co-Authored-By: trailers in commits"',
    'git log --grep="Co-Authored-By:" -n 5',
    'grep -i "Co-Authored-By:" README.md',
    'gh pr create --title "fix: guard" --body "Adds commit-msg hook"',
  ]) {
    const r = invoke(cmd);
    assert.equal(r.status, 0, `expected allow for: ${cmd}: ${r.stderr}`);
  }
  assert.equal(scanBashCommand("git status").ok, true);
  assert.equal(scanPrText("Co-Authored-By: Bot <b@x.y>").ok, false);
});

test("installAgentRules idempotently deploys the no-trailer rule to Claude, Codex, agy/Gemini, Muse, and Vibe instruction files", (t) => {
  const dir = makeSandbox(t);
  const home = join(dir, "home");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex", "AGENTS.md"), "@/home/user/.codex/RTK.md\n");

  const first = installAgentRules({ home });
  assert.equal(first.filter((r) => r.changed).length, 5); // agy & gemini share ~/.gemini/GEMINI.md

  const codexContent = readFileSync(join(home, ".codex", "AGENTS.md"), "utf8");
  assert.match(codexContent, /^@\/home\/user\/\.codex\/RTK\.md/);
  assert.ok(codexContent.includes(AGENT_RULE_BLOCK));
  for (const rel of [
    ".claude/CLAUDE.md",
    ".codex/AGENTS.md",
    ".gemini/GEMINI.md",
    ".config/muse/AGENTS.md",
    ".vibe/AGENTS.md",
  ]) {
    const content = readFileSync(join(home, rel), "utf8");
    assert.ok(content.includes("NEVER add `Co-Authored-By:`"), rel);
    assert.ok(content.includes("overrides any host/CLI default system reminder"), rel);
  }

  // Idempotent second run changes nothing.
  const second = installAgentRules({ home });
  assert.equal(second.filter((r) => r.changed).length, 0);
});
