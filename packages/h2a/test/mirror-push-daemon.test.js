import assert from "node:assert/strict";
import test from "node:test";

import {
  createMirrorPushRunner,
  mirrorPushGloballyDisabled,
  redactEndpoint,
  runMirrorPushDaemon,
  sanitizeForLog,
  DEFAULT_MIRROR_AUTH_FAILURE_LIMIT,
  DEFAULT_MIRROR_PUSH_INTERVAL_MS,
  MIRROR_PUSH_OFF_ENV,
  MIRROR_PUSH_REENROLLMENT_MESSAGE
} from "../dist/index.js";

// Feed-contract P1 step 4a — the mirror push as an OPT-IN live daemon.
// Every test drives an INJECTED clock and an INJECTED transport: no real socket
// is ever opened here, and no hosted endpoint is ever contacted.

const URL_OK = "https://mirror.example/h2a/mirror";
const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIFAKEKEYMATERIALdeadbeef\n-----END PRIVATE KEY-----\n";

/** A minimal, syntactically valid mirror envelope stand-in. */
function fakeEnvelope(nowMs) {
  return {
    protocol: "h2a",
    version: "1.0",
    id: `mirror:test:${nowMs}`,
    type: "event",
    actor: { instance: "host:ws:abc", role: "AGENTS", scope: "scope:default" },
    target: { instance: "host:ws:abc" },
    body: { kind: "mirror.instances", registrations: [], seq: nowMs },
    createdAt: new Date(nowMs).toISOString()
  };
}

/**
 * A fake transport. `responses` is consumed one per call; each entry is either
 * `{ status, body }` or an Error to throw. The last entry repeats forever.
 */
function fakeSender(responses, log = []) {
  let i = 0;
  return async (url, envelope, options) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i += 1;
    log.push({ url, instance: options.by, seq: envelope.body.seq });
    if (spec instanceof Error) throw spec;
    return spec;
  };
}

/** A deterministic clock a test advances by hand, plus the sleep that drives it. */
function fakeClock(startMs = 1_000_000) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    // The daemon's sleep: instead of waiting, jump the clock forward.
    sleep: async (ms) => {
      t += ms;
    }
  };
}

/** Baseline daemon wiring: fake clock, fake transport, no jitter, no env. */
function daemonOptions(overrides = {}) {
  const clock = overrides.clock ?? fakeClock();
  return {
    clock,
    options: {
      root: "/nonexistent-root-never-read",
      url: URL_OK,
      instance: "host:ws:abc",
      privateKeyPem: FAKE_KEY,
      intervalMs: 20_000,
      env: {},
      now: clock.now,
      sleep: clock.sleep,
      // random() = 0.5 ⇒ the jitter term is exactly 0, so schedules are exact.
      random: () => 0.5,
      buildImpl: fakeEnvelope,
      ...overrides.options
    }
  };
}

// --- 1. Opt-in / default behavior -------------------------------------------

test("the runner alone is a ONE-SHOT: one cycle, exactly one request", async () => {
  const sent = [];
  const runCycle = createMirrorPushRunner({
    root: "/nope",
    url: URL_OK,
    instance: "host:ws:abc",
    privateKeyPem: FAKE_KEY,
    now: () => 1_000_000,
    buildImpl: fakeEnvelope,
    sendImpl: fakeSender([{ status: 202, body: { ok: true } }], sent)
  });
  const result = await runCycle();
  assert.equal(result.outcome, "ok");
  assert.equal(result.status, 202);
  assert.equal(sent.length, 1, "exactly one push for one cycle");
});

test("the documented default beat sits inside the ratified 15-30s range", () => {
  assert.ok(DEFAULT_MIRROR_PUSH_INTERVAL_MS >= 15_000);
  assert.ok(DEFAULT_MIRROR_PUSH_INTERVAL_MS <= 30_000);
});

// --- 2. The loop actually loops ---------------------------------------------

test("the daemon fires N times on a fake clock and stops at --max", async () => {
  const sent = [];
  const { clock, options } = daemonOptions();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 4,
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent)
  });
  assert.equal(summary.cycles, 4, "ran exactly max cycles");
  assert.equal(summary.ok, 4, "all four accepted");
  assert.equal(summary.failures, 0);
  assert.equal(summary.stopReason, "max-cycles");
  assert.equal(sent.length, 4, "one push per cycle");
  // Monotonic scheduling with zero jitter ⇒ 3 sleeps of exactly one interval.
  assert.equal(clock.now(), 1_000_000 + 3 * 20_000, "no drift: cycles land on their slots");
});

