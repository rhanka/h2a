import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyLiveness,
  makeLockRec,
  parseLockRec,
  readHostId
} from "../dist/runtime/local-files/succession-lock.js";

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
  for (const value of ["", "uninitialized", "0123456789ABCDEF0123456789ABCDEF", "not-a-machine-id"]) {
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
});

test("T-structurel: succession-lock has injectable host reads and no process.env", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/runtime/local-files/succession-lock.ts", import.meta.url)),
    "utf8"
  );
  assert.match(source, /export function readHostId\(deps: HostIdentityDeps = \{\}\)/);
  assert.doesNotMatch(source, /\bprocess\.env\b/);
});

test("T-structurel: static no-PATH tool calls use absolute executables", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/runtime/local-files/succession-lock.ts", import.meta.url)),
    "utf8"
  );
  assert.doesNotMatch(source, /spawnSync\(\s*["'](?:ioreg|ps|sysctl)["']/);
  assert.match(source, /const STATIC_COMMAND_ENV = \{ LC_ALL: "C", TZ: "UTC0" \};/);
  assert.match(
    source,
    /spawnSync\(\s*["']\/usr\/sbin\/ioreg["'][\s\S]{0,220}env:\s*STATIC_COMMAND_ENV/
  );
});

test("T-structurel: me reads the host only while initializing its cache", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/runtime/local-files/succession-lock.ts", import.meta.url)),
    "utf8"
  );
  const me = source.match(/export function me\(\): SelfIdent \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(me, "me() must remain present");
  assert.doesNotMatch(me, /^\s*const host = readHostId\(\);\s*\n\s*ME_CACHE \?\?=/m);
  assert.match(me, /ME_CACHE \?\?= \(\(\) => \{\s*const host = readHostId\(\);/);
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
