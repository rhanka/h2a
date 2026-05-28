import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_SYSML_REF_KIND,
  isH2ASysmlRef,
  sysmlRefEquals,
  validateSysmlRef
} from "../dist/index.js";

function ref(overrides = {}) {
  return { kind: H2A_SYSML_REF_KIND, project: "proj-1", commit: "c0ffee", ...overrides };
}

test("a minimal ref (kind+project+commit) validates", () => {
  const v = validateSysmlRef(ref());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("a full ref (apiBase+element+elementHash) validates", () => {
  const v = validateSysmlRef(
    ref({ apiBase: "https://repo.example/api", element: "el-42", elementHash: "sha256:abc" })
  );
  assert.equal(v.ok, true);
});

test("validateSysmlRef flags wrong kind + missing project/commit", () => {
  const v = validateSysmlRef({ kind: "nope", project: "", commit: "" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("kind-not-sysmlv2"));
  assert.ok(v.errors.includes("project-missing"));
  assert.ok(v.errors.includes("commit-missing"));
});

test("validateSysmlRef rejects present-but-empty optional fields", () => {
  const v = validateSysmlRef(ref({ apiBase: "", element: "", elementHash: "" }));
  assert.equal(v.ok, false);
  assert.deepEqual([...v.errors].sort(), ["apiBase-empty", "element-empty", "elementHash-empty"]);
});

test("isH2ASysmlRef guards untyped input", () => {
  assert.equal(isH2ASysmlRef(ref()), true);
  assert.equal(isH2ASysmlRef({ kind: "sysmlv2", project: "p" }), false); // no commit
  assert.equal(isH2ASysmlRef(null), false);
  assert.equal(isH2ASysmlRef({ kind: "git", project: "p", commit: "c" }), false);
});

test("sysmlRefEquals is strict over all fields", () => {
  assert.equal(sysmlRefEquals(ref(), ref()), true);
  assert.equal(sysmlRefEquals(ref({ element: "a" }), ref({ element: "b" })), false);
  // same model state, different mirror → not equal (strict, by design)
  assert.equal(
    sysmlRefEquals(ref({ apiBase: "https://a" }), ref({ apiBase: "https://b" })),
    false
  );
  // with vs without content hash → not equal
  assert.equal(sysmlRefEquals(ref({ elementHash: "h" }), ref()), false);
});
