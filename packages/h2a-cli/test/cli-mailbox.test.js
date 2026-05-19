import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

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

const envelope = (id, type = "propose") => ({
  protocol: "sentropic.h2a",
  version: "0.1",
  id,
  type,
  actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:x" },
  body: { offer: 1 },
  createdAt: "2026-05-18T00:00:00.000Z"
});

test("h2a inbox put + read round-trips a valid envelope", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-inbox-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const put = captureStreams(dir);
    const rc = runCli(
      [
        "inbox",
        "put",
        "--root",
        root,
        "--instance",
        "conductor:02",
        "--json",
        JSON.stringify(envelope("env-001"))
      ],
      put
    );
    assert.equal(rc, 0);

    const read = captureStreams(dir);
    runCli(["inbox", "read", "--root", root, "--instance", "conductor:02"], read);
    const list = JSON.parse(read.stdoutText);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "env-001");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a inbox pop removes the envelope from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-inbox-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    runCli(
      [
        "inbox",
        "put",
        "--root",
        root,
        "--instance",
        "alpha",
        "--json",
        JSON.stringify(envelope("env-100"))
      ],
      captureStreams(dir)
    );

    const pop = captureStreams(dir);
    const rc = runCli(
      ["inbox", "pop", "--root", root, "--instance", "alpha", "--envelope", "env-100"],
      pop
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(pop.stdoutText);
    assert.equal(parsed.id, "env-100");

    const read = captureStreams(dir);
    runCli(["inbox", "read", "--root", root, "--instance", "alpha"], read);
    assert.deepEqual(JSON.parse(read.stdoutText), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a inbox pop on a missing envelope reports an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-inbox-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "pop", "--root", root, "--instance", "alpha", "--envelope", "missing"],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /no such envelope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a inbox put rejects an invalid envelope", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-inbox-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "inbox",
        "put",
        "--root",
        root,
        "--instance",
        "alpha",
        "--json",
        JSON.stringify({ id: "no-protocol" })
      ],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /not a valid H2A envelope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a outbox put + read works symmetrically", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-outbox-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    runCli(
      [
        "outbox",
        "put",
        "--root",
        root,
        "--instance",
        "conductor:01",
        "--json",
        JSON.stringify(envelope("out-001"))
      ],
      captureStreams(dir)
    );

    const read = captureStreams(dir);
    runCli(["outbox", "read", "--root", root, "--instance", "conductor:01"], read);
    assert.match(read.stdoutText, /"id": "out-001"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a outbox pop is rejected (outbox is append-only from CLI)", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["outbox", "pop", "--instance", "a"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /Unknown outbox subcommand/);
});

test("h2a inbox <sub> requires --instance", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["inbox", "read"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--instance/);
});
