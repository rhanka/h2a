import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "docs", "uat", "uat-doctor.sh");

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function fingerprintPath(root) {
  const hash = createHash("sha256");
  function visit(absolute, relative) {
    let stat;
    try {
      stat = lstatSync(absolute, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        hash.update(`ABSENT\0${relative}\0`);
        return;
      }
      throw error;
    }
    const type = stat.isDirectory() ? "d" : stat.isFile() ? "f" : stat.isSymbolicLink() ? "l" : "o";
    hash.update([
      type,
      relative,
      String(stat.mode),
      String(stat.size),
      String(stat.mtimeNs)
    ].join("\0") + "\0");
    if (stat.isSymbolicLink()) {
      hash.update(readlinkSync(absolute) + "\0");
    } else if (stat.isFile()) {
      hash.update(readFileSync(absolute));
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) {
        visit(join(absolute, entry), relative === "." ? entry : `${relative}/${entry}`);
      }
    }
  }
  visit(root, ".");
  return hash.digest("hex");
}

function createFixture(label, pathsWithSpaces) {
  const outer = mkdtempSync(join(tmpdir(), `h2a-uat-doctor-${label}-`));
  const root = pathsWithSpaces ? join(outer, "fixture paths with spaces") : join(outer, "fixture");
  const ownerHome = join(root, "owner home");
  const defaultCodex = join(ownerHome, ".codex");
  const defaultClaude = join(ownerHome, ".claude");
  const customCodex = join(root, "custom codex root");
  const customClaude = join(root, "custom claude root");
  const scratch = join(root, "temporary runs");
  const fakeBin = join(root, "fake bin");
  const fakeDoctor = join(root, "fake candidate", "doctor.mjs");
  const mutatingNodeTest = join(root, "mutating node test", "owner-root-write.test.mjs");

  for (const path of [defaultCodex, defaultClaude, customCodex, customClaude, scratch, fakeBin]) {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "owner-sentinel.txt"), `${label}:${path}\n`);
  }
  writeFileSync(join(ownerHome, ".claude.json"), `{"owner":"${label}"}\n`);

  mkdirSync(dirname(fakeDoctor), { recursive: true });
  writeFileSync(
    fakeDoctor,
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const bus = rootIndex >= 0 ? args[rootIndex + 1] : "";
if (args[0] === "init") {
  mkdirSync(bus, { recursive: true });
  process.exit(0);
}
if (args[0] !== "doctor") process.exit(64);

if (process.env.UAT_INTERRUPT_READY) {
  writeFileSync(process.env.UAT_INTERRUPT_READY, "ready\\n");
  await new Promise(() => {});
}

const dryRun = args.includes("--dry-run");
const codexRoot = process.env.CODEX_HOME || join(process.env.HOME, ".codex");
const configPath = join(codexRoot, "config.toml");
const claudeNativePath = join(process.env.HOME, ".claude.json");
if (
  dryRun &&
  process.env.UAT_TEST_OWNER_MUTATION &&
  (!process.env.UAT_TEST_OWNER_MUTATION_ROOT || codexRoot === process.env.UAT_TEST_OWNER_MUTATION_ROOT)
) {
  const mutationPath = process.env.UAT_TEST_OWNER_MUTATION === "volatile"
    ? join(codexRoot, "logs", "logs_2.sqlite")
    : configPath;
  mkdirSync(dirname(mutationPath), { recursive: true });
  writeFileSync(mutationPath, "mutation:" + Date.now() + "\\n");
}
if (
  dryRun &&
  process.env.UAT_TEST_CLAUDE_NATIVE_MUTATION &&
  (!process.env.UAT_TEST_CLAUDE_NATIVE_ROOT || claudeNativePath === process.env.UAT_TEST_CLAUDE_NATIVE_ROOT)
) {
  const claudeNative = JSON.parse(readFileSync(claudeNativePath, "utf8"));
  if (process.env.UAT_TEST_CLAUDE_NATIVE_MUTATION === "volatile") {
    claudeNative.pluginUsage ??= {};
    claudeNative.pluginUsage["h2a@sentropic"] ??= {};
    claudeNative.pluginUsage["h2a@sentropic"].usageCount =
      (claudeNative.pluginUsage["h2a@sentropic"].usageCount ?? 0) + 1;
    claudeNative.promptQueueUseCount = (claudeNative.promptQueueUseCount ?? 0) + 1;
  } else {
    claudeNative.owner = "candidate-mutation";
  }
  writeFileSync(claudeNativePath, JSON.stringify(claudeNative) + "\\n");
}
const live = existsSync(join(bus, "presence", "uat-probe.json"));
let brokenMarketplace = false;
try { brokenMarketplace = readFileSync(configPath, "utf8").includes("/disparu"); } catch {}

if (!dryRun && brokenMarketplace) {
  const current = readFileSync(configPath, "utf8");
  writeFileSync(configPath, current.replace(/source = ".*\\/disparu"/, 'source = "https://github.com/rhanka/h2a.git"'));
}
if (!dryRun && live) {
  const marker = join(codexRoot, "h2a-repair.json");
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, JSON.stringify({ repairedAt: new Date().toISOString(), repairedPaths: [codexRoot] }) + "\\n");
}

