import assert from "node:assert/strict";
import test from "node:test";

import { H2A_DISCLOSURE_MODES } from "@sentropic/h2a";
import { sysmlQueryScope } from "../dist/index.js";

test("sysmlQueryScope is total over every DEC-045 disclosure mode", () => {
  for (const mode of H2A_DISCLOSURE_MODES) {
    const scope = sysmlQueryScope(mode);
    assert.equal(scope.mode, mode);
    assert.ok(typeof scope.note === "string" && scope.note.length > 0);
    assert.ok(["none", "attestation", "metadata", "redacted", "full"].includes(scope.detail));
  }
});

test("no-content modes (denied / hash-only / attestation) do not fetch", () => {
  for (const mode of ["denied", "hash-only", "attestation"]) {
    assert.equal(sysmlQueryScope(mode).fetch, false, `${mode} must not fetch`);
  }
});

test("content modes fetch, with the expected detail/view", () => {
  assert.deepEqual(
    { fetch: sysmlQueryScope("evidence-package").fetch, detail: sysmlQueryScope("evidence-package").detail },
    { fetch: true, detail: "metadata" }
  );
  const redacted = sysmlQueryScope("redacted-view");
  assert.equal(redacted.fetch, true);
  assert.equal(redacted.detail, "redacted");
  assert.equal(redacted.view, "redacted");

  const full = sysmlQueryScope("full-view");
  assert.equal(full.detail, "full");
  assert.equal(full.view, "full");
});
