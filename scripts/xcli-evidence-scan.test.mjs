import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment } from './xcli-lab.mjs';

test('L4 review: publication scans every JSON/Markdown file and refuses tokens without printing them', () => {
  const root = fs.mkdtempSync('/tmp/xcli-scan-');
  try {
    fs.mkdirSync(join(root, 'nested'));
    const file = join(root, 'nested/receipt.md');
    const secret = 'sk-ant-api03-' + 'x'.repeat(48);
    const scan = () => spawnSync(process.execPath, [join(import.meta.dirname, 'xcli-evidence-scan.mjs'), join(root, 'nested')], { env: environment(join(root, 'env')), encoding: 'utf8', timeout: 5000 });
    fs.writeFileSync(file, secret);
    const red = scan(); assert.equal(red.status, 1); assert.ok(!`${red.stdout}${red.stderr}`.includes(secret));
    fs.writeFileSync(file, '{"status":"measured-KO"}');
    assert.equal(scan().status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
