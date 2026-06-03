import assert from "node:assert/strict";
import test from "node:test";

import { rootForSub } from "../dist/index.js";

test("rootForSub: distinct subs → distinct per-tenant roots under tenants/", () => {
  const a = rootForSub("/var/lib/h2a/root", "user-1");
  const b = rootForSub("/var/lib/h2a/root", "user-2");
  assert.equal(a, "/var/lib/h2a/root/tenants/user-1");
  assert.notEqual(a, b);
});

test("rootForSub: sanitizes an unsafe sub (collapses to one inert segment, no traversal)", () => {
  const r = rootForSub("/base", "../../etc/passwd");
  assert.ok(r.startsWith("/base/tenants/"), r);
  const segment = r.slice("/base/tenants/".length);
  // The traversal vector is the separator; safePathSegment removes all "/", so
  // the result is a single inert segment (a literal ".." substring can't escape).
  assert.ok(!segment.includes("/"), `tenant must be one path segment: ${segment}`);
});

test("rootForSub: empty sub throws", () => {
  assert.throws(() => rootForSub("/base", ""), /empty sub/);
});