const invalid = live || (dryRun && brokenMarketplace);
const report = {
  ok: !invalid,
  checks: {
    hostInstallations: { hosts: [{ host: "codex", findings: [], changed: [] }] },
    liveHostSessions: {
      restartRequired: live ? [{ sessionId: "uat-probe", host: "codex", message: "live session must restart" }] : []
    }
  },
  unrepaired: []
};
process.stdout.write(JSON.stringify(report) + "\\n");
process.exit(invalid ? 2 : 0);
`
  );

  writeExecutable(
    join(fakeBin, "codex"),
    `#!/usr/bin/env bash
set -u
if [ "\${1-}" = "mcp" ] && [ "\${2-}" = "list" ]; then
  printf '%s\\n' 'Name  Command  Args       Env  Cwd  Status   Auth' 'h2a  h2a  mcp-serve  -  -  enabled  Unsupported'
  exit 0
fi
if [ "\${1-}" = "plugin" ] && [ "\${2-}" = "marketplace" ] && [ "\${3-}" = "list" ]; then
  printf '%s\\n' 'MARKETPLACE  ROOT' 'sentropic  /tmp/catalog'
  exit 0
fi
exit 0
`
  );
  writeExecutable(join(fakeBin, "claude"), "#!/usr/bin/env bash\nexit 0\n");

  mkdirSync(dirname(mutatingNodeTest), { recursive: true });
  writeFileSync(
    mutatingNodeTest,
    `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("writes only below the isolated HOME defaults", () => {
  for (const root of [
    process.env.CODEX_HOME || join(process.env.HOME, ".codex"),
    process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, ".claude")
  ]) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "node-test-was-here"), "isolated\\n");
  }
});
`
  );

  return {
    outer,
    root,
    ownerHome,
    defaultCodex,
    defaultClaude,
    customCodex,
    customClaude,
    scratch,
    fakeBin,
    fakeDoctor,
    mutatingNodeTest
  };
}

function injectedEnvironment(fixture, overrides = {}) {
  const env = {
    ...process.env,
    HOME: fixture.ownerHome,
    PATH: `${fixture.fakeBin}:${process.env.PATH}`,
    TMPDIR: fixture.scratch,
    UAT_TMP_PARENT: fixture.scratch,
    UAT_SOURCE_DIR: REPO_ROOT,
    UAT_DOCTOR_BIN: fixture.fakeDoctor,
    UAT_NODE_TEST_FILE: fixture.mutatingNodeTest,
    ...overrides
  };
  delete env.CODEX_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

function commandPath(command) {
  for (const directory of process.env.PATH.split(":")) {
    const candidate = join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`required local command ${command} was not found`);
}

function linkFixtureCommands(fixture, commands) {
  for (const command of commands) {
    const destination = join(fixture.fakeBin, command);
    if (!existsSync(destination)) symlinkSync(commandPath(command), destination);
  }
}

function ownedCandidateEnvironment(fixture, ready) {
  const candidate = join(fixture.root, "candidate source");
  const doctor = join(candidate, "packages", "h2a", "dist", "bin.js");
  mkdirSync(join(candidate, "docs", "uat"), { recursive: true });
  mkdirSync(join(candidate, "packages", "h2a", "test"), { recursive: true });
  mkdirSync(join(doctor, ".."), { recursive: true });
  writeFileSync(join(candidate, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(candidate, "packages", "h2a", "package.json"), '{"version":"0.99.0-uat"}\n');
  writeFileSync(
    join(candidate, "docs", "uat", "probe-oracle.sh"),
    "#!/bin/sh\nprintf ready > \"$UAT_INTERRUPT_READY\"\nexec node -e 'setInterval(() => {}, 1000)'\n"
  );
  writeFileSync(join(candidate, "docs", "uat", "probe-live-session.sh"), "");
  writeFileSync(join(candidate, "packages", "h2a", "test", "host-installation-doctor.test.js"), "");
  writeFileSync(
    doctor,
    "import { mkdirSync } from \"node:fs\";\n" +
      "const args = process.argv.slice(2);\n" +
      "if (args[0] === \"init\") { mkdirSync(args[args.indexOf(\"--root\") + 1], { recursive: true }); process.exit(0); }\n" +
      "process.stdout.write(\"{\\\"ok\\\":true}\\n\");\n"
  );

  linkFixtureCommands(fixture, ["bash", "env", "node", "tar", "dirname", "mkdir", "mktemp", "rm"]);
  writeExecutable(
    join(fixture.fakeBin, "git"),
    `#!/bin/sh
