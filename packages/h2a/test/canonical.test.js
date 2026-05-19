import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, computeHash } from "../dist/index.js";

test("canonicalize emits keys in sorted order regardless of input order", () => {
  const a = canonicalize({ b: 2, a: 1, c: [3, 1, 2] });
  const b = canonicalize({ c: [3, 1, 2], a: 1, b: 2 });

  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2,"c":[3,1,2]}');
});

test("canonicalize sorts nested object keys recursively", () => {
  const value = {
    outer: { z: 1, a: { y: 2, x: 1 } },
    list: [{ b: 1, a: 2 }, { d: 4, c: 3 }]
  };

  assert.equal(
    canonicalize(value),
    '{"list":[{"a":2,"b":1},{"c":3,"d":4}],"outer":{"a":{"x":1,"y":2},"z":1}}'
  );
});

test("canonicalize omits keys whose value is undefined", () => {
  const a = canonicalize({ a: 1, b: undefined, c: 3 });
  const b = canonicalize({ a: 1, c: 3 });

  assert.equal(a, b);
});

test("canonicalize preserves array order, only objects are sorted", () => {
  const value = canonicalize({ list: [3, 1, 2] });
  assert.equal(value, '{"list":[3,1,2]}');
});

test("computeHash is stable for equivalent objects and prefixed with sha256:", () => {
  const h1 = computeHash({ b: 2, a: 1 });
  const h2 = computeHash({ a: 1, b: 2 });

  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

test("computeHash differs when content differs", () => {
  const h1 = computeHash({ a: 1 });
  const h2 = computeHash({ a: 2 });

  assert.notEqual(h1, h2);
});