test("a cycle slower than the interval does NOT stack: missed slots are skipped", async () => {
  // Each push consumes 50s of the fake clock — more than the 20s interval.
  const { clock, options } = daemonOptions();
  const slowSender = async () => {
    clock.advance(50_000);
    return { status: 200, body: { ok: true } };
  };
  const waits = [];
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 3,
    sendImpl: slowSender,
    onCycle: (line) => {
      if (line.nextInMs !== undefined) waits.push(line.nextInMs);
    }
  });
  assert.equal(summary.cycles, 3);
  assert.equal(summary.ok, 3);
  // Slots 1 and 2 are already in the past when the 50s cycle ends, so the daemon
  // waits for the NEXT future slot instead of firing the missed ones back-to-back.
  for (const w of waits) {
    assert.ok(w > 0, `overrun cycle still waits for a future slot (got ${w})`);
    assert.ok(w <= 20_000, `wait never exceeds one interval (got ${w})`);
  }
});

// --- 3. Kill-switch ---------------------------------------------------------

test("kill-switch: the daemon sends NOTHING and stops before the first cycle", async () => {
  const sent = [];
  const { options } = daemonOptions();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 5,
    env: { [MIRROR_PUSH_OFF_ENV]: "1" },
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent)
  });
  assert.equal(summary.stopReason, "kill-switch");
  assert.equal(summary.cycles, 0, "not a single cycle ran");
  assert.equal(sent.length, 0, "not a single request was issued");
});

test("kill-switch flipped mid-run freezes the daemon at the next beat", async () => {
  const sent = [];
  const env = {};
  const { options } = daemonOptions();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 10,
    env,
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent),
    onCycle: (line) => {
      if (line.cycle === 2) env[MIRROR_PUSH_OFF_ENV] = "true";
    }
  });
  assert.equal(summary.stopReason, "kill-switch");
  assert.equal(summary.cycles, 2, "stopped at the beat after the switch flipped");
  assert.equal(sent.length, 2);
});

test("kill-switch parsing matches the H2A_LOOP_AUTOTICK_OFF convention", () => {
  assert.equal(mirrorPushGloballyDisabled({}), false, "unset ⇒ enabled");
  assert.equal(mirrorPushGloballyDisabled({ [MIRROR_PUSH_OFF_ENV]: "" }), false);
  assert.equal(mirrorPushGloballyDisabled({ [MIRROR_PUSH_OFF_ENV]: "0" }), false);
  assert.equal(mirrorPushGloballyDisabled({ [MIRROR_PUSH_OFF_ENV]: "false" }), false);
  assert.equal(mirrorPushGloballyDisabled({ [MIRROR_PUSH_OFF_ENV]: "1" }), true);
  assert.equal(mirrorPushGloballyDisabled({ [MIRROR_PUSH_OFF_ENV]: "yes" }), true);
});

// --- 4. Overlap prevention --------------------------------------------------

test("overlap prevention: a cycle requested while one is in flight sends nothing", async () => {
  const sent = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runCycle = createMirrorPushRunner({
    root: "/nope",
    url: URL_OK,
    instance: "host:ws:abc",
    privateKeyPem: FAKE_KEY,
    now: () => 1_000_000,
    buildImpl: fakeEnvelope,
    sendImpl: async (url, envelope, options) => {
      sent.push(options.by);
      await gate;
      return { status: 200, body: { ok: true } };
    }
  });
  const first = runCycle();
  const second = await runCycle(); // while `first` is still blocked on the gate
  assert.equal(second.outcome, "skipped-overlap");
  assert.equal(sent.length, 1, "the overlapping cycle issued no request at all");
  release();
  assert.equal((await first).outcome, "ok");
  // Once the first settled, the guard is free again.
  const third = await runCycle();
  assert.equal(third.outcome, "ok");
  assert.equal(sent.length, 2);
});

// --- 5. Transient errors: backoff, keep looping -----------------------------

