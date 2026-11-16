// LH-02 verb skeleton and the terminal gate. Every case runs under a
// temporary store root derived from TMPDIR; no live state and no network.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runCli, runRemoteControlVerb, REMOTE_CONTROL_VERBS } from "../dist/index.js";

function makeRoot() {
  const base = mkdtempSync(join(process.env.TMPDIR, "lh02-"));
  const root = join(base, "store");
  mkdirSync(root, { recursive: true });
  return { base, root };
}

function cleanup(dirs) {
  rmSync(dirs.base, { recursive: true, force: true });
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd: () => process.cwd()
    },
    out: () => stdout,
    err: () => stderr
  };
}

const ENABLED = { H2A_REMOTE_CONTROL: "1" };
const DISABLED = {};

test("every new verb parses and reaches its stub service behind the flag", () => {
  const dirs = makeRoot();
  try {
    assert.deepEqual([...REMOTE_CONTROL_VERBS], ["enrol", "up", "down", "status", "off", "on", "kill", "revoke"]);
    for (const verb of REMOTE_CONTROL_VERBS) {
      const result = runRemoteControlVerb(verb, {
        root: dirs.root,
        env: ENABLED,
        isInteractive: true,
        confirm: verb
      });
      assert.equal(result.ok, true, `${verb} should reach its stub, got ${JSON.stringify(result)}`);
    }
  } finally {
    cleanup(dirs);
  }
});

test("flag off means no new verb starts and every verb refuses", () => {
  const dirs = makeRoot();
  try {
    for (const verb of REMOTE_CONTROL_VERBS) {
      const result = runRemoteControlVerb(verb, {
        root: dirs.root,
        env: DISABLED,
        isInteractive: true,
        confirm: verb
      });
      assert.equal(result.ok, false, `${verb} must refuse while disabled`);
      assert.match(result.message, /site-side approval/, `${verb} refusal must name the site approval`);
    }
    // through the CLI too, a new verb never runs with the flag off
    for (const verb of REMOTE_CONTROL_VERBS) {
      const { streams, err } = captureStreams();
      const save = process.env.H2A_REMOTE_CONTROL;
      delete process.env.H2A_REMOTE_CONTROL;
      try {
        const rc = runCli(["remote", verb, "--root", dirs.root], streams);
        assert.equal(rc, 1, `${verb} via CLI must refuse while disabled`);
      } finally {
        if (save !== undefined) process.env.H2A_REMOTE_CONTROL = save;
      }
      assert.equal(err(), err().toString());
      assert.match(err(), /remote control is disabled/);
    }
  } finally {
    cleanup(dirs);
  }
});

test("enrol, up and on refuse without an interactive terminal or typed confirmation", () => {
  const dirs = makeRoot();
  try {
    for (const verb of ["enrol", "up", "on"]) {
      // piped / non-tty caller
      const noTty = runRemoteControlVerb(verb, { root: dirs.root, env: ENABLED, isInteractive: false, confirm: verb });
      assert.equal(noTty.ok, false, `${verb} must refuse without a terminal`);
      assert.match(noTty.message, /site-side approval/);
      // terminal but no typed confirmation
      const noConfirm = runRemoteControlVerb(verb, { root: dirs.root, env: ENABLED, isInteractive: true });
      assert.equal(noConfirm.ok, false, `${verb} must refuse without typed confirmation`);
      assert.match(noConfirm.message, /site-side approval/);
      // terminal but wrong confirmation word
      const wrong = runRemoteControlVerb(verb, { root: dirs.root, env: ENABLED, isInteractive: true, confirm: "yes" });
      assert.equal(wrong.ok, false, `${verb} must refuse a wrong confirmation`);
    }
    // CLI in the test process (never interactive) refuses the gated verbs
    for (const verb of ["enrol", "up", "on"]) {
      const { streams, err } = captureStreams();
      const save = process.env.H2A_REMOTE_CONTROL;
      process.env.H2A_REMOTE_CONTROL = "1";
      try {
        const rc = runCli(["remote", verb, "--root", dirs.root], streams);
        assert.equal(rc, 1, `${verb} via CLI must refuse without a terminal`);
      } finally {
        if (save !== undefined) process.env.H2A_REMOTE_CONTROL = save;
        else delete process.env.H2A_REMOTE_CONTROL;
      }
      assert.match(err(), /site-side approval/);
    }
  } finally {
    cleanup(dirs);
  }
});

