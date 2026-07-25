import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, runMirrorPush, MIRROR_PUSH_OFF_ENV } from "../dist/index.js";

// Timing seam: the daemon's real backoffs are seconds long. These tests drive the
// same production code path with an instant sleep and a zero-jitter random, so
// scheduling and stop rules are exercised without waiting for them. Nothing about
// WHAT is pushed, or when the daemon stops, is changed by this.
const FAST = { sleep: async () => {}, random: () => 0.5 };

// Feed-contract P1 step 4a — the CLI boundary of the mirror push daemon.
//
// The load-bearing property here is the OPT-IN: `h2a remote mirror` with no
// `--interval-ms` must behave exactly as it did before the daemon existed (one
// build, one POST, one JSON payload on stdout, exit on the status), and NOTHING
// in this surface may start pushing on its own.
//
// `globalThis.fetch` is stubbed for the whole file — no socket is ever opened and
// no hosted endpoint is ever contacted.

const INSTANCE = "testhost:ws:aaaaaaaaaaaa";
const URL_FAKE = "https://mirror.invalid/h2a/mirror";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

/** A root with INSTANCE registered and its private key on disk. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-mirror-cli-"));
  const root = join(dir, ".h2a");
  runCli(["init", "--root", root], captureStreams(dir));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "pem", type: "spki" }).toString();
  const keyPath = join(dir, "key.pem");
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  runCli(
    [
      "register",
      "--root",
      root,
      "--json",
      JSON.stringify({
        id: INSTANCE,
        instance: INSTANCE,
        roles: ["AGENTS"],
        scopes: ["scope:default"],
        capabilities: [],
        endpoints: [],
        publicKeys: [pub],
        acceptedPolicies: [],
        createdAt: "2026-07-24T00:00:00.000Z"
      })
    ],
    captureStreams(dir)
  );
  return { dir, root, keyPath };
}

/** Install a fetch stub that records calls and never touches the network. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url) });
    const spec = handler(calls.length, init);
    return {
      status: spec.status,
      json: async () => spec.body
    };
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    }
  };
}

test("DEFAULT (no --interval-ms) is unchanged: ONE push, the same JSON payload", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true, applied: [INSTANCE] } }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      { url: URL_FAKE, instance: INSTANCE, "private-key": keyPath, root },
      streams
    );
    assert.equal(rc, 0, "a 2xx one-shot still exits 0");
    assert.equal(stub.calls.length, 1, "exactly one POST — the one-shot did not become a loop");
    // The pre-daemon output contract: a pretty-printed { status, body }.
    const payload = JSON.parse(streams.stdoutText);
    assert.deepEqual(payload, { status: 202, body: { ok: true, applied: [INSTANCE] } });
    assert.equal(streams.stderrText, "", "the one-shot prints nothing on stderr on success");
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DEFAULT one-shot still exits 1 on a non-2xx, with no retry", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 401, body: { ok: false, reason: "unauthorized-key" } }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      { url: URL_FAKE, instance: INSTANCE, "private-key": keyPath, root },
      streams
    );
    assert.equal(rc, 1);
    assert.equal(stub.calls.length, 1, "a rejected one-shot is NOT retried");
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--interval-ms opts into the daemon: --max bounds it to N pushes", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      {
        url: URL_FAKE,
        instance: INSTANCE,
        "private-key": keyPath,
        root,
        "interval-ms": "5000",
        max: "2"
      },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 0);
    assert.equal(stub.calls.length, 2, "two cycles ⇒ two pushes");
    // One status line per cycle on stdout, plus the banner/summary on stderr.
    const lines = streams.stdoutText.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => l.outcome), ["ok", "ok"]);
    assert.equal(lines[0].endpoint, "https://mirror.invalid/h2a/mirror");
    assert.match(streams.stderrText, /stopped \(max-cycles\) after 2 cycles, 2 accepted/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the daemon STOPS on repeated 401 and exits 1 asking for re-enrollment", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 401, body: { ok: false, reason: "unauthorized-key" } }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      {
        url: URL_FAKE,
        instance: INSTANCE,
        "private-key": keyPath,
        root,
        "interval-ms": "5000",
        // A huge budget: the stop must come from the auth rule, not from --max.
        max: "1000"
      },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 1, "an auth stop is a failure exit, not a clean one");
    assert.equal(stub.calls.length, 3, "backed off 3 attempts, then stopped — no hammering");
    assert.match(streams.stderrText, /RE-ENROLLMENT IS REQUIRED/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the kill-switch makes the CLI daemon a no-op: nothing is sent", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  const previous = process.env[MIRROR_PUSH_OFF_ENV];
  process.env[MIRROR_PUSH_OFF_ENV] = "1";
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      { url: URL_FAKE, instance: INSTANCE, "private-key": keyPath, root, "interval-ms": "5000" },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 0, "a frozen daemon is a clean no-op, not an error");
    assert.equal(stub.calls.length, 0, "not one request was issued");
    assert.match(streams.stderrText, /H2A_MIRROR_PUSH_OFF is set/);
  } finally {
    if (previous === undefined) delete process.env[MIRROR_PUSH_OFF_ENV];
    else process.env[MIRROR_PUSH_OFF_ENV] = previous;
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The exact state the shipped systemd unit is in: kill-switch present AND all
// three ExecStart values still placeholders. This MUST be a clean exit-0 no-op —
// the unit file and the README both promise that. It used to read the private key
// first and exit 1 with "cannot read --private-key (ENOENT ...
// 'REPLACE_WITH_PRIVATE_KEY_PATH')", landing the unit in systemd `failed`.
test("the shipped-unit state (kill-switch + unfilled placeholders) is a clean exit-0 no-op", async () => {
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  const previous = process.env[MIRROR_PUSH_OFF_ENV];
  process.env[MIRROR_PUSH_OFF_ENV] = "1";
  try {
    const streams = captureStreams(process.cwd());
    const rc = await runMirrorPush(
      {
        url: "REPLACE_WITH_INGESTER_URL",
        instance: "REPLACE_WITH_INSTANCE_ID",
        "private-key": "REPLACE_WITH_PRIVATE_KEY_PATH",
        "interval-ms": "20000"
      },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 0, "the documented clean no-op, NOT an exit-1 failure");
    assert.equal(stub.calls.length, 0, "nothing sent");
    assert.match(streams.stderrText, /H2A_MIRROR_PUSH_OFF is set/);
    assert.ok(
      !/private-key/.test(streams.stderrText),
      "the key is never even read when the daemon is disabled"
    );
  } finally {
    if (previous === undefined) delete process.env[MIRROR_PUSH_OFF_ENV];
    else process.env[MIRROR_PUSH_OFF_ENV] = previous;
    stub.restore();
  }
});

// The state an operator is ACTUALLY in while editing the shipped unit: some
// placeholders replaced, and a `--private-key <path>` token pair accidentally
// dropped. The README promises a disarmed unit is `inactive (dead)`, "not a
// failure" — so that promise has to hold for a HALF-edited unit too. It used to
// exit 1 (required-flags check ran before the opt-in gate, hence before the
// kill-switch), pinning the unit in systemd `failed` with RestartPreventExitStatus.
test("a PARTIALLY edited unit (kill-switch + a missing required flag) still exits 0", async () => {
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  const previous = process.env[MIRROR_PUSH_OFF_ENV];
  process.env[MIRROR_PUSH_OFF_ENV] = "1";
  try {
    // Each case drops one required flag while the kill-switch is set.
    const partials = [
      { url: URL_FAKE, instance: INSTANCE, "interval-ms": "20000" }, // no --private-key
      { url: URL_FAKE, "private-key": "/nope", "interval-ms": "20000" }, // no --instance
      { instance: INSTANCE, "private-key": "/nope", "interval-ms": "20000" }, // no --url
      { "interval-ms": "20000" } // nothing filled in at all
    ];
    for (const flags of partials) {
      const streams = captureStreams(process.cwd());
      const rc = await runMirrorPush(flags, streams, undefined, FAST);
      assert.equal(rc, 0, `disarmed + ${JSON.stringify(flags)} must exit 0, not fail`);
      assert.match(streams.stderrText, /the live push is disabled/);
      assert.ok(
        !/required/.test(streams.stderrText),
        "a disabled daemon does not even judge its arguments"
      );
    }
    assert.equal(stub.calls.length, 0, "nothing sent");
  } finally {
    if (previous === undefined) delete process.env[MIRROR_PUSH_OFF_ENV];
    else process.env[MIRROR_PUSH_OFF_ENV] = previous;
    stub.restore();
  }
});

test("ARMED, the same missing flag is still an error (the contract is unchanged)", async () => {
  const streams = captureStreams(process.cwd());
  const rc = await runMirrorPush(
    { url: URL_FAKE, instance: INSTANCE, "interval-ms": "20000" },
    streams,
    undefined,
    FAST
  );
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--url, --instance and --private-key are required/);
});

test("--interval-ms=N (equals form) is refused, never silently downgraded to one-shot", async () => {
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  try {
    const streams = captureStreams(process.cwd());
    const rc = await runMirrorPush(
      { url: URL_FAKE, instance: INSTANCE, "private-key": "/nope", "interval-ms=20000": "true" },
      streams
    );
    assert.equal(rc, 1, "a mistyped opt-in must not quietly run as a one-shot");
    assert.match(streams.stderrText, /use "--interval-ms 20000"/);
    assert.equal(stub.calls.length, 0, "and must not push");
  } finally {
    stub.restore();
  }
});

test("the kill-switch short-circuits BEFORE flag validation too", async () => {
  const previous = process.env[MIRROR_PUSH_OFF_ENV];
  process.env[MIRROR_PUSH_OFF_ENV] = "1";
  try {
    const streams = captureStreams(process.cwd());
    // A deliberately invalid interval: disabled means nothing runs, so there is
    // nothing to validate and nothing to complain about.
    const rc = await runMirrorPush(
      { url: "nonsense", instance: "x", "private-key": "/nope", "interval-ms": "1" },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 0);
    assert.match(streams.stderrText, /the live push is disabled/);
  } finally {
    if (previous === undefined) delete process.env[MIRROR_PUSH_OFF_ENV];
    else process.env[MIRROR_PUSH_OFF_ENV] = previous;
  }
});

test("an unfilled or unusable --url is refused up front, not retried forever", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  try {
    // An EMPTY --url is caught earlier, by the unchanged required-flags check.
    for (const bad of ["REPLACE_WITH_INGESTER_URL", "mirror.example/h2a/mirror", "file:///tmp/x", "   "]) {
      const streams = captureStreams(dir);
      const rc = await runMirrorPush(
        {
          url: bad,
          instance: INSTANCE,
          "private-key": keyPath,
          root,
          "interval-ms": "5000",
          max: "1000"
        },
        streams,
        undefined,
        FAST
      );
      assert.equal(rc, 1, `--url ${JSON.stringify(bad)} must fail fast`);
      // The CLI emits the DOCUMENTED message, so the string an operator greps
      // for in the journal is the one the README's table lists.
      assert.match(streams.stderrText, /mirror push NOT STARTED: the push target is not a usable http\(s\) URL/);
    }
    assert.equal(stub.calls.length, 0, "an unusable URL pushes nothing, ever");
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the ONE-SHOT still accepts any --url (unchanged: the transport reports it)", async () => {
  // The url pre-flight is a daemon-only guard. The one-shot's behavior on a bad
  // URL is whatever it always was — a single failed attempt, exit 1 — and must
  // NOT have gained a new validation error.
  const { dir, root, keyPath } = fixture();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("Failed to parse URL from REPLACE_WITH_INGESTER_URL");
  };
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      { url: "REPLACE_WITH_INGESTER_URL", instance: INSTANCE, "private-key": keyPath, root },
      streams
    );
    assert.equal(rc, 1);
    assert.equal(calls, 1, "the one-shot still attempted exactly once");
    assert.ok(
      !/NOT STARTED/.test(streams.stderrText),
      "the daemon-only pre-flight must not leak into the one-shot"
    );
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repeated non-auth 4xx stops the CLI daemon and exits 1", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 404, body: {} }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      {
        url: URL_FAKE,
        instance: INSTANCE,
        "private-key": keyPath,
        root,
        "interval-ms": "5000",
        max: "1000"
      },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 1, "a reject stop is a failure exit, so systemd keeps it stopped");
    assert.equal(stub.calls.length, 5, "stopped at the reject budget, no hammering");
    assert.match(streams.stderrText, /rejected this mirror on every attempt/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interval under the CLI floor is refused before anything is pushed", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  try {
    for (const bad of ["100", "0", "-5000", "abc"]) {
      const streams = captureStreams(dir);
      const rc = await runMirrorPush(
        { url: URL_FAKE, instance: INSTANCE, "private-key": keyPath, root, "interval-ms": bad },
        streams,
        undefined,
        FAST
      );
      assert.equal(rc, 1, `--interval-ms ${bad} must be refused`);
      assert.match(streams.stderrText, /--interval-ms must be an integer >= 5000/);
    }
    assert.equal(stub.calls.length, 0, "a refused interval pushes nothing");
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a bad --max is refused before anything is pushed", async () => {
  const { dir, root, keyPath } = fixture();
  const stub = stubFetch(() => ({ status: 202, body: { ok: true } }));
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      {
        url: URL_FAKE,
        instance: INSTANCE,
        "private-key": keyPath,
        root,
        "interval-ms": "5000",
        max: "0"
      },
      streams,
      undefined,
      FAST
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /--max must be an integer >= 1/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the required flags are still required, daemon or not", async () => {
  const streams = captureStreams(process.cwd());
  const rc = await runMirrorPush({ "interval-ms": "5000" }, streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--url, --instance and --private-key are required/);
});

test("a SIGTERM-equivalent abort stops the CLI daemon cleanly", async () => {
  const { dir, root, keyPath } = fixture();
  const ac = new AbortController();
  const stub = stubFetch((n) => {
    if (n === 1) ac.abort(); // the host's SIGTERM lands during the first push
    return { status: 202, body: { ok: true } };
  });
  try {
    const streams = captureStreams(dir);
    const rc = await runMirrorPush(
      { url: URL_FAKE, instance: INSTANCE, "private-key": keyPath, root, "interval-ms": "5000" },
      streams,
      ac.signal,
      FAST
    );
    assert.equal(rc, 0, "a graceful stop is exit 0");
    assert.equal(stub.calls.length, 1, "no cycle starts after the abort");
    assert.match(streams.stderrText, /stopped \(aborted\)/);
  } finally {
    stub.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