test("a network throw backs off and the daemon KEEPS looping", async () => {
  const { options } = daemonOptions();
  const lines = [];
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 4,
    backoffBaseMs: 1_000,
    sendImpl: fakeSender([
      new Error("fetch failed"),
      new Error("fetch failed"),
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true } }
    ]),
    onCycle: (line) => lines.push(line)
  });
  assert.equal(summary.stopReason, "max-cycles", "transient errors never stop the daemon");
  assert.equal(summary.cycles, 4);
  assert.equal(summary.ok, 2);
  assert.equal(summary.failures, 2);
  assert.deepEqual(
    lines.map((l) => l.outcome),
    ["transient", "transient", "ok", "ok"]
  );
  // Exponential: base after the 1st failure, doubled after the 2nd.
  assert.equal(lines[0].nextInMs, 1_000);
  assert.equal(lines[1].nextInMs, 2_000);
  // Recovery re-anchors on the normal interval.
  assert.equal(lines[2].nextInMs, 20_000);
});

test("a 5xx and a 429 are transient; a non-auth 4xx is rejected but keeps looping", async () => {
  const { options } = daemonOptions();
  const lines = [];
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 3,
    backoffBaseMs: 1_000,
    sendImpl: fakeSender([
      { status: 503, body: {} },
      { status: 429, body: {} },
      { status: 409, body: { ok: false, reason: "replayed" } }
    ]),
    onCycle: (line) => lines.push(line)
  });
  assert.deepEqual(
    lines.map((l) => l.outcome),
    ["transient", "transient", "rejected"]
  );
  assert.equal(lines[2].reason, "replayed", "closed-vocabulary reason is surfaced");
  assert.equal(summary.stopReason, "max-cycles", "none of these stop the daemon");
  assert.equal(summary.authFailures, 0, "non-auth rejections never spend the auth budget");
});

test("a local build failure backs off without issuing any request", async () => {
  const sent = [];
  const { options } = daemonOptions();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 2,
    backoffBaseMs: 1_000,
    buildImpl: () => {
      throw new Error("mirror: unknown local instance host:ws:abc");
    },
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent)
  });
  assert.equal(summary.failures, 2);
  assert.equal(summary.stopReason, "max-cycles");
  assert.equal(sent.length, 0, "nothing is pushed when the envelope cannot be built");
});

// --- 6. Auth failure: backoff, then STOP ------------------------------------

test("repeated 401 backs off then STOPS with the re-enrollment message", async () => {
  const sent = [];
  const { options } = daemonOptions();
  const lines = [];
  const summary = await runMirrorPushDaemon({
    ...options,
    // `max` is deliberately far higher than the auth budget: the stop must come
    // from the auth rule, not from running out of cycles.
    max: 500,
    backoffBaseMs: 1_000,
    sendImpl: fakeSender([{ status: 401, body: { ok: false, reason: "unauthorized-key" } }], sent),
    onCycle: (line) => lines.push(line)
  });
  assert.equal(summary.stopReason, "auth-stop");
  assert.equal(summary.cycles, DEFAULT_MIRROR_AUTH_FAILURE_LIMIT, "stops at the auth budget");
  assert.equal(sent.length, DEFAULT_MIRROR_AUTH_FAILURE_LIMIT, "does NOT hammer the endpoint");
  assert.equal(summary.message, MIRROR_PUSH_REENROLLMENT_MESSAGE);
  assert.match(summary.message, /RE-ENROLLMENT IS REQUIRED/);
  // Backoff DID happen between the attempts before the stop.
  assert.equal(lines[0].nextInMs, 1_000);
  assert.equal(lines[1].nextInMs, 2_000);
  assert.equal(lines[2].nextInMs, undefined, "the final line announces no next cycle");
  assert.equal(lines[2].reason, "unauthorized-key");
});

test("a 403 counts the same as a 401", async () => {
  const { options } = daemonOptions();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 500,
    backoffBaseMs: 1,
    authFailureLimit: 2,
    sendImpl: fakeSender([{ status: 403, body: {} }])
  });
  assert.equal(summary.stopReason, "auth-stop");
  assert.equal(summary.cycles, 2);
});

test("an ACCEPTED push clears the auth budget; a transient error does NOT", async () => {
  const { options } = daemonOptions();
  // 401, 200 (clears), 401, transient (does not clear), 401 ⇒ 2 consecutive
  // auth failures ⇒ stop at limit 2, on cycle 5.
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 500,
    backoffBaseMs: 1,
    authFailureLimit: 2,
    sendImpl: fakeSender([
      { status: 401, body: {} },
      { status: 200, body: { ok: true } },
      { status: 401, body: {} },
      new Error("fetch failed"),
      { status: 401, body: {} }
    ])
  });
  assert.equal(summary.stopReason, "auth-stop");
  assert.equal(summary.cycles, 5, "the 200 reset the budget, the transient error did not");
});