test("down, status and off run without a terminal", () => {
  const dirs = makeRoot();
  try {
    for (const verb of ["down", "status", "off"]) {
      const result = runRemoteControlVerb(verb, { root: dirs.root, env: ENABLED, isInteractive: false });
      assert.equal(result.ok, true, `${verb} must run without a terminal, got ${JSON.stringify(result)}`);
    }
  } finally {
    cleanup(dirs);
  }
});

test("kill runs without a terminal and sets the local flag in the temporary root", () => {
  const dirs = makeRoot();
  try {
    const result = runRemoteControlVerb("kill", { root: dirs.root, env: ENABLED, isInteractive: false });
    assert.equal(result.ok, true);
    const flagFile = result.killFlagFile;
    assert.equal(typeof flagFile, "string");
    assert.equal(existsSync(flagFile), true, "kill flag file must exist");
    assert.match(flagFile, /^.*remote-control\/kill$/);
    const st = statSync(flagFile);
    assert.equal(st.mode & 0o777, 0o600);
    // status now reports the flag
    const status = runRemoteControlVerb("status", { root: dirs.root, env: ENABLED, isInteractive: false });
    assert.equal(status.ok, true);
    assert.equal(status.kill, true);
    // the flag content carries no secret material
    const raw = readFileSync(flagFile, "utf8");
    assert.equal(/(token|cookie|bearer|password)/i.test(raw), false);
  } finally {
    cleanup(dirs);
  }
});

test("an unknown sub-verb lists the full group", () => {
  const dirs = makeRoot();
  try {
    const { streams, err } = captureStreams();
    const rc = runCli(["remote", "bogus", "--root", dirs.root], streams);
    assert.equal(rc, 1);
    for (const name of ["serve", "send", "mirror-serve", "mirror", ...REMOTE_CONTROL_VERBS]) {
      assert.match(err(), new RegExp(name), `unknown-sub message must list ${name}`);
    }
  } finally {
    cleanup(dirs);
  }
});

test("the four existing remote verbs keep byte-identical behaviour", () => {
  const dirs = makeRoot();
  try {
    for (const sub of ["serve", "send"]) {
      const { streams, err } = captureStreams();
      const rc = runCli(["remote", sub, "--root", dirs.root], streams);
      assert.equal(rc, 1);
      assert.equal(err(), `h2a remote ${sub}: async verb — run via the h2a binary, not the synchronous API.\n`);
    }
    for (const sub of ["mirror-serve", "mirror"]) {
      const { streams, err } = captureStreams();
      const rc = runCli(["remote", sub, "--root", dirs.root], streams);
      assert.equal(rc, 1);
      assert.equal(err(), "h2a remote: subcommand required (serve, send).\n");
    }
    // no sub at all
    const { streams, err } = captureStreams();
    const rc = runCli(["remote"], streams);
    assert.equal(rc, 1);
    assert.equal(err(), "h2a remote: subcommand required (serve, send).\n");
  } finally {
    cleanup(dirs);
  }
});

test("help lists each new verb once with no duplicate", () => {
  const { streams, out } = captureStreams();
  const rc = runCli(["--help"], streams);
  assert.equal(rc, 0);
  const text = out();
  for (const verb of REMOTE_CONTROL_VERBS) {
    const needle = `h2a remote ${verb}`;
    const count = text.split(needle).length - 1;
    assert.equal(count, 1, `help must list ${needle} exactly once, found ${count}`);
  }
  for (const sub of ["serve", "send", "mirror-serve", "mirror"]) {
    // `mirror` is a prefix of `mirror-serve`: require a word boundary so the
    // two existing lines count separately, exactly as before this lot.
    const re = new RegExp(`h2a remote ${sub}(?![\\w-])`, "g");
    const count = [...text.matchAll(re)].length;
    assert.equal(count, 1, `help must still list h2a remote ${sub} exactly once, found ${count}`);
  }
});
