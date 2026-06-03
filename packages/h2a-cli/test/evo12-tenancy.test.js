import assert from "node:assert/strict";
import { join, sep } from "node:path";
import test from "node:test";

import { rootForSub, safePathSegment } from "../dist/index.js";

// rootForSub returns a platform FS path (path.join → "\\" on Windows), so the
// expected value is built the same way to stay OS-agnostic.

test("rootForSub: distinct subs → distinct per-tenant roots under tenants/", () => {
  const a = rootForSub("/var/lib/h2a/root", "user-1");
  const b = rootForSub("/var/lib/h2a/root", "user-2");
  assert.equal(a, join("/var/lib/h2a/root", "tenants", safePathSegment("user-1")));
  assert.notEqual(a, b);
});

test("rootForSub: sanitizes an unsafe sub (collapses to one inert segment, no traversal)", () => {
  const r = rootForSub("/base", "../../etc/passwd");
  assert.equal(r, join("/base", "tenants", safePathSegment("../../etc/passwd")));
  // The traversal vector is the separator; safePathSegment removes all separators
  // so the tenant is a single inert segment that cannot escape.
  const seg = safePathSegment("../../etc/passwd");
  assert.ok(!seg.includes("/") && !seg.includes("\\"), `tenant must be one segment: ${seg}`);
  assert.equal(r, join("/base", "tenants") + sep + seg);
});

test("rootForSub: empty sub throws", () => {
  assert.throws(() => rootForSub("/base", ""), /empty sub/);
});
