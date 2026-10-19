import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';

const patterns = [
  /\bsk-(?:ant-[a-z0-9-]*-)?[A-Za-z0-9_-]{20,}/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
  /"(?:access_token|refresh_token|api_key|client_secret)"\s*:\s*"[^"\s]{4,}"/i,
];
export function scanEvidenceText(text) {
  assert.ok(!patterns.some(pattern => pattern.test(text)), 'evidence-token-detected');
}
export function scanEvidenceFiles(paths) {
  let count = 0;
  function visit(path) {
    const stat = fs.lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), 'evidence-symlink-refused');
    if (stat.isDirectory()) { for (const name of fs.readdirSync(path)) visit(join(path, name)); return; }
    if (!/\.(json|jsonl|md)$/.test(path)) return;
    scanEvidenceText(fs.readFileSync(path, 'utf8')); count++;
  }
  for (const path of paths) visit(path);
  assert.ok(count > 0, 'evidence-files-missing');
  return count;
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { console.log(`evidence-scan: pass files=${scanEvidenceFiles(process.argv.slice(2))}`); }
  catch { console.error('evidence-scan: REFUSED'); process.exitCode = 1; }
}
