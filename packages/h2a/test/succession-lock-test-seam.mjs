/**
 * Test-only instrumentation of the compiled production algorithm, in memory.
 * This file lives outside src/dist and the package publication allowlist.
 * Every anchor must occur once: a changed algorithm fails loudly until the
 * observation windows are reviewed. No alternate lock algorithm is maintained.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let source = readFileSync(new URL("../dist/runtime/local-files/succession-lock.js", import.meta.url), "utf8");
function instrument(anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, `unique test instrumentation anchor: ${anchor}`);
  source = source.replace(anchor, replacement);
}
instrument("export function acquirePrefixLock(prefix, options = {}) {",
  "export function acquirePrefixLock(prefix, options = {}, deps = {}) {\n    const hooks = deps.hooks ?? {};");
instrument("const self = me();", "const self = deps.self?.() ?? me();");
instrument('else if (first !== "absent") {',
  'else if (first !== "absent") {\n                invoke(hooks.afterReadFirst, { prefix, lockPath, path: lockPath, round, depth: 0 });');
instrument("const tok = newToken();\n        const pub = publishLockRecord(lockPath, makeLockRecFor(self, tok));",
  "if (round === 0) invoke(hooks.beforePublishLock, { prefix, lockPath, path: lockPath, round, depth: 0 });\n        const tok = newToken();\n        const pub = publishLockRecord(lockPath, makeLockRecFor(self, tok));");
instrument("const next = succeedDeadToken(prefix, lockPath, cur.token, self);",
  "invoke(hooks.beforeSucceedDeadToken, { prefix, lockPath, path: lockPath, target: cur.token, round, depth: 0 });\n    const next = succeedDeadToken(prefix, lockPath, cur.token, self);");
instrument("cur.token, self)", "cur.token, self, hooks, round)");
instrument("function succeedDeadToken(prefix, lockPath, g, self) {",
  "function succeedDeadToken(prefix, lockPath, g, self, hooks, round) {");
instrument("return retireDeadToken(prefix, lockPath, g, self);",
  "invoke(hooks.afterPublishSucc, { prefix, lockPath, path: succPathFor(lockPath, t), token: tok, target: g, round, depth });\n            return retireDeadToken(prefix, lockPath, g, self, hooks, round, depth);");
instrument("function retireDeadToken(prefix, lockPath, g, self) {",
  "function retireDeadToken(prefix, lockPath, g, self, hooks, round, depth) {");
instrument('if (cur !== "absent" && cur.token === g) {',
  'if (cur !== "absent" && cur.token === g) {\n        invoke(hooks.beforeRetireUnlink, { prefix, lockPath, path: lockPath, target: g, round, depth });');
instrument('if (unlinkCode !== undefined && unlinkCode !== "ENOENT") {',
  'invoke(hooks.afterRetireUnlink, { prefix, lockPath, path: lockPath, target: g, round, depth });\n            if (unlinkCode !== undefined && unlinkCode !== "ENOENT") {');
source += '\nfunction invoke(fn, ctx) { try { fn?.(ctx); } catch {} }\n';
export const __test = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