if [ "$1" = "-C" ]; then shift 2; fi
[ -z "\${UAT_GIT_TRACE-}" ] || printf '%s\\n' "$*" >> "$UAT_GIT_TRACE"
case "$1" in
  rev-parse)
    case "\${2-}" in
      --is-inside-work-tree) printf '%s\\n' true ;;
      --verify) printf '%s\\n' '0123456789abcdef0123456789abcdef01234567' ;;
      --short=12) printf '%s\\n' '0123456789ab' ;;
      *) printf '%s\\n' "unexpected git rev-parse invocation: $*" >&2; exit 64 ;;
    esac
    ;;
  archive) exec "$UAT_TEST_TAR" -cf - -C "$UAT_FAKE_CANDIDATE_SOURCE" . ;;
  *) printf '%s\\n' "unexpected git invocation: $*" >&2; exit 64 ;;
esac
`
  );
  writeExecutable(join(fixture.fakeBin, "npm"), "#!/bin/sh\nexit 0\n");

  const env = {
    ...process.env,
    HOME: fixture.ownerHome,
    PATH: fixture.fakeBin,
    TMPDIR: fixture.scratch,
    UAT_TMP_PARENT: fixture.scratch,
    UAT_FAKE_CANDIDATE_SOURCE: candidate,
    UAT_INTERRUPT_READY: ready,
    UAT_GIT_TRACE: join(fixture.root, "git-trace"),
    UAT_TEST_TAR: commandPath("tar")
  };
  delete env.CODEX_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.UAT_SOURCE_DIR;
  delete env.UAT_DOCTOR_BIN;
  return env;
}

async function waitForFile(path) {
  const deadline = Date.now() + 5000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(existsSync(path), `timed out waiting for ${path}`);
}

function waitForClose(child) {
  return new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
}

const matrix = [
  { label: "no-host-roots", codex: false, claude: false, spaces: false },
  { label: "codex-only", codex: true, claude: false, spaces: false },
  { label: "claude-only", codex: false, claude: true, spaces: false },
  { label: "both-host-roots", codex: true, claude: true, spaces: false },
  { label: "roots-with-spaces", codex: true, claude: true, spaces: true }
];

for (const scenario of matrix) {
  test(`uat-doctor should preserve every owner root when ${scenario.label}`, () => {
    const fixture = createFixture(scenario.label, scenario.spaces);
    try {
      const env = {
        ...process.env,
        HOME: fixture.ownerHome,
        PATH: `${fixture.fakeBin}:${process.env.PATH}`,
        TMPDIR: fixture.scratch,
        UAT_TMP_PARENT: fixture.scratch,
        UAT_SOURCE_DIR: REPO_ROOT,
        UAT_DOCTOR_BIN: fixture.fakeDoctor,
        UAT_NODE_TEST_FILE: fixture.mutatingNodeTest
      };
      delete env.CODEX_HOME;
      delete env.CLAUDE_CONFIG_DIR;
      if (scenario.codex) env.CODEX_HOME = fixture.customCodex;
      if (scenario.claude) env.CLAUDE_CONFIG_DIR = fixture.customClaude;

      const protectedRoots = [
        fixture.defaultCodex,
        fixture.defaultClaude,
        fixture.customCodex,
        fixture.customClaude,
        join(fixture.ownerHome, ".claude.json")
      ];
      const before = protectedRoots.map(fingerprintPath);
      const result = spawnSync("bash", [SCRIPT], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8"
      });
      const after = protectedRoots.map(fingerprintPath);

      assert.deepEqual(after, before, `owner roots changed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 3/);
      assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 0/);
      assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 1/);
      assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 2/);

      const order = [
        result.stdout.indexOf("=== scenario 3"),
        result.stdout.indexOf("=== scenario 0"),
        result.stdout.indexOf("=== scenario 1"),
        result.stdout.indexOf("=== scenario 2")
      ];
      assert.ok(order.every((value) => value >= 0), result.stdout);
      assert.deepEqual([...order].sort((a, b) => a - b), order, result.stdout);
      assert.equal(readFileSync(SCRIPT, "utf8").includes("env $PREFIXE"), false);
    } finally {
      rmSync(fixture.outer, { recursive: true, force: true });
    }
  });
}

