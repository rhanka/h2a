/**
 * L1 unit tests for the durable payload-recovery store (green completer; it does
 * not import the whole runtime, only the module under test). It proves atomic
 * persistence, chunked reads, integrity, restrictive perms, tenant isolation and
 * the typed read errors — the pieces the transport-level regression relies on.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { mkdtempSync, rmSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPayloadStore, PAYLOAD_MAX_READ_BYTES, PAYLOAD_ROOT_QUOTA_BYTES } from "../dist/runtime/mcp/payload-store.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-payload-"));
}

function sha256(buf) {
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

test('writes below quota avoid expiry metadata scans while pressure reclaims only expired bytes', t => {
  const root=freshRoot(), directory=join(root,'mcp-payloads');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const original=fs.readFileSync;
  let metadataReads=0;
  t.mock.method(fs,'readFileSync',function(path,...args){
    if(typeof path==='string'&&path.startsWith(directory+'/')&&path.endsWith('.json'))metadataReads++;
    return Reflect.apply(original,this,[path,...args]);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  t.mock.method(performance,'now',()=>0);
  const store=createPayloadStore(root), first=store.persistOutput(Buffer.from('first'));
  const second=store.persistOutput(Buffer.from('live'));
  assert.equal(metadataReads,0,'ordinary writes must measure bytes without parsing all expiry records');
  const bin=join(directory,first.ref+'.bin'), meta=join(directory,first.ref+'.json');
  fs.truncateSync(bin,PAYLOAD_ROOT_QUOTA_BYTES);
  assert.throws(()=>store.persistOutput(Buffer.from('refused')),error=>error.cause==='quota_exceeded');
  assert.ok(metadataReads>0,'quota pressure must run the real expiry sweep');
  assert.equal(fs.existsSync(bin),true,'a live oversized payload must never be evicted');
  const expired=JSON.parse(original(meta,'utf8'));
  fs.writeFileSync(meta,JSON.stringify({...expired,expiresAt:new Date(0).toISOString()}));
  const accepted=store.persistOutput(Buffer.from('accepted'));
  assert.equal(fs.existsSync(bin),false);
  assert.equal(store.readPayload(first.ref,0,1024).error,'payload_not_found');
  assert.equal(Buffer.from(store.readPayload(second.ref,0,1024).data,'base64').toString(),'live');
  assert.equal(Buffer.from(store.readPayload(accepted.ref,0,1024).data,'base64').toString(),'accepted');
});

test('automatic expiry maintenance advances monotonically and explicit sweeps stay immediate', t => {
  const root=freshRoot(), directory=join(root,'mcp-payloads');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  let clock=0;
  t.mock.method(performance,'now',()=>clock);
  const store=createPayloadStore(root), first=store.persistOutput(Buffer.from('expired'));
  const expire=ref=>{
    const path=join(directory,ref.ref+'.json'), meta=JSON.parse(fs.readFileSync(path,'utf8'));
    fs.writeFileSync(path,JSON.stringify({...meta,expiresAt:new Date(0).toISOString()}));
  };
  expire(first);
  const live=store.persistOutput(Buffer.from('live'));
  assert.equal(store.readPayload(first.ref,0,1024).error,'payload_expired');
  clock=30001;
  const third=store.persistOutput(Buffer.from('third'));
  assert.equal(store.readPayload(first.ref,0,1024).error,'payload_not_found');
  expire(third);
  assert.equal(store.sweepExpired(),1);
  assert.equal(store.readPayload(third.ref,0,1024).error,'payload_not_found');
  assert.equal(Buffer.from(store.readPayload(live.ref,0,1024).data,'base64').toString(),'live');
  const read=fs.readFileSync;
  let reads=0;
  t.mock.method(fs,'readFileSync',function(path,...args){
    if(typeof path==='string'&&path.startsWith(directory+'/')&&path.endsWith('.json')){clock+=60000;reads++;}
    return Reflect.apply(read,this,[path,...args]);
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  store.sweepExpired();
  const before=reads;
  store.persistOutput(Buffer.from('after a slow sweep'));
  assert.equal(reads,before,'the next write must measure its interval from sweep completion');
});

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
