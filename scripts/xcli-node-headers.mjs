#!/usr/bin/env node
// CI's setup-node binary need not include C++ headers. Fetch matching headers
// into mkdtemp so node-pty can be built without node-gyp or Python.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

assert.match(process.version, /^v(?:22|24)\.\d+\.\d+$/);
const root = fs.mkdtempSync('/tmp/xcli-headers-');
const archive = join(root, 'headers.tar.gz');
const response = await fetch(`https://nodejs.org/download/release/${process.version}/node-${process.version}-headers.tar.gz`);
assert.equal(response.status, 200, 'matching public Node headers required');
fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
assert.equal(spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', root]).status, 0);
const headers = join(root, `node-${process.version}`, 'include/node');
assert.ok(fs.existsSync(join(headers, 'node_api.h')));
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `XCLI_NODE_HEADERS=${headers}\n`);
console.log(`XCLI_NODE_HEADERS=${headers}`);
