import { __test } from "./succession-lock-test-seam.mjs";
const acquirePrefixLock = (prefix, hooks, deps) => __test.acquirePrefixLock(prefix, {}, { ...deps, hooks });
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  classifyLiveness,
  makeLockRec,
  parseLockRec,
  procStartInfo,
  readBootId,
  readHostId
} from "../dist/runtime/local-files/succession-lock.js";

const STATIC_COMMAND_ENV = { LC_ALL: "C", TZ: "UTC0" };
let moduleCase = 0;

function successionLockSource() {
  return readFileSync(
    fileURLToPath(new URL("../src/runtime/local-files/succession-lock.ts", import.meta.url)),
    "utf8"
  );
}

const ALLOWED_PROCESS_PROPERTIES = new Set(["platform", "pid", "kill", "on", "off"]);

function isSpawnCallee(node) {
  if (ts.isParenthesizedExpression(node)) return isSpawnCallee(node.expression);
  if (ts.isIdentifier(node)) return node.text === "spawn" || node.text === "spawnSync";
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "spawn" || node.name.text === "spawnSync";
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && (isSpawnCallee(node.left) || isSpawnCallee(node.right));
}

function sourceSafetyViolations(source) {
  const file = ts.createSourceFile("succession-lock.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && (node.moduleSpecifier.text === "process" || node.moduleSpecifier.text === "node:process")
    ) {
      violations.push(`process import: ${node.getText(file)}`);
    }
    if (ts.isIdentifier(node) && (node.text === "globalThis" || node.text === "global")) {
      violations.push(`global reference: ${node.getText(file)}`);
    }
    if (
      ts.isIdentifier(node)
      && node.text === "process"
      && (!ts.isPropertyAccessExpression(node.parent)
        || node.parent.expression !== node
        || !ALLOWED_PROCESS_PROPERTIES.has(node.parent.name.text))
    ) {
      violations.push(`disallowed process access: ${node.getText(file)}`);
    }
    if (ts.isCallExpression(node) && isSpawnCallee(node.expression)) {
      const options = node.arguments[2];
      const hasStaticEnv = ts.isObjectLiteralExpression(options)
        && options.properties.some((property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
          && property.name.getText(file) === "env"
        );
      if (!hasStaticEnv) violations.push(`spawn without static env: ${node.getText(file)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

const self = {
  host: "machine-a",
  hostKind: "machine-id",
  boot: "boot-now",
  ns: "pid:[1]",
  timeNs: "time:[1]",
  pid: process.pid,
  start: "proc:1"
};
const record = {
  ...self,
  pid: 999_999_999,
  start: "proc:2",
  token: "a".repeat(20),
  at: Date.now()
};

function expectUndecidableWithoutPidProbe(holder, current, platform = "linux") {
  const kill = process.kill;
  let calls = 0;
  try {
    process.kill = () => {
      calls++;
      throw new Error("PID probe must not run");
    };
    assert.deepEqual(classifyLiveness(holder, current, {
      platform,
      probe: () => { throw new Error("start probe must not run"); }
    }), { verdict: "undecidable", datable: false });
    assert.equal(calls, 0, "host provenance must be checked before probing the PID");
  } finally {
    process.kill = kill;
  }
}

test("T-machine-id: a new record preserves the provenance of its machine identity", () => {
  const made = makeLockRec("b".repeat(20));
  assert.ok(made.hostKind === "machine-id" || made.hostKind === "weak");
  assert.equal(parseLockRec(JSON.parse(JSON.stringify(made))).hostKind, made.hostKind);
});

test("T-machine-id: only valid Linux machine-id and strict darwin IOPlatformUUID are strong", () => {
  const hostname = () => "fallback-host";
  assert.deepEqual(readHostId({
    platform: "linux",
    readFile: () => "0123456789abcdef0123456789abcdef\n",
    hostname
  }), { host: "0123456789abcdef0123456789abcdef", hostKind: "machine-id" });
  for (const value of ["", "uninitialized", "0123456789ABCDEF0123456789ABCDEF", "not-a-machine-id", "0".repeat(32)]) {
    assert.deepEqual(readHostId({ platform: "linux", readFile: () => value, hostname }), {
      host: "fallback-host",
      hostKind: "weak"
    }, `invalid Linux machine-id ${JSON.stringify(value)} is weak`);
  }
  assert.deepEqual(readHostId({
    platform: "darwin",
    hostname,
    ioreg: () => ({ status: 0, stdout: '  "IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789EF"\n' })
  }), { host: "a0b1c2d3-e4f5-6789-abcd-0123456789ef", hostKind: "machine-id" });
  assert.deepEqual(readHostId({
    platform: "darwin",
    hostname,
    ioreg: () => ({ status: 0, stdout: '"IOPlatformUUID" = "not-a-uuid"\n' })
  }), { host: "fallback-host", hostKind: "weak" });
  assert.deepEqual(readHostId({
    platform: "darwin",
    hostname,
    ioreg: () => ({ status: 0, stdout: '"IOPlatformUUID" = "00000000-0000-0000-0000-000000000000"\n' })
  }), { host: "fallback-host", hostKind: "weak" });
});

test("T-machine-id: failed or ambiguous host readers fall back to a weak identity", () => {
  const hostname = () => "fallback-host";
  const weak = { host: "fallback-host", hostKind: "weak" };
  assert.deepEqual(readHostId({
    platform: "linux",
    readFile: () => { throw new Error("cannot read machine-id"); },
    hostname
  }), weak);
  for (const ioreg of [
    () => ({ status: 1, stdout: '"IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789EF"' }),
    () => ({ status: 0, stdout: null }),
    () => ({ status: 0, stdout: '"IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789EF"\n"IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789EF"' }),
    () => ({ status: 0, stdout: '"IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789E-F"' }),
    () => { throw new Error("ioreg failed"); }
  ]) {
    assert.deepEqual(readHostId({ platform: "darwin", hostname, ioreg }), weak);
  }
  assert.deepEqual(readHostId({ platform: "win32", hostname: () => { throw new Error("no hostname"); } }), {
    host: "unknown-host",
    hostKind: "weak"
  });
  assert.deepEqual(readHostId({ platform: "win32", hostname: () => "  " }), {
    host: "unknown-host",
    hostKind: "weak"
  });
});

test("T-machine-id: unsupported platforms never read the Linux machine-id path", () => {
  for (const platform of ["freebsd", "win32"]) {
    const reads = [];
    assert.deepEqual(readHostId({
      platform,
      readFile: (path) => {
        reads.push(path);
        throw new Error("unsupported read");
      },
      hostname: () => "fallback-host"
    }), { host: "fallback-host", hostKind: "weak" });
    assert.deepEqual(reads, [], `${platform} must not read /etc/machine-id`);
  }
});

test("T-structurel: succession-lock permits only explicit process properties and static command environments", () => {
  const source = successionLockSource();
  assert.deepEqual(sourceSafetyViolations(source), []);
  for (const [label, probe] of [
    ["named process import", 'import { env } from "node:process";'],
    ["namespace process import", 'import * as proc from "node:process"; proc.env;'],
    ["globalThis process", "globalThis.process.env;"],
    ["parenthesized process", "(process).env;"],
    ["template-computed process", "process[`env`];"],
    ["process alias", "const p = process; p.env;"],
    ["destructured assignment", "({ env: x } = process);"],
    ["Reflect process access", 'Reflect.get(process, "env");'],
    ["spawn without env", 'spawnSync("/bin/true", [], { encoding: "utf8" });']
  ]) {
    assert.notDeepEqual(sourceSafetyViolations(`${probe}\n${source}`), [], `${label} must be rejected`);
  }
});

test("T-machine-id: host, boot, and ps commands use absolute paths with a static environment", () => {
  const ioregCalls = [];
  const host = readHostId({
    platform: "darwin",
    hostname: () => "fallback-host",
    spawn: (command, args, options) => {
      ioregCalls.push({ command, args, options });
      return { status: 0, stdout: '"IOPlatformUUID" = "A0B1C2D3-E4F5-6789-ABCD-0123456789EF"\n' };
    }
  });
  assert.equal(host.hostKind, "machine-id");
  assert.deepEqual(ioregCalls, [{
    command: "/usr/sbin/ioreg",
    args: ["-rd1", "-c", "IOPlatformExpertDevice"],
    options: { encoding: "utf8", timeout: 2000, env: STATIC_COMMAND_ENV }
  }]);

  for (const [platform, command] of [["linux", "/usr/sbin/sysctl"], ["darwin", "/usr/sbin/sysctl"], ["freebsd", "/sbin/sysctl"], ["openbsd", "/sbin/sysctl"]]) {
    const sysctlCalls = [];
    assert.equal(readBootId({
      platform,
      readFile: () => { throw new Error("no proc boot id"); },
      spawn: (actual, args, options) => {
        sysctlCalls.push({ command: actual, args, options });
        return { status: 0, stdout: "boot-session\n" };
      }
    }), "boot-session");
    assert.deepEqual(sysctlCalls, [{
      command,
      args: ["-n", "kern.bootsessionuuid"],
      options: { encoding: "utf8", timeout: 2000, env: STATIC_COMMAND_ENV }
    }], `${platform} sysctl command`);

    const fallbackCalls = [];
    assert.equal(readBootId({
      platform,
      readFile: () => { throw new Error("no proc boot id"); },
      spawn: (actual, args, options) => {
        fallbackCalls.push({ command: actual, args, options });
        return fallbackCalls.length === 1
          ? { status: 1, stdout: "" }
          : { status: 0, stdout: "boot-time\n" };
      }
    }), "boot-time");
    assert.deepEqual(fallbackCalls, [{
      command,
      args: ["-n", "kern.bootsessionuuid"],
      options: { encoding: "utf8", timeout: 2000, env: STATIC_COMMAND_ENV }
    }, {
      command,
      args: ["-n", "kern.boottime"],
      options: { encoding: "utf8", timeout: 2000, env: STATIC_COMMAND_ENV }
    }], `${platform} fallback sysctl command`);
  }

  const psCalls = [];
  assert.deepEqual(procStartInfo(42, "darwin", () => false, (command, args, options) => {
    psCalls.push({ command, args, options });
    return { status: 0, stdout: "Mon Sep 24 08:44:00 2026\n" };
  }), { start: "ps:Mon Sep 24 08:44:00 2026" });
  assert.deepEqual(psCalls, [{
    command: "/bin/ps",
    args: ["-o", "lstart=", "-p", "42"],
    options: { encoding: "utf8", timeout: 5000, env: STATIC_COMMAND_ENV }
  }]);
});

test("T-machine-id: me memoizes host acquisition across lock operations", {
  skip: process.platform !== "linux" && "requires Linux machine-id acquisition"
}, async () => {
  const require = createRequire(import.meta.url);
  const fs = require("node:fs");
  const childProcess = require("node:child_process");
  const originalReadFileSync = fs.readFileSync;
  const originalSpawnSync = childProcess.spawnSync;
  let machineIdReads = 0;
  let hostIdentitySpawns = 0;
  try {
    fs.readFileSync = (path, ...args) => {
      if (path === "/etc/machine-id") machineIdReads++;
      return originalReadFileSync(path, ...args);
    };
    childProcess.spawnSync = (...args) => {
      if (args[0] === "/usr/sbin/ioreg") hostIdentitySpawns++;
      return originalSpawnSync(...args);
    };
    syncBuiltinESMExports();
    const lock = await import(`${new URL("../dist/runtime/local-files/succession-lock.js", import.meta.url).href}?case=${moduleCase++}`);
    const first = lock.me();
    assert.strictEqual(lock.me(), first, "me returns the memoized identity object");
    const record = lock.makeLockRec("c".repeat(20));
    lock.makeLockRec("d".repeat(20));
    assert.equal(lock.isCertainlyDead(record), false);
    assert.deepEqual({ machineIdReads, hostIdentitySpawns }, { machineIdReads: 1, hostIdentitySpawns: 0 });
  } finally {
    fs.readFileSync = originalReadFileSync;
    childProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
});

test("T-machine-id: a weak host rejects an existing lock without acquiring it", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-weak-host-"));
  try {
    const self = {
      host: "weak-observer",
      hostKind: "weak",
      boot: "boot-observer",
      ns: "pid:[1]",
      timeNs: "time:[1]",
      pid: process.pid,
      start: null
    };
    writeFileSync(join(prefix, ".h2a-upgrade.lock"), JSON.stringify({
      ...self,
      pid: 999_999_999,
      token: "e".repeat(20),
      at: Date.now()
    }), "utf8");
    const lease = acquirePrefixLock(prefix, {}, { self: () => self });
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "dead-undecidable");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

function lockIdentity(record) {
  return {
    host: record.host,
    hostKind: record.hostKind,
    boot: record.boot,
    ns: record.ns,
    timeNs: record.timeNs,
    pid: record.pid,
    start: record.start
  };
}

test("T-machine-id: injected self classifies successors and publishes every acquired record", {
  skip: !["linux", "darwin"].includes(process.platform) && "requires a supported liveness platform"
}, () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-injected-self-"));
  const holderToken = "f".repeat(20);
  const successorToken = "d".repeat(20);
  const self = {
    host: "injected-machine",
    hostKind: "machine-id",
    boot: "injected-boot",
    ns: "pid:[1]",
    timeNs: "time:[1]",
    pid: process.pid,
    start: null
  };
  try {
    writeFileSync(join(prefix, ".h2a-upgrade.lock"), JSON.stringify({
      ...self,
      pid: 999_999_999,
      token: holderToken,
      at: Date.now()
    }), "utf8");
    writeFileSync(join(prefix, `.h2a-upgrade.lock.succ.${holderToken}`), JSON.stringify({
      ...self,
      pid: 999_999_999,
      token: successorToken,
      target: holderToken,
      at: Date.now()
    }), "utf8");
    let publishedSuccessor;
    const lease = acquirePrefixLock(prefix, {
      afterPublishSucc: ({ path }) => {
        publishedSuccessor = JSON.parse(readFileSync(path, "utf8"));
      }
    }, { self: () => self });
    assert.equal(lease.acquired, true, "the injected identity classifies an existing successor");
    assert.deepEqual(lockIdentity(publishedSuccessor), self, "the new successor carries the injected identity");
    assert.deepEqual(
      lockIdentity(JSON.parse(readFileSync(join(prefix, ".h2a-upgrade.lock"), "utf8"))),
      self,
      "the replacement lock carries the injected identity"
    );
    lease.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-machine-id: a different strong machine identity stays undecidable", () => {
  expectUndecidableWithoutPidProbe({ ...record, host: "machine-b" }, self);
});

test("T-machine-id: hostname-only holder or observer stays undecidable before PID/start", () => {
  expectUndecidableWithoutPidProbe({ ...record, hostKind: "weak" }, self);
  expectUndecidableWithoutPidProbe(record, { ...self, hostKind: "weak" });
});

test("T-machine-id: legacy provenance is valid but undecidable before PID/start", () => {
  const legacy = { ...record };
  delete legacy.hostKind;
  assert.equal(parseLockRec(legacy).hostKind, undefined);
  assert.throws(() => parseLockRec({ ...record, hostKind: "hostname" }), /bad hostKind/);
  expectUndecidableWithoutPidProbe(legacy, self);
});

test("T-machine-id: a cloned machine-id with a different boot is not proof of death", () => {
  expectUndecidableWithoutPidProbe({ ...record, boot: "boot-other" }, self);
  expectUndecidableWithoutPidProbe({ ...record, boot: "boot-other" }, self, "darwin");
});

test("T-machine-id: an unknown boot on either side is not proof of co-location", () => {
  expectUndecidableWithoutPidProbe({ ...record, boot: null }, self);
  expectUndecidableWithoutPidProbe(record, { ...self, boot: null });
});

test("T-machine-id: unsupported platforms cannot prove co-location", () => {
  expectUndecidableWithoutPidProbe(record, self, "win32");
});
