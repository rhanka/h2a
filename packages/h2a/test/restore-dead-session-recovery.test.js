import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { enroll, listLive, loadRegistry } from "../../h2a-runtime/dist/registry.js";
import { handleClaudeHook } from "../../h2a-runtime/dist/enroll.js";
import { discoverSessions, restore } from "../../h2a-runtime/dist/restore.js";
import { SESSION_CLASS_ENV } from "../../h2a-runtime/dist/session-class.js";
import { tmuxEnvironmentArgs } from "../../h2a-runtime/dist/tmux.js";

const NAMES = [
  "llm-mesh",
  "canevas",
  "architect",
  "sentropic-chat",
  "sentropic-app",
  "cowork",
  "auth",
  "conductor",
];

function conversationId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function writeCodexTranscript(home, cwd, id, mtimeMs) {
  const dir = join(home, ".codex", "sessions", "fixture");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ payload: { cwd, id } })}\n`, "utf8");
  const at = new Date(mtimeMs);
  utimesSync(file, at, at);
}

function writeClaudeTranscript(home, cwd, id, mtimeMs) {
  const dir = join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`, "utf8");
  const at = new Date(mtimeMs);
  utimesSync(file, at, at);
}

function makeFixture({ oneRegistrySessionLive }) {
  const root = mkdtempSync(join(tmpdir(), "h2a-restore-recovery-"));
  const home = join(root, "home");
  const configHome = join(root, "config");
  const configDir = join(configHome, ".config", "sentropic", "remote-cli");
  const project = join(home, "src", "sentropic");
  const jobOne = join(project, ".h2a", "jobs", "delegate-one", "wt");
  const jobTwo = join(project, ".h2a", "jobs", "delegate-two", "wt");
  const now = Date.now();
  const at = new Date(now - 1_000).toISOString();

  mkdirSync(project, { recursive: true });
  mkdirSync(jobOne, { recursive: true });
  mkdirSync(jobTwo, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      layout: {
        maxAgeHours: 48,
        maxPerWindow: 20,
        sharedWindows: 1,
        multiSession: {},
        multiSessionDefault: 1,
        groups: [],
      },
    }),
    "utf8",
  );

  const humans = NAMES.map((label, index) => ({
    id: label,
    tool: "claude",
    kind: oneRegistrySessionLive && index === 0 ? "local" : "local-tmux",
    cwd: project,
    label,
    convId: conversationId(index + 1),
    ...(oneRegistrySessionLive && index === 0
      ? { source: "hook" }
      : { source: "run", tmuxSession: `h2a-${label}` }),
    sessionClass: "human",
    enrolledAt: at,
    lastSeenAt: at,
  }));
  const jobs = [jobOne, jobTwo].map((cwd, index) => ({
    id: `delegate-${index + 1}`,
    tool: "codex",
    kind: "local-tmux",
    cwd,
    label: `delegate-${index + 1}`,
    convId: conversationId(index + 20),
    source: "run",
    tmuxSession: `h2a-delegate-${index + 1}`,
    sessionClass: "background",
    role: "job",
    jobState: "running",
    enrolledAt: at,
    lastSeenAt: at,
  }));
  writeFileSync(
    join(configDir, "registry.json"),
    JSON.stringify({ version: 1, entries: [...humans, ...jobs] }),
    "utf8",
  );

  // The scanner knows only transcript cwd/id. It receives no sessionClass/role:
  // the job transcripts are deliberately newest to make an exclusion fail open.
  for (let index = 0; index < NAMES.length; index++) {
    writeCodexTranscript(home, project, conversationId(index + 1), now - 10_000 - index);
  }
  writeCodexTranscript(home, jobOne, conversationId(20), now - 100);
  writeCodexTranscript(home, jobTwo, conversationId(21), now - 10);
  writeClaudeTranscript(home, jobOne, conversationId(30), now - 90);
  writeClaudeTranscript(home, jobTwo, conversationId(31), now - 80);

  return { root, home, configHome, project, jobOne, jobTwo };
}

function restoreDryRun(fixture) {
  const oldHome = process.env.HOME;
  const oldConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  let output = "";
  try {
    process.env.HOME = fixture.home;
    process.env.REMOTE_CLI_CONFIG_HOME = fixture.configHome;
    const result = restore({
      dryRun: true,
      stderr: { write: (chunk) => void (output += String(chunk)) },
    });
    assert.equal(result.total, 8, output);
    return output;
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = oldConfigHome;
  }
}