test("uat-doctor should ignore a large non-configuration owner file", () => {
  const fixture = createFixture("large-owner-file", false);
  const largeFile = join(fixture.defaultCodex, "sparse-over-2gib");
  try {
    writeFileSync(largeFile, "");
    truncateSync(largeFile, 2 ** 31 + 1);
    const before = statSync(largeFile, { bigint: true }).size;
    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(statSync(largeFile, { bigint: true }).size, before);
    assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 3/);
    assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 2/);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should ignore volatile Codex activity while guarding owner configuration", () => {
  const fixture = createFixture("volatile-owner-activity", false);
  try {
    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_OWNER_MUTATION: "volatile",
        UAT_TEST_OWNER_MUTATION_ROOT: fixture.defaultCodex
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(existsSync(join(fixture.defaultCodex, "logs", "logs_2.sqlite")));
    assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 3/);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should ignore the measured volatile keys in .claude.json", () => {
  const fixture = createFixture("volatile-claude-native", false);
  const nativePath = join(fixture.ownerHome, ".claude.json");
  try {
    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_CLAUDE_NATIVE_MUTATION: "volatile",
        UAT_TEST_CLAUDE_NATIVE_ROOT: nativePath
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /configuration owner \. IDENTIQUE avant\/apres scenario 3/);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should name a nonvolatile .claude.json key mutation", () => {
  const fixture = createFixture("nonvolatile-claude-native", false);
  const nativePath = join(fixture.ownerHome, ".claude.json");
  try {
    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_CLAUDE_NATIVE_MUTATION: "configuration",
        UAT_TEST_CLAUDE_NATIVE_ROOT: nativePath
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(`MODIFIE : ${nativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#owner`));
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should fail for a volatile .claude.json mutation when whole-file fingerprinting returns", () => {
  const fixture = createFixture("volatile-claude-native-counter-mutant", false);
  const nativePath = join(fixture.ownerHome, ".claude.json");
  const mutantScript = join(fixture.root, "mutant checkout", "docs", "uat", "uat-doctor.sh");
  const source = readFileSync(SCRIPT, "utf8");
  const needle = "recordClaudeNative(claudeNative, true);";
  const mutant = source.replace(needle, "record(claudeNative, true);");
  try {
    assert.notEqual(mutant, source, "whole-file counter-mutant insertion point disappeared");
    writeExecutable(mutantScript, mutant);
    const result = spawnSync("bash", [mutantScript], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_CLAUDE_NATIVE_MUTATION: "volatile",
        UAT_TEST_CLAUDE_NATIVE_ROOT: nativePath
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(`MODIFIE : ${nativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should reject and name an owner configuration mutation", () => {
  const fixture = createFixture("owner-config-mutation", false);
  const configPath = join(fixture.defaultCodex, "config.toml");
  try {
    writeFileSync(configPath, "before=1\n");
    const result = spawnSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_OWNER_MUTATION: "configuration",
        UAT_TEST_OWNER_MUTATION_ROOT: fixture.defaultCodex
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /configuration owner a change pendant scenario 3/);
    assert.ok(result.stderr.includes(`MODIFIE : ${configPath}`), result.stderr);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor volatile exclusion should fail when logs_2.sqlite is reintroduced into the fingerprint", () => {
  const fixture = createFixture("volatile-counter-mutant", false);
  const mutantScript = join(fixture.root, "mutant checkout", "docs", "uat", "uat-doctor.sh");
  const source = readFileSync(SCRIPT, "utf8");
  const needle = "if (isVolatileConfigurationPath(relative)) return false;";
  const mutant = source.replace(
    needle,
    'if (relative.endsWith("logs_2.sqlite")) return true;\\n    ' + needle
  );
  try {
    assert.notEqual(mutant, source, "counter-mutant insertion point disappeared");
    writeExecutable(mutantScript, mutant);
    const result = spawnSync("bash", [mutantScript], {
      cwd: REPO_ROOT,
      env: injectedEnvironment(fixture, {
        UAT_TEST_OWNER_MUTATION: "volatile",
        UAT_TEST_OWNER_MUTATION_ROOT: fixture.defaultCodex
      }),
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /logs_2\.sqlite/);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
test(`uat-doctor should clean its temporary tree and return 130 when interrupted by ${signal}`, async () => {
  const fixture = createFixture("interrupt", false);
  const ready = join(fixture.root, "doctor-started");
  const scratchBefore = readdirSync(fixture.scratch);
  let child;
  try {
    child = spawn("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: ownedCandidateEnvironment(fixture, ready),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = waitForClose(child);

    try {
      await waitForFile(ready);
    } catch (error) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (killError) {
        if (killError?.code !== "ESRCH") throw killError;
      }
      const result = await closed;
      assert.fail(`${error.message}\nchild:${JSON.stringify(result)}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    process.kill(-child.pid, signal);
    const result = await closed;

    assert.deepEqual(result, { code: 130, signal: null }, `stdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.deepEqual(readdirSync(fixture.scratch), scratchBefore, `stdout:\n${stdout}\nstderr:\n${stderr}`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});
}

test("uat-doctor should resolve checkout HEAD without invoking gh", async () => {
  const fixture = createFixture("checkout-head", false);
  const ready = join(fixture.root, "doctor-started");
  let child;
  try {
    const env = ownedCandidateEnvironment(fixture, ready);
    child = spawn("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = waitForClose(child);

    await waitForFile(ready);
    process.kill(-child.pid, "SIGTERM");
    const result = await closed;

    assert.deepEqual(result, { code: 130, signal: null }, `stdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.match(stdout, /candidat \.\.\.\.\.\.\.\.\.\.\.\. 0123456789ab \(version 0\.99\.0-uat\)/);
    assert.match(stdout, /provenance \.\.\.\.\.\.\.\.\.\. HEAD du checkout/);
    assert.doesNotMatch(stderr, /gh/);
    assert.match(readFileSync(env.UAT_GIT_TRACE, "utf8"), /rev-parse --verify --end-of-options HEAD\^\{commit\}/);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should use an explicit release tag without invoking gh", async () => {
  const fixture = createFixture("explicit-sha", false);
  const ready = join(fixture.root, "doctor-started");
  let child;
  try {
    const env = ownedCandidateEnvironment(fixture, ready);
    env.H2A_UAT_SHA = "release-0.99.0";
    child = spawn("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = waitForClose(child);

    await waitForFile(ready);
    process.kill(-child.pid, "SIGTERM");
    const result = await closed;

    assert.deepEqual(result, { code: 130, signal: null }, `stdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.match(stdout, /candidat \.\.\.\.\.\.\.\.\.\.\.\. 0123456789ab \(version 0\.99\.0-uat\)/);
    assert.match(stdout, /provenance \.\.\.\.\.\.\.\.\.\. H2A_UAT_SHA fourni \(release-0\.99\.0\)/);
    assert.doesNotMatch(stderr, /gh/);
    assert.match(readFileSync(env.UAT_GIT_TRACE, "utf8"), /rev-parse --verify --end-of-options release-0\.99\.0\^\{commit\}/);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor rejects the PR 94 candidate-resolution mutant without gh", () => {
  const fixture = createFixture("pr-94-mutant", false);
  const ready = join(fixture.root, "doctor-started");
  try {
    const candidate = "CANDIDATE=$(git -C \"$REPO_ROOT\" rev-parse --verify --end-of-options \"${CANDIDATE_REFERENCE}^{commit}\")";
    const source = readFileSync(SCRIPT, "utf8");
    assert.match(source, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const mutant = join(fixture.root, "uat-doctor-pr-94-mutant.sh");
    writeExecutable(mutant, source.replace(
      candidate,
      "CANDIDATE=$(gh pr view 94 --json headRefOid --jq .headRefOid)"
    ));
    const env = ownedCandidateEnvironment(fixture, ready);
    env.LC_ALL = "C";
    env.LANG = "C";
    const result = spawnSync(commandPath("bash"), [mutant], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8"
    });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /ABANDON : reference candidat invalide 'HEAD'\./);
    assert.ok(!existsSync(ready), `the PR 94 mutant reached scenario 0:\n${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should name git as a missing prerequisite before creating temporary trees", () => {
  const fixture = createFixture("gitless", false);
  const scratchBefore = readdirSync(fixture.scratch);
  try {
    for (const command of ["bash", "node", "tar", "dirname", "mkdir", "mktemp", "rm"]) {
      symlinkSync(commandPath(command), join(fixture.fakeBin, command));
    }
    const env = {
      ...process.env,
      HOME: fixture.ownerHome,
      PATH: fixture.fakeBin,
      TMPDIR: fixture.scratch,
      UAT_TMP_PARENT: fixture.scratch
    };
    delete env.CODEX_HOME;
    delete env.CLAUDE_CONFIG_DIR;
    delete env.UAT_SOURCE_DIR;
    delete env.UAT_DOCTOR_BIN;
    const result = spawnSync(commandPath("bash"), [SCRIPT], { cwd: REPO_ROOT, env, encoding: "utf8" });

    assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stderr, /ABANDON : prerequis manquant : git\./);
    assert.doesNotMatch(result.stderr, /tar:/);
    assert.deepEqual(readdirSync(fixture.scratch), scratchBefore);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should document its checkout-root invocation and owner decision", () => {
  const result = spawnSync(commandPath("bash"), ["docs/uat/uat-doctor.sh"], {
    cwd: join(REPO_ROOT, "packages"),
    encoding: "utf8"
  });
  const guide = readFileSync(join(REPO_ROOT, "docs", "uat", "doctor-repair.md"), "utf8");

  assert.equal(result.status, 127, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(guide, /Depuis la racine d'un checkout Git contenant le candidat/);
  assert.match(guide, /H2A_UAT_SHA.*prioritaire/);
  assert.match(guide, /H2A_UAT_SHA=origin\/main/);
  assert.match(guide, /tag-de-release/);
  assert.match(guide, /pluginUsage.*promptQueueUseCount/s);
  assert.match(guide, /## Si le garde owner se déclenche/);
  assert.doesNotMatch(guide, /9004bcdee5b824c4dc41f0a6d2068328f486899b|PR 94|github\.com/);
  assert.doesNotMatch(guide, /Depuis n'importe quel répertoire du checkout de la PR/);
  assert.doesNotMatch(guide, /déjà rencontrée/);
  for (const question of [
    "Le scénario 2 montre-t-il bien code 2, `ok=false` et un motif de redémarrage ?",
    "Le scénario 1 s'est-il réparé sans poser de question ?",
    "Pendant ce passage, as-tu rencontré un comportement que la recette ne t'avait pas annoncé ?"
  ]) {
    assert.ok(guide.includes(question), `question owner absente : ${question}`);
  }
});
