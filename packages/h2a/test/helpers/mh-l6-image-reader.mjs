// Fresh process for the actual Node ESM/CJS loaders. All paths belong to its test.
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { installImagePolicy } from '../../src/runtime/upgrade/image-policy.js';
const [root, manifestDigest, action = 'none'] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(join(root, 'manifest.json'), 'utf8'));
let policy;
try {
  policy = installImagePolicy(root, manifest, manifestDigest);
  if (action === 'remove') fs.rmSync(join(root, 'node_modules/dep'), { recursive: true });
  if (action === 'alter') fs.appendFileSync(join(root, 'late.mjs'), '\nexport const changed=true;');
  if (action === 'mode') fs.chmodSync(join(root, 'late.mjs'), 0o600);
  if (action === 'metadata') fs.writeFileSync(join(root, 'package.json'), '{"type":"commonjs"}');
  if (action === 'unrecorded') fs.writeFileSync(join(root, 'unrecorded.mjs'), 'export default 99;');
  if (action === 'binary-alter') fs.appendFileSync(join(root, 'node_modules/node-pty/build/Release/pty.node'), Buffer.from([0]));
  if (action === 'alter-manifest') {
    fs.appendFileSync(join(root, 'late.mjs'), '\nexport const changed=true;');
    for (const row of manifest.files) if (row.path === 'late.mjs') row.digest = 'sha256:' + createHash('sha256')
      .update(fs.readFileSync(join(root, 'late.mjs'))).digest('hex');
  }
  const module = await import(pathToFileURL(join(root, manifest.entrypoints.main)).href);
  process.stdout.write(JSON.stringify({ value: await module.default }) + '\n');
} catch (error) { process.stdout.write(JSON.stringify({ error: error.message, code: error.code }) + '\n'); process.exitCode = 1; }
finally { policy?.deregister(); }