function assertEightHumansAndNoJobs(output, fixture) {
  for (const name of NAMES) {
    assert.match(output, new RegExp(`- ${name}\\s+claude \\(local\\)`));
  }
  assert.equal((output.match(/^    - /gm) ?? []).length, 8, output);
  assert.doesNotMatch(output, new RegExp(fixture.jobOne.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(output, new RegExp(fixture.jobTwo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

test("restore keeps all eight dead human sessions when one registry session is still live", (t) => {
  const fixture = makeFixture({ oneRegistrySessionLive: true });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const registryPath = join(fixture.configHome, ".config", "sentropic", "remote-cli", "registry.json");
  // This establishes the old listLive branch: only the no-pid local hook row
  // remains live; every tmux row is deliberately dead.
  assert.equal(listLive({ path: registryPath, tmuxHasSession: () => false, bootTimeMs: 0 }).length, 1);
  assertEightHumansAndNoJobs(restoreDryRun(fixture), fixture);
});

test("restore keeps all eight dead human sessions when no registry tmux session is live", (t) => {
  const fixture = makeFixture({ oneRegistrySessionLive: false });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const registryPath = join(fixture.configHome, ".config", "sentropic", "remote-cli", "registry.json");
  // This establishes the old scan-fallback branch: listLive would contribute
  // no registry candidates at all.
  assert.equal(listLive({ path: registryPath, tmuxHasSession: () => false, bootTimeMs: 0 }).length, 0);
  assertEightHumansAndNoJobs(restoreDryRun(fixture), fixture);
});

test("scanner keeps nested job worktrees distinct and unclassified", (t) => {
  const fixture = makeFixture({ oneRegistrySessionLive: false });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const scanned = discoverSessions(48 * 60 * 60 * 1_000, fixture.home);
  const projects = new Set(scanned.map((session) => session.project));
  assert.ok(projects.has("sentropic"));
  assert.ok(projects.has("sentropic/.h2a/jobs/delegate-one/wt"));
  assert.ok(projects.has("sentropic/.h2a/jobs/delegate-two/wt"));
  assert.ok(scanned.every((session) => session.restoreClass === "unclassified"));
  assert.equal(
    scanned.filter((session) => session.tool === "claude" && session.project.includes("/.h2a/jobs/")).length,
    2,
  );
});

test("registry enrollment requires an explicit restore class", (t) => {
  const root = mkdtempSync(join(tmpdir(), "h2a-restore-enrollment-"));
  const registryPath = join(root, "registry.json");
  const now = new Date(Date.now()).toISOString();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => enroll({
      id: "missing-class",
      tool: "claude",
      kind: "local-tmux",
      cwd: "/fixture/src/sentropic",
      source: "run",
    }, registryPath),
    /sessionClass/,
  );
  enroll({
    id: "human",
    tool: "claude",
    kind: "local-tmux",
    cwd: "/fixture/src/sentropic",
    source: "run",
    sessionClass: "human",
  }, registryPath);
  enroll({
    id: "job",
    tool: "codex",
    kind: "local-tmux",
    cwd: "/fixture/src/sentropic/.h2a/jobs/x/wt",
    source: "run",
    sessionClass: "background",
    role: "job",
    jobState: "running",
  }, registryPath);
  const entries = loadRegistry(registryPath);
  assert.deepEqual(entries.map((entry) => entry.sessionClass), ["human", "background"]);
  assert.ok(entries.every((entry) => entry.enrolledAt >= now));
});

test("a background h2a run stamps its Claude hook background by construction", (t) => {
  const fixture = makeFixture({ oneRegistrySessionLive: false });
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const registryPath = join(fixture.configHome, ".config", "sentropic", "remote-cli", "registry.json");

  // startLocalSession/startHeadlessSession pass this exact -e argument to tmux;
  // the marker is not inferred from a transcript or an optional role field.
  assert.deepEqual(
    tmuxEnvironmentArgs("background").slice(-2),
    ["-e", `${SESSION_CLASS_ENV}=background`],
  );
  enroll({
    id: "mcp-background-run",
    tool: "claude",
    kind: "local-tmux",
    cwd: fixture.jobOne,
    source: "run",
    tmuxSession: "h2a-mcp-background-run",
    sessionClass: "background",
  }, registryPath);
  assert.deepEqual(
    handleClaudeHook(
      "claude-start",
      JSON.stringify({ session_id: "mcp-background-hook", cwd: fixture.jobOne }),
      registryPath,
      { env: { [SESSION_CLASS_ENV]: "background" } },
    ),
    { ok: true },
  );
  assert.equal(
    loadRegistry(registryPath).find((entry) => entry.id === "mcp-background-hook")?.sessionClass,
    "background",
  );
  assertEightHumansAndNoJobs(restoreDryRun(fixture), fixture);

  assert.deepEqual(
    handleClaudeHook(
      "claude-start",
      JSON.stringify({ session_id: "invalid-marker", cwd: fixture.jobOne }),
      registryPath,
      { env: { [SESSION_CLASS_ENV]: "unexpected" } },
    ),
    { ok: false, error: `invalid ${SESSION_CLASS_ENV}` },
  );
  assert.equal(loadRegistry(registryPath).some((entry) => entry.id === "invalid-marker"), false);

  // No marker is also fail-closed: a future session kind cannot accidentally
  // become human merely because its hook payload has no role field.
  assert.deepEqual(
    handleClaudeHook(
      "claude-start",
      JSON.stringify({ session_id: "missing-marker", cwd: fixture.jobOne }),
      registryPath,
      { env: {} },
    ),
    { ok: true },
  );
  assert.equal(loadRegistry(registryPath).some((entry) => entry.id === "missing-marker"), false);
});
