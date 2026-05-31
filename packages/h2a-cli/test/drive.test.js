import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReplayGuard } from "@sentropic/h2a";
import {
  authorizeDrive,
  chainDriver,
  createLocalStore,
  formatSignedDriveInstruction,
  headlessDriver,
  localTmuxDriver,
  loggingDriver,
  nativeBackchannelDriver,
  parseSignedDriveInstruction,
  runCli,
  verifySignedDriveInstruction
} from "../dist/index.js";

const FROM = "claude:lead";
const TO = "codex:worker";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-drive-"));
}

function captureStreams(cwd = () => process.cwd()) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd
    },
    out: () => stdout,
    err: () => stderr
  };
}

function registerPair(store, publicKeyPem) {
  store.registerInstance({
    id: FROM,
    instance: FROM,
    roles: ["CONDUCTOR"],
    scopes: ["scope:demo"],
    capabilities: ["drive"],
    endpoints: [],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
  store.registerInstance({
    id: TO,
    instance: TO,
    roles: ["AGENTS"],
    scopes: ["scope:demo"],
    conductor: FROM,
    capabilities: ["execute"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
}

test("formatSignedDriveInstruction signs a visible h2a preamble that verifies once", () => {
  const { privateKeyPem, publicKeyPem } = keypair();
  const line = formatSignedDriveInstruction({
    from: FROM,
    to: TO,
    instruction: "Read your inbox and execute the assigned task.",
    nonce: "nonce-1",
    at: "2026-05-31T02:00:00.000Z",
    privateKeyPem
  });

  assert.match(line, /^\[h2a from=claude:lead to=codex:worker nonce=nonce-1 at=2026-05-31T02:00:00.000Z sig=/);
  assert.match(line, /] Read your inbox and execute the assigned task\.$/);
  assert.deepEqual(parseSignedDriveInstruction(line)?.payload, {
    from: FROM,
    to: TO,
    instruction: "Read your inbox and execute the assigned task.",
    nonce: "nonce-1",
    at: "2026-05-31T02:00:00.000Z"
  });

  const guard = createReplayGuard();
  const first = verifySignedDriveInstruction(line, {
    resolvePublicKeys: (instance) => (instance === FROM ? [publicKeyPem] : []),
    guard,
    now: Date.parse("2026-05-31T02:00:01.000Z")
  });
  assert.equal(first.ok, true);

  const replay = verifySignedDriveInstruction(line, {
    resolvePublicKeys: (instance) => (instance === FROM ? [publicKeyPem] : []),
    guard,
    now: Date.parse("2026-05-31T02:00:02.000Z")
  });
  assert.deepEqual(replay, { ok: false, reason: "replayed" });
});

test("verifySignedDriveInstruction rejects tampering and unknown signer keys", () => {
  const { privateKeyPem, publicKeyPem } = keypair();
  const other = keypair();
  const line = formatSignedDriveInstruction({
    from: FROM,
    to: TO,
    instruction: "Original instruction",
    nonce: "nonce-2",
    at: "2026-05-31T02:00:00.000Z",
    privateKeyPem
  });

  const tampered = line.replace("Original instruction", "Changed instruction");
  assert.equal(
    verifySignedDriveInstruction(tampered, {
      resolvePublicKeys: () => [publicKeyPem],
      guard: createReplayGuard(),
      now: Date.parse("2026-05-31T02:00:01.000Z")
    }).reason,
    "bad-signature"
  );
  assert.equal(
    verifySignedDriveInstruction(line, {
      resolvePublicKeys: () => [other.publicKeyPem],
      guard: createReplayGuard(),
      now: Date.parse("2026-05-31T02:00:01.000Z")
    }).reason,
    "bad-signature"
  );
});

test("authorizeDrive allows an explicit conductor relationship and rejects unrelated peers", () => {
  const root = freshRoot();
  try {
    const { publicKeyPem } = keypair();
    const store = createLocalStore({ root });
    registerPair(store, publicKeyPem);
    assert.deepEqual(authorizeDrive(store, { from: FROM, to: TO }), { ok: true });

    store.registerInstance({
      id: "codex:unrelated",
      instance: "codex:unrelated",
      roles: ["AGENTS"],
      scopes: ["scope:demo"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-31T00:00:00.000Z"
    });
    assert.deepEqual(authorizeDrive(store, { from: "codex:unrelated", to: TO }), {
      ok: false,
      reason: "unauthorized"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("localTmuxDriver sends the signed instruction into the target pane", async () => {
  const calls = [];
  const driver = localTmuxDriver({
    runtime: {
      run(file, args) {
        calls.push([file, ...args]);
        return true;
      },
      spawnDetached() {
        throw new Error("not used");
      }
    }
  });

  const ok = await driver.drive({
    to: TO,
    instructionLine: "[h2a from=a to=b nonce=n at=t sig=s] do it",
    launchContext: {
      cwd: "/work",
      command: "codex",
      tmux: { session: "main", window: "1", pane: "2" }
    }
  });

  assert.equal(ok, true);
  assert.deepEqual(calls[0], [
    "tmux",
    "send-keys",
    "-t",
    "main:1.2",
    "[h2a from=a to=b nonce=n at=t sig=s] do it",
    "Enter"
  ]);
});

test("chainDriver tries native, then tmux, then headless", async () => {
  const attempts = [];
  const driver = chainDriver(
    nativeBackchannelDriver({
      send: async () => {
        attempts.push("native");
        return false;
      }
    }),
    localTmuxDriver({
      runtime: {
        run() {
          attempts.push("tmux");
          return false;
        },
        spawnDetached() {
          throw new Error("not used");
        }
      }
    }),
    headlessDriver({
      runtime: {
        run() {
          throw new Error("not used");
        },
        spawnDetached(command) {
          attempts.push(`headless:${command}`);
          return true;
        }
      }
    })
  );

  const ok = await driver.drive({
    to: TO,
    instructionLine: "signed instruction",
    launchContext: {
      cwd: "/work",
      command: "codex exec",
      tmux: { session: "main", pane: "%1" }
    }
  });

  assert.equal(ok, true);
  assert.deepEqual(attempts, ["native", "tmux", "headless:codex exec 'signed instruction'"]);
});

test("h2a drive signs and dispatches an authorized instruction in logging mode", () => {
  const root = freshRoot();
  try {
    const { privateKeyPem, publicKeyPem } = keypair();
    const privateKeyPath = join(root, "driver.key.pem");
    writeFileSync(privateKeyPath, privateKeyPem, "utf8");
    const store = createLocalStore({ root });
    registerPair(store, publicKeyPem);

    const cap = captureStreams(() => root);
    const rc = runCli(
      [
        "drive",
        "--root",
        root,
        "--from",
        FROM,
        "--to",
        TO,
        "--instruction",
        "Read your inbox.",
        "--private-key",
        privateKeyPath,
        "--driver",
        "logging",
        "--nonce",
        "nonce-cli",
        "--at",
        "2026-05-31T02:00:00.000Z"
      ],
      cap.streams
    );

    assert.equal(rc, 0, cap.err());
    const out = JSON.parse(cap.out());
    assert.equal(out.ok, true);
    assert.equal(out.from, FROM);
    assert.equal(out.to, TO);
    assert.equal(out.driver, "logging");
    assert.equal(out.driven, true);
    assert.equal(
      verifySignedDriveInstruction(out.instructionLine, {
        resolvePublicKeys: (instance) => store.listInstanceKeys(instance),
        guard: createReplayGuard(),
        now: Date.parse("2026-05-31T02:00:01.000Z")
      }).ok,
      true
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a drive refuses an unauthorized driver before dispatch", () => {
  const root = freshRoot();
  try {
    const { privateKeyPem, publicKeyPem } = keypair();
    const privateKeyPath = join(root, "driver.key.pem");
    writeFileSync(privateKeyPath, privateKeyPem, "utf8");
    const store = createLocalStore({ root });
    registerPair(store, publicKeyPem);
    store.registerInstance({
      id: "codex:intruder",
      instance: "codex:intruder",
      roles: ["AGENTS"],
      scopes: ["scope:demo"],
      capabilities: [],
      endpoints: [],
      publicKeys: [publicKeyPem],
      acceptedPolicies: [],
      createdAt: "2026-05-31T00:00:00.000Z"
    });

    const cap = captureStreams(() => root);
    const rc = runCli(
      [
        "drive",
        "--root",
        root,
        "--from",
        "codex:intruder",
        "--to",
        TO,
        "--instruction",
        "Do it.",
        "--private-key",
        privateKeyPath,
        "--driver",
        "logging"
      ],
      cap.streams
    );

    assert.equal(rc, 2);
    assert.match(cap.err(), /unauthorized/);
    assert.equal(cap.out(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
