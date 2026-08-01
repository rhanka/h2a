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
  writeExecutable(join(fixture.fakeBin, "gh"), "#!/bin/sh\necho test-candidate\n");
  writeExecutable(
    join(fixture.fakeBin, "git"),
    "#!/bin/sh\nexec \"$UAT_TEST_TAR\" -cf - -C \"$UAT_FAKE_CANDIDATE_SOURCE\" .\n"
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
      assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 3/);
      assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 0/);
      assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 1/);
      assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 2/);

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

test("uat-doctor should fingerprint an owner root containing a file larger than readFileSync's limit", () => {
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
    assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 3/);
    assert.match(result.stdout, /empreintes owner .... IDENTIQUES avant\/apres scenario 2/);
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

test("uat-doctor should name git as a missing prerequisite before creating temporary trees", () => {
  const fixture = createFixture("gitless", false);
  const scratchBefore = readdirSync(fixture.scratch);
  try {
    for (const command of ["bash", "node", "tar", "dirname", "mkdir", "mktemp", "rm"]) {
      symlinkSync(commandPath(command), join(fixture.fakeBin, command));
    }
    writeExecutable(join(fixture.fakeBin, "gh"), "#!/bin/sh\nexit 0\n");
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
    assert.doesNotMatch(result.stderr, /tar:|command not found/);
    assert.deepEqual(readdirSync(fixture.scratch), scratchBefore);
  } finally {
    rmSync(fixture.outer, { recursive: true, force: true });
  }
});

test("uat-doctor should document its checkout-root invocation when the relative command cannot run from packages", () => {
  const result = spawnSync(commandPath("bash"), ["docs/uat/uat-doctor.sh"], {
    cwd: join(REPO_ROOT, "packages"),
    encoding: "utf8"
  });
  const guide = readFileSync(join(REPO_ROOT, "docs", "uat", "doctor-repair.md"), "utf8");

  assert.equal(result.status, 127, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(guide, /Depuis la racine du checkout de la PR/);
  assert.doesNotMatch(guide, /Depuis n'importe quel répertoire du checkout de la PR/);
});
