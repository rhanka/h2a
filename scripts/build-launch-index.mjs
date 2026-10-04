#!/usr/bin/env node
// Explicit, idempotent maintenance. Originals are retained byte-for-byte.
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildLaunchIndex } from '../packages/h2a/dist/runtime/local-files/launch-index.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--root' || !isAbsolute(args[1]))
  throw new Error('Usage: node scripts/build-launch-index.mjs --root <absolute-store-root>');
const root = realpathSync(args[1]);
for (const [relative, kind] of [
  ['registry/instances.jsonl', 'instances'], ['registry/keys.jsonl', 'keys'],
  ['identity/bindings.jsonl', 'bindings'], ['identity/aliases.jsonl', 'aliases']
]) {
  const file = join(root, relative);
  if (!existsSync(file)) continue;
  const started = performance.now();
  buildLaunchIndex(file, kind);
  console.log(JSON.stringify({ kind, elapsedMs: performance.now() - started }));
}
