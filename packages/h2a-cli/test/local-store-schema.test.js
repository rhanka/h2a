// DEC-036 — schema sentinel + `h2a store migrate` verb.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_STORE_SCHEMA_VERSION,
  StoreSchemaMismatchError,
  createLocalStore,
  runCli
} from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-schema-"));
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd ?? process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("createLocalStore writes .h2a-schema.json on first call with version 1", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    const sentinelPath = join(store.paths.root, ".h2a-schema.json");
    assert.ok(existsSync(sentinelPath));
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
    assert.equal(sentinel.version, H2A_STORE_SCHEMA_VERSION);
    assert.equal(sentinel.version, "1");
    assert.match(sentinel.createdBy, /@sentropic\/h2a-cli@/);
    assert.match(sentinel.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createLocalStore is idempotent — second open preserves createdAt", () => {
  const root = freshRoot();
  try {
    createLocalStore({ root });
    const sentinelPath = join(root, ".h2a-schema.json");
    const first = JSON.parse(readFileSync(sentinelPath, "utf8"));
    // Small pause so a rewrite would produce a different `createdAt`.
    const before = Date.now();
    while (Date.now() - before < 10) { /* spin */ }
    createLocalStore({ root });
    const second = JSON.parse(readFileSync(sentinelPath, "utf8"));
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.createdBy, first.createdBy);
    assert.equal(second.version, "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createLocalStore throws StoreSchemaMismatchError on an unknown future version", () => {
  const root = freshRoot();
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, ".h2a-schema.json"),
      JSON.stringify({
        version: "2",
        createdAt: "2027-01-01T00:00:00.000Z",
        createdBy: "@sentropic/h2a-cli@9.9.9"
      })
    );
    assert.throws(
      () => createLocalStore({ root }),
      (err) => {
        assert.ok(err instanceof StoreSchemaMismatchError);
        assert.equal(err.foundVersion, "2");
        assert.equal(err.expectedVersion, "1");
        assert.match(err.message, /"2"/);
        assert.match(err.message, /"1"/);
        return true;
      }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createLocalStore({allowVersionMismatch:true}) on a v2 store proceeds with a stderr warning", () => {
  const root = freshRoot();
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderrCaptured = "";
  process.stderr.write = (chunk, ...rest) => {
    stderrCaptured += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  };
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, ".h2a-schema.json"),
      JSON.stringify({
        version: "2",
        createdAt: "2027-01-01T00:00:00.000Z",
        createdBy: "@sentropic/h2a-cli@9.9.9"
      })
    );
    const store = createLocalStore({ root, allowVersionMismatch: true });
    assert.ok(store.paths.root);
    assert.match(stderrCaptured, /schema version mismatch/);
    assert.match(stderrCaptured, /allowVersionMismatch=true/);
    // Sentinel must NOT have been rewritten.
    const sentinel = JSON.parse(readFileSync(join(root, ".h2a-schema.json"), "utf8"));
    assert.equal(sentinel.version, "2");
  } finally {
    process.stderr.write = originalWrite;
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a store migrate v1→v1 returns ok+changed:false", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["store", "migrate", "--root", root, "--from", "1", "--to", "1"],
      streams
    );
    assert.equal(rc, 0, `expected 0, got ${rc} (stderr: ${streams.stderrText})`);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.fromVersion, "1");
    assert.equal(parsed.toVersion, "1");
    assert.equal(parsed.changed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a store migrate with default flags assumes v1→v1 (no-op)", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(["store", "migrate", "--root", root], streams);
    assert.equal(rc, 0);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.changed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a store migrate with an unknown target version fails with exit 1", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["store", "migrate", "--root", root, "--to", "42"],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /unknown --to version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a store migrate with an unknown source version fails with exit 1", () => {
  const dir = freshRoot();
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["store", "migrate", "--root", root, "--from", "0", "--to", "1"],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /unknown --from version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a store missing subcommand fails with exit 1", () => {
  const dir = freshRoot();
  try {
    const streams = captureStreams(dir);
    const rc = runCli(["store"], streams);
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /Unknown store subcommand/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
