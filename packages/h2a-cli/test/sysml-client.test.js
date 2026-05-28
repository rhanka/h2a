import assert from "node:assert/strict";
import test from "node:test";

import { hashSysmlElement, resolveSysmlElement } from "../dist/index.js";

const REF = {
  kind: "sysmlv2",
  apiBase: "https://repo.example/api",
  project: "proj-1",
  commit: "c0ffee",
  element: "el-42"
};

function mockFetch(calls, response) {
  return async (url, init) => {
    calls.push({ url, init });
    return response;
  };
}

test("resolveSysmlElement builds the SysML v2 API & Services URL and returns the element", async () => {
  const calls = [];
  const element = { "@id": "el-42", name: "Wheel" };
  const fetchImpl = mockFetch(calls, { ok: true, status: 200, json: async () => element });

  const got = await resolveSysmlElement(REF, { fetchImpl });
  assert.deepEqual(got, element);
  assert.equal(
    calls[0].url,
    "https://repo.example/api/projects/proj-1/commits/c0ffee/elements/el-42"
  );
  assert.equal(calls[0].init, undefined); // no auth → no headers
});

test("resolveSysmlElement attaches a Bearer header when auth is given; opts.apiBase overrides ref", async () => {
  const calls = [];
  const fetchImpl = mockFetch(calls, { ok: true, status: 200, json: async () => ({}) });
  await resolveSysmlElement(REF, { fetchImpl, auth: "tok-123", apiBase: "https://mirror/api/" });
  assert.match(calls[0].url, /^https:\/\/mirror\/api\/projects\//); // trailing slash trimmed
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok-123");
});

test("resolveSysmlElement throws on a non-OK status", async () => {
  const fetchImpl = mockFetch([], { ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(() => resolveSysmlElement(REF, { fetchImpl }), /HTTP 404/);
});

test("resolveSysmlElement requires apiBase and element", async () => {
  const fetchImpl = mockFetch([], { ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(
    () => resolveSysmlElement({ kind: "sysmlv2", project: "p", commit: "c", element: "e" }, { fetchImpl }),
    /apiBase is required/
  );
  await assert.rejects(
    () => resolveSysmlElement({ kind: "sysmlv2", apiBase: "https://x", project: "p", commit: "c" }, { fetchImpl }),
    /ref.element is required/
  );
});

test("hashSysmlElement is canonical (key-order independent) — matches at sign vs verify time", () => {
  const h1 = hashSysmlElement({ a: 1, b: 2 });
  const h2 = hashSysmlElement({ b: 2, a: 1 });
  assert.equal(h1, h2);
  assert.notEqual(hashSysmlElement({ a: 1 }), hashSysmlElement({ a: 2 }));
});
