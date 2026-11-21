// LH-01 node key store. Every case runs under a temporary config dir derived
// from TMPDIR; no live state, no real account and no network are ever touched.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  generateNodeKey,
  loadNodeKey,
  readNodeKeyStatus,
  deleteNodeKey,
  nodeKeyFingerprint,
  signTrunkAuthPayload,
  verifyTrunkAuthPayload
} from "../dist/runtime/remote-agent/index.js";

function makeConfigDir() {
  const base = mkdtempSync(join(process.env.TMPDIR, "lh01-"));
  const configDir = join(base, "config");
  mkdirSync(configDir, { recursive: true });
  return { base, configDir };
}

function cleanup(dirs) {
  rmSync(dirs.base, { recursive: true, force: true });
}

function listTree(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) listTree(p, out);
    else out.push(p);
  }
  return out;
}

const TOKEN_SHAPED = /(token|cookie|bearer|sessionSecret|password|api[_-]?key)/i;

test("generation creates a 0600 file in a temporary config dir", () => {
  const dirs = makeConfigDir();
  try {
    const key = generateNodeKey({ configDir: dirs.configDir });
    assert.equal(key.state, "present");
    const files = listTree(dirs.configDir);
    assert.equal(files.length >= 1, true, "expected key files on disk");
    for (const f of files) {
      const st = statSync(f);
      assert.equal(st.mode & 0o777, 0o600, `${f} must be 0600, got ${(st.mode & 0o777).toString(8)}`);
    }
  } finally {
    cleanup(dirs);
  }
});

test("second load returns the same node identifier and fingerprint", () => {
  const dirs = makeConfigDir();
  try {
    const first = generateNodeKey({ configDir: dirs.configDir });
    const second = loadNodeKey({ configDir: dirs.configDir });
    assert.equal(second.state, "present");
    assert.equal(second.nodeKey, undefined); // no leak of extra shape
    // compare on the public, non-secret surface
    const a = second.state === "present" ? second : null;
    assert.ok(a !== null);
    assert.equal(a.nodeId, first.nodeId);
    assert.equal(a.fingerprint, first.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  } finally {
    cleanup(dirs);
  }
});

test("fingerprint uses one fixed public-key byte encoding on both sides", () => {
  const dirs = makeConfigDir();
  try {
    const key = generateNodeKey({ configDir: dirs.configDir });
    assert.equal(key.state, "present");
    // deterministic: same public key -> same fingerprint
    const again = nodeKeyFingerprint(key.publicKeyPem);
    assert.equal(again, key.fingerprint);
    // a different key has a different fingerprint
    const dirs2 = makeConfigDir();
    try {
      const other = generateNodeKey({ configDir: dirs2.configDir });
      assert.equal(other.state, "present");
      assert.notEqual(other.fingerprint, key.fingerprint);
      assert.notEqual(other.nodeId, key.nodeId);
    } finally {
      cleanup(dirs2);
    }
    // verify side: sign/verify round-trips with the node key
    const payload = { nonce: "n", nodeId: key.nodeId, enrolmentRef: "enr", protocolVersions: [1], clientTime: 1 };
    const sig = signTrunkAuthPayload(payload, key.privateKeyPem);
    assert.equal(verifyTrunkAuthPayload(payload, sig, key.publicKeyPem), true);
  } finally {
    cleanup(dirs);
  }
});

test("delete removes key material and status reports missing", () => {
  const dirs = makeConfigDir();
  try {
    const before = readNodeKeyStatus({ configDir: dirs.configDir });
    assert.equal(before, "missing");
    generateNodeKey({ configDir: dirs.configDir });
    assert.equal(readNodeKeyStatus({ configDir: dirs.configDir }), "present");
    const deleted = deleteNodeKey({ configDir: dirs.configDir });
    assert.equal(deleted, true);
    assert.equal(readNodeKeyStatus({ configDir: dirs.configDir }), "missing");
    assert.equal(loadNodeKey({ configDir: dirs.configDir }).state, "missing");
    assert.deepEqual(listTree(dirs.configDir), []);
  } finally {
    cleanup(dirs);
  }
});

test("key loss is a named state requiring new enrolment, never a silent re-key", () => {
  const dirs = makeConfigDir();
  try {
    generateNodeKey({ configDir: dirs.configDir });
    // corrupt the material on disk (loss)
    const files = listTree(dirs.configDir);
    assert.equal(files.length >= 1, true);
    writeFileSync(files[0], "not-json");
    const status = readNodeKeyStatus({ configDir: dirs.configDir });
    assert.equal(status, "invalid");
    const loaded = loadNodeKey({ configDir: dirs.configDir });
    assert.equal(loaded.state, "invalid");
    assert.equal(loaded.requiresEnrolment, true);
    // load never regenerates: still invalid afterwards
    assert.equal(readNodeKeyStatus({ configDir: dirs.configDir }), "invalid");
  } finally {
    cleanup(dirs);
  }
});

test("no token-shaped field is written beside the key", () => {
  const dirs = makeConfigDir();
  try {
    generateNodeKey({ configDir: dirs.configDir });
    for (const f of listTree(dirs.configDir)) {
      const raw = readFileSync(f, "utf8");
      // JSON keys must come from the small allowlist; values are PEM material
      // and node metadata only. Empty when the file is PEM-like key material.
      let keys = [];
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") keys = Object.keys(obj);
      } catch {
        keys = [];
      }
      for (const k of keys) {
        assert.equal(TOKEN_SHAPED.test(k), false, `token-shaped field ${k} in ${f}`);
      }
      const allowlist = new Set(["nodeId", "publicKeyPem", "privateKeyPem", "fingerprint", "createdAt", "algorithm", "version"]);
      for (const k of keys) {
        assert.equal(allowlist.has(k), true, `unexpected field ${k} in ${f}`);
      }
    }
  } finally {
    cleanup(dirs);
  }
});
