#!/usr/bin/env node
// CI's setup-node binary need not include C++ headers. Fetch matching headers
// into mkdtemp so node-pty can be built without node-gyp or Python.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

assert.match(process.version, /^v(?:22|24)\.\d+\.\d+$/);
const root = fs.mkdtempSync(join(tmpdir(), 'xcli-headers-'));
const archive = join(root, 'headers.tar.gz');
let prepared = false;
try {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`https://nodejs.org/download/release/${process.version}/node-${process.version}-headers.tar.gz`);
      assert.equal(response.status, 200, 'matching public Node headers required');
      // A successful HTTP response can still terminate during body transfer.
      // Retry the entire download; never extract or publish partial bytes.
      fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`xcli: Node headers download failed (attempt ${attempt}/3), retrying`);
      await sleep(250 * attempt);
    }
  }
  assert.equal(spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', root]).status, 0);
  const headers = join(root, `node-${process.version}`, 'include/node');
  assert.ok(fs.existsSync(join(headers, 'node_api.h')));
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `XCLI_NODE_HEADERS=${headers}\n`);
  console.log(`XCLI_NODE_HEADERS=${headers}`);
  prepared = true;
} finally {
  if (!prepared) fs.rmSync(root, { recursive: true, force: true });
}
