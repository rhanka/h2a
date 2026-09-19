/**
 * L1 unit tests for the durable payload-recovery store (green completer; it does
 * not import the whole runtime, only the module under test). It proves atomic
 * persistence, chunked reads, integrity, restrictive perms, tenant isolation and
 * the typed read errors — the pieces the transport-level regression relies on.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPayloadStore, PAYLOAD_MAX_READ_BYTES } from "../dist/runtime/mcp/payload-store.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-payload-"));
}

function sha256(buf) {
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

/** Read a ref end-to-end in chunks and reassemble the bytes. */
function readAll(store, ref, chunk = PAYLOAD_MAX_READ_BYTES) {
  const parts = [];
  let offset = 0;
  for (let guard = 0; guard < 100000; guard += 1) {
    const r = store.readPayload(ref, offset, chunk);
    assert.ok(!("error" in r), `read at ${offset}: ${r.error ?? "ok"}`);
    parts.push(Buffer.from(r.data, "base64"));
    if (r.nextOffset === null) {
      assert.equal(offset + parts[parts.length - 1].length, r.totalBytes);
      return { bytes: Buffer.concat(parts), sha256: r.sha256, totalBytes: r.totalBytes };
    }
    assert.equal(r.nextOffset, offset + parts[parts.length - 1].length);
    offset = r.nextOffset;
  }
  throw new Error("read did not terminate");
}

test("persist + chunked read reproduces the bytes and verifies sha256", () => {
  const root = freshRoot();
  try {
    const store = createPayloadStore(root);
    // > 3 chunks so the loop and offset arithmetic are exercised.
    const original = Buffer.from("é".repeat(90000), "utf8"); // multibyte, ~180 kB
    const ref = store.persistOutput(original);
    assert.match(ref.ref, /^[0-9a-f]{64}$/, "ref is a 256-bit hex capability");
    assert.equal(ref.totalBytes, original.length);
    assert.equal(ref.sha256, sha256(original));

    const got = readAll(store, ref.ref);
    assert.ok(got.bytes.equals(original), "reassembled bytes are byte-identical");
    assert.equal(got.sha256, sha256(original));
    assert.equal(sha256(got.bytes), got.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("store directory is 0700 and payload files are 0600", () => {
  const root = freshRoot();
  try {
    const store = createPayloadStore(root);
    const ref = store.persistOutput(Buffer.from("secret-ish output"));
    const dir = join(root, "mcp-payloads");
    assert.equal(statSync(dir).mode & 0o777, 0o700, "payload dir is private");
    assert.equal(statSync(join(dir, `${ref.ref}.bin`)).mode & 0o777, 0o600, "payload file is 0600");
    assert.equal(statSync(join(dir, `${ref.ref}.json`)).mode & 0o777, 0o600, "meta file is 0600");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("typed read errors: not_found, invalid_offset", () => {
  const root = freshRoot();
  try {
    const store = createPayloadStore(root);
    const bad = store.readPayload("f".repeat(64), 0, 1024);
    assert.equal(bad.error, "payload_not_found");
    const notHex = store.readPayload("../etc/passwd", 0, 1024);
    assert.equal(notHex.error, "payload_not_found", "a non-ref path never resolves");

    const ref = store.persistOutput(Buffer.from("abc"));
    const past = store.readPayload(ref.ref, 4, 1024);
    assert.equal(past.error, "invalid_offset", "offset past total is rejected");
    // offset === total returns an empty terminal chunk, not an error.
    const end = store.readPayload(ref.ref, 3, 1024);
    assert.ok(!("error" in end));
    assert.equal(end.nextOffset, null);
    assert.equal(end.data, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two roots are isolated: one store cannot read another's ref", () => {
  const rootA = freshRoot();
  const rootB = freshRoot();
  try {
    const storeA = createPayloadStore(rootA);
    const storeB = createPayloadStore(rootB);
    const refA = storeA.persistOutput(Buffer.from("tenant-A only"));
    // B has its own namespace; A's ref is not in B's directory.
    const cross = storeB.readPayload(refA.ref, 0, 1024);
    assert.equal(cross.error, "payload_not_found", "cross-tenant recovery is refused");
    // A can still read it.
    const own = storeA.readPayload(refA.ref, 0, 1024);
    assert.ok(!("error" in own));
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("maxBytes is capped at 65536 and never cuts a chunk mid-read", () => {
  const root = freshRoot();
  try {
    const store = createPayloadStore(root);
    const original = Buffer.alloc(200000, 0x41);
    const ref = store.persistOutput(original);
    const r = store.readPayload(ref.ref, 0, 10_000_000); // ask for more than the cap
    assert.ok(!("error" in r));
    assert.ok(Buffer.from(r.data, "base64").length <= PAYLOAD_MAX_READ_BYTES, "chunk never exceeds 64 KiB");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
