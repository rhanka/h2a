#!/usr/bin/env node
// Execute real npm; only replace node-gyp's interpreter-based addon build.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileAddons } from './native-addon.mjs';
const args = process.argv.slice(2);
appendFileSync(join(process.env.H2A_OWNER_LAB_EVIDENCE, 'npm-commands.jsonl'), JSON.stringify(args) + '\n');
const r = spawnSync('/usr/bin/npm', args, { stdio: 'inherit', env: process.env });
if (r.status === 0 && ['i', 'install', 'ci'].includes(args[0])) {
  const index = args.indexOf('--prefix');
  compileAddons(index >= 0 ? args[index + 1] : process.cwd());
}
process.exitCode = r.status ?? 1;