// --- 7. Graceful shutdown ---------------------------------------------------

test("an already-aborted signal stops before any push", async () => {
  const sent = [];
  const { options } = daemonOptions();
  const ac = new AbortController();
  ac.abort();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 5,
    signal: ac.signal,
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent)
  });
  assert.equal(summary.stopReason, "aborted");
  assert.equal(summary.cycles, 0);
  assert.equal(sent.length, 0);
});

test("SIGTERM mid-run stops cleanly after the in-flight cycle", async () => {
  const sent = [];
  const { options } = daemonOptions();
  const ac = new AbortController();
  const summary = await runMirrorPushDaemon({
    ...options,
    max: 100,
    signal: ac.signal,
    sendImpl: fakeSender([{ status: 200, body: { ok: true } }], sent),
    onCycle: (line) => {
      if (line.cycle === 2) ac.abort(); // the "SIGTERM"
    }
  });
  assert.equal(summary.stopReason, "aborted");
  assert.equal(summary.cycles, 2, "no cycle starts after the abort");
  assert.equal(summary.ok, 2, "the in-flight cycle completed rather than being torn up");
  assert.equal(sent.length, 2);
});

// --- 8. Logs never leak secrets --------------------------------------------

test("no key material, token or body ever reaches the status line", async () => {
  const secretUrl = "https://user:hunter2@mirror.example/h2a/mirror?token=SUPERSECRET";
  const { options } = daemonOptions();
  const lines = [];
  await runMirrorPushDaemon({
    ...options,
    url: secretUrl,
    max: 2,
    backoffBaseMs: 1,
    sendImpl: fakeSender([
      // A transport error that (pathologically) carries the private key and a token.
      new Error(`connect failed for token=SUPERSECRET using ${FAKE_KEY}`),
      { status: 200, body: { secretEcho: "SUPERSECRET", note: FAKE_KEY } }
    ]),
    onCycle: (line) => lines.push(line)
  });
  const rendered = JSON.stringify(lines);
  assert.ok(!rendered.includes("SUPERSECRET"), "no token in the logs");
  assert.ok(!rendered.includes("hunter2"), "no URL userinfo in the logs");
  assert.ok(!rendered.includes("BEGIN PRIVATE KEY"), "no PEM header in the logs");
  assert.ok(!rendered.includes("FAKEKEYMATERIAL"), "no key bytes in the logs");
  assert.ok(!rendered.includes("secretEcho"), "no response body in the logs");
  assert.equal(lines[0].endpoint, "https://mirror.example/h2a/mirror", "endpoint is redacted");
  // Closed field set: a status line can only ever carry these keys, so no future
  // field can smuggle a body or a credential into the journal by accident.
  const allowed = new Set([
    "at",
    "authFailures",
    "cycle",
    "durationMs",
    "endpoint",
    "error",
    "instance",
    "nextInMs",
    "outcome",
    "reason",
    "status"
  ]);
  for (const line of lines) {
    for (const key of Object.keys(line)) {
      assert.ok(allowed.has(key), `status line field "${key}" is not in the safe allowlist`);
    }
  }
  // And it is still USEFUL: the operator-facing essentials are always present.
  for (const line of lines) {
    for (const key of ["cycle", "at", "instance", "endpoint", "outcome", "durationMs"]) {
      assert.ok(key in line, `status line must carry "${key}"`);
    }
  }
});

test("sanitizeForLog and redactEndpoint scrub the known secret shapes", () => {
  assert.equal(sanitizeForLog(`key is ${FAKE_KEY.trim()} ok`), "key is [redacted-key] ok");
  assert.equal(sanitizeForLog("Authorization: Bearer abc.def-123"), "Authorization: Bearer [redacted]");
  assert.equal(sanitizeForLog("url?token=abc&x=1"), "url?token=[redacted]&x=1");
  assert.equal(sanitizeForLog("x".repeat(500)).length, 300, "free-form text is length-capped");
  assert.equal(redactEndpoint("https://u:p@h.example/p/q?token=t#f"), "https://h.example/p/q");
  assert.equal(redactEndpoint("not a url"), "[unparseable-url]");
});
