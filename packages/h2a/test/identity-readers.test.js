import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultProviderSessionReaders } from "../dist/runtime/identity/readers.js";
import { resolveHostConfigRoot } from "../dist/runtime/host-config-root.js";

function fixture(t, header, tailBytes = 0) {
  const directory = fs.mkdtempSync(join(tmpdir(), "h2a-identity-reader-"));
  const transcript = join(directory, "rollout.jsonl");
  fs.writeFileSync(transcript, header);
  if (tailBytes) fs.truncateSync(transcript, Buffer.byteLength(header) + tailBytes);
  const providerBase = join(resolveHostConfigRoot("codex"), "sessions");
  const readdir = fs.readdirSync;
  const stat = fs.statSync;
  const open = fs.openSync;
  const readFile = fs.readFileSync;
  const read = fs.readSync;
  const close = fs.closeSync;
  const virtualTranscript = join(providerBase, "rollout.jsonl");
  const descriptors = new Set();
  let bytesRead = 0;
  let maxReadLength = 0;
  t.mock.method(fs, "existsSync", (path) => path === providerBase);
  t.mock.method(fs, "readdirSync", (path, options) => {
    assert.equal(path, providerBase);
    return readdir(directory, options);
  });
  t.mock.method(fs, "statSync", (path) => {
    assert.equal(path, virtualTranscript);
    return stat(transcript);
  });
  t.mock.method(fs, "openSync", (path, flags) => {
    assert.equal(path, virtualTranscript);
    const fd = open(transcript, flags);
    descriptors.add(fd);
    return fd;
  });
  t.mock.method(fs, "readFileSync", (path, encoding) => {
    assert.equal(path, virtualTranscript);
    const value = readFile(transcript, encoding);
    bytesRead += Buffer.byteLength(value);
    maxReadLength = Math.max(maxReadLength, Buffer.byteLength(value));
    return value;
  });
  // Short reads are legal; split UTF-8 characters across reads as a real fd can.
  t.mock.method(fs, "readSync", (fd, buffer, offset, length, position) => {
    assert.ok(descriptors.has(fd));
    maxReadLength = Math.max(maxReadLength, length);
    const size = read(fd, buffer, offset, Math.min(length, 127), position);
    bytesRead += size;
    return size;
  });
  t.mock.method(fs, "closeSync", (fd) => {
    descriptors.delete(fd);
    return close(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const fd of descriptors) close(fd);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    observe: () => ({ bytesRead, maxReadLength, openDescriptors: descriptors.size }),
  };
}

test("should resolve Codex identity without reading the growing transcript body", (t) => {
  const cwd = "/identity-reader-workspace";
  const header = `${JSON.stringify({ payload: { cwd, id: "thread-large" } })}\n`;
  const probe = fixture(t, header, 64 * 1024 * 1024);
  assert.equal(defaultProviderSessionReaders.codexThreadForCwd(cwd), "thread-large");
  assert.ok(probe.observe().bytesRead < 16 * 1024, JSON.stringify(probe.observe()));
  assert.equal(probe.observe().openDescriptors, 0);
});

test("should preserve a UTF-8 header across short reads and EOF without a newline", (t) => {
  const cwd = `/identity-${"é🙂".repeat(1000)}`;
  const probe = fixture(t, JSON.stringify({ session_meta: { payload: { cwd, id: "thread-utf8" } } }));
  assert.equal(defaultProviderSessionReaders.codexThreadForCwd(cwd), "thread-utf8");
  assert.equal(probe.observe().openDescriptors, 0);
});

test("should bound reads and release the descriptor for an oversized first record", (t) => {
  const probe = fixture(t, "x".repeat(256 * 1024));
  assert.equal(defaultProviderSessionReaders.codexThreadForCwd("/absent"), undefined);
  assert.ok(probe.observe().bytesRead <= 64 * 1024, JSON.stringify(probe.observe()));
  assert.equal(probe.observe().openDescriptors, 0);
});
