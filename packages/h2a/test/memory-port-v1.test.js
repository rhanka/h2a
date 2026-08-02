// WP11 · Memory & context — vendored v1 port (build brief slice 1).
//
// The vendored copy under src/runtime/memory/port-v1.ts must (a) pin
// MEMORY_PRODUCER_PORT_VERSION = 1, (b) stay data-pure (zero runtime imports —
// the anti-cycle STRUCTURAL invariant graphify itself enforces at build), and
// (c) expose the same validateMemoryNoteShape predicate the gate re-checks on
// admission. This test operationalizes graphify's own build verification
// (`grep '^import' src/memory-producer-port.ts` is empty) as a code check in
// THIS repo too, so a future hand-edit that adds an import cannot pass silently.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MEMORY_PRODUCER_PORT_VERSION, validateMemoryNoteShape } from "../dist/runtime/memory/port-v1.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT_SRC = join(HERE, "..", "src", "runtime", "memory", "port-v1.ts");

test("the vendored port pins MEMORY_PRODUCER_PORT_VERSION = 1", () => {
  assert.equal(MEMORY_PRODUCER_PORT_VERSION, 1);
});

test("the vendored port stays data-pure: zero runtime imports", () => {
  const src = readFileSync(PORT_SRC, "utf8");
  const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
  assert.deepEqual(
    importLines,
    [],
    `the vendored port must import nothing (anti-cycle seam); found: ${importLines.join(" | ")}`
  );
});

test("the vendored port carries a vendoring header naming its graphify source commit", () => {
  const src = readFileSync(PORT_SRC, "utf8");
  assert.match(src, /VENDORED COPY/);
  assert.match(src, /2006839e/);
  assert.match(src, /merge train/i);
});

test("validateMemoryNoteShape (vendored) accepts a well-formed agent-work note", () => {
  const note = {
    node_type: "MemoryNote",
    memory_kind: "evidence",
    subject: "agent-work",
    t: 1000,
    t_src: "h2a:dispatch",
    event: { at: 999, kind: "tool-call", ref: "toolresult:abc" },
    provenance: { cited: "abc", source: "toolresult:abc" },
    principal_owner: "claude:h2a-memory:abc123",
    scope: "private"
  };
  assert.deepEqual(validateMemoryNoteShape(note), { ok: true });
});

test("validateMemoryNoteShape (vendored) rejects a memory_kind outside the closed enum", () => {
  const note = {
    node_type: "MemoryNote",
    memory_kind: "persona",
    subject: "agent-work",
    t: 1000,
    t_src: "h2a:dispatch",
    event: { at: 999, kind: "tool-call", ref: "toolresult:abc" },
    provenance: { cited: "abc", source: "toolresult:abc" },
    principal_owner: "claude:h2a-memory:abc123",
    scope: "private"
  };
  const result = validateMemoryNoteShape(note);
  assert.equal(result.ok, false);
});
