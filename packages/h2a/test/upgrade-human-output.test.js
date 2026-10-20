/**
 * Lot L6 RED — human upgrade output in the user's language (D14).
 *
 * TTY renders one concise human report through the locale catalog (never a
 * JSON wall); `--json` keeps the exact machine contract. Namespace imports
 * keep each RED granular: missing render helpers fail their own test, the
 * cmdUpgrade behaviorals fail on today's JSON wall.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as h2a from "../dist/index.js";
import * as equipment from "../dist/hosts/upgrade-equipment.js";

const CUR = "0.15.0";
// The real package version: convergeAfterExplicitUpgrade only builds host
// reports when the entrypoint verifies against the installed package.
const REAL_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

function fakeRuntime(latest, extra = {}) {
  let swapped = false;
  return {
    now: () => 1_000_000,
    readCache: () => undefined,
    writeCache: () => {},
    fetchLatest: () => latest,
    runInstall: () => true,
    resolvePrefix: () => "/fake/prefix",
    completeRepairIfPending: () => false,
    acquirePrefixLock: () => ({ acquired: true, release: () => {} }),
    fetchTarball: () => ({ ok: true, file: "/fake/staged.tgz" }),
    stageInstall: () => ({ ok: true }),
    probeStagedVersion: () => latest,
    verifyStagedNative: () => ({ ok: true }),
    swapPackageDir: () => {
      swapped = true;
      return { ok: true, repaired: false };
    },
    readGlobalPkgVersion: () => (swapped ? latest : h2a.currentCliVersion()),
    writeDiagnostics: () => {},
    ...extra,
  };
}

function ttyStreams(capture) {
  return {
    stdout: { write: (c) => void (capture.out += c), isTTY: true },
    stderr: { write: (c) => void (capture.err += c) },
  };
}

function pipeStreams(capture) {
  return {
    stdout: { write: (c) => void (capture.out += c) },
    stderr: { write: (c) => void (capture.err += c) },
  };
}

async function withLang(lang, fn) {
  const prev = process.env.H2A_LANG;
  if (lang === undefined) delete process.env.H2A_LANG;
  else process.env.H2A_LANG = lang;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.H2A_LANG;
    else process.env.H2A_LANG = prev;
  }
}

const FIXTURES = new URL("./fixtures/", import.meta.url);

// Golden files pin the report SHAPE; {CURRENT} is the running package
// version (the header always names it — machine value, never localised).
function golden(name, current) {
  return readFileSync(new URL(name, FIXTURES), "utf8").replaceAll("{CURRENT}", current);
}

async function humanUpgrade({ latest, lang, extraFlags = {} }) {
  const capture = { out: "", err: "" };
  const rc = await withLang(lang, () =>
    h2a.cmdUpgrade(
      { "skip-hosts": "true", ...extraFlags },
      ttyStreams(capture),
      fakeRuntime(latest),
    ),
  );
  return { rc, out: capture.out };
}

const CURRENT = h2a.currentCliVersion();

test("L6 RED: should print the golden human line and no JSON on a TTY when already current", async () => {
  for (const lang of ["en", "fr"]) {
    const { rc, out } = await humanUpgrade({ latest: CURRENT, lang });
    assert.equal(rc, 0);
    assert.equal(out, golden(`upgrade-human-already-current.${lang}.txt`, CURRENT));
  }
});

test("L6 RED: should render the golden concise upgrade report without escaped manifests", async () => {
  for (const lang of ["en", "fr"]) {
    const { rc, out } = await humanUpgrade({ latest: "999.0.0", lang });
    assert.equal(rc, 0);
    assert.equal(out, golden(`upgrade-human-upgraded.${lang}.txt`, CURRENT));
    assert.ok(!out.includes("sha256"), "no escaped manifests");
    assert.ok(!out.includes('\\"'), "no escaped JSON strings");
  }
});

test("L6 RED: should print the golden human line when the registry is unreachable", async () => {
  for (const lang of ["en", "fr"]) {
    const { rc, out } = await humanUpgrade({ latest: undefined, lang });
    assert.equal(rc, 0);
    assert.equal(out, golden(`upgrade-human-registry-unreachable.${lang}.txt`, CURRENT));
  }
});

test("L6 RED: should never embed a child stdout string in upgrade output", () => {
  const chatty = "CHATTY-DOCTOR-MARKER".repeat(400);
  const run = () => ({ status: 0, stdout: chatty, stderr: "" });
  const hosts = equipment.convergeAfterExplicitUpgrade(
    {
      current: REAL_VERSION,
      outcome: "already-current",
      message: `already current (${REAL_VERSION})`,
    },
    {},
    run,
  );
  const dumped = JSON.stringify(hosts);
  assert.ok(!dumped.includes("CHATTY-DOCTOR-MARKER"), "no raw child stdout field");
  const reports = hosts.hosts ?? [];
  assert.ok(reports.length > 0, "per-host summaries stay");
});

test("L6 RED: should keep the exact JSON contract under --json", async () => {
  const capture = { out: "", err: "" };
  const rc = await h2a.cmdUpgrade(
    { json: "true" },
    pipeStreams(capture),
    fakeRuntime(CUR),
  );
  assert.equal(rc, 0);
  const parsed = JSON.parse(capture.out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.upgraded, false);
  assert.equal(parsed.reason, "already current", "split reason, not the conflated wall");
  assert.ok(!JSON.stringify(parsed.hosts ?? {}).includes("stdout"), "structured hosts, no raw stdout");
});

test("L6 RED: should distinguish an unavailable registry from an already-current package", async () => {
  const r = h2a.performAutoUpgrade(CUR, {
    runtime: fakeRuntime(undefined),
    cachePath: "/x",
    prefix: "/fake/prefix",
  });
  assert.equal(r.outcome, "registry-unreachable");
  const capture = { out: "", err: "" };
  const rc = await h2a.cmdUpgrade(
    { json: "true" },
    pipeStreams(capture),
    fakeRuntime(undefined),
  );
  assert.equal(rc, 0);
  assert.equal(JSON.parse(capture.out).reason, "registry unreachable");
});

test("L6 RED: should report partial host repair failure as a partial outcome", () => {
  const run = (bin, args) => {
    const host = args.find((a) => ["vibe", "muse", "agy"].includes(a));
    return host === "vibe"
      ? { status: 0, stdout: "ok", stderr: "" }
      : { status: 1, stdout: "boom", stderr: "nope" };
  };
  const hosts = equipment.convergeAfterExplicitUpgrade(
    {
      current: REAL_VERSION,
      outcome: "already-current",
      message: `already current (${REAL_VERSION})`,
    },
    {},
    run,
  );
  assert.equal(hosts.ok, false, "partial repair is not ok");
  assert.ok(hosts.summary, "counted summary");
  assert.equal(hosts.summary.failed, 2);
  assert.equal(hosts.summary.ok, 1);
});

test("L6 RED: should render the catalog language for a non-French non-English locale fixture", async () => {
  const { rc, out } = await humanUpgrade({ latest: CURRENT, lang: "de" });
  assert.equal(rc, 0);
  assert.ok(!out.includes("{"), "fallback is human, never JSON");
  assert.equal(out, golden("upgrade-human-already-current.en.txt", CURRENT), "unknown locale falls back to the default catalog");
});
