import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanEvidenceFiles } from './xcli-evidence-scan.mjs';

// Export only named JSON receipts to the launcher's private directory. Never
// change ownership or permissions of the build, CLI state, logs or credentials.
export function exportEvidence(root, names) {
  const destination = process.env.XCLI_EVIDENCE_EXPORT_DIR;
  if (!destination) return;
  assert.match(basename(destination), /^xcli-evidence-[a-zA-Z0-9]{6}$/);
  assert.equal(dirname(destination), fs.realpathSync(process.env.RUNNER_TEMP ?? tmpdir()), 'evidence must belong to this temporary parent');
  assert.equal(fs.realpathSync(destination), destination, 'evidence directory must not be aliased');
  const parent = fs.lstatSync(destination);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
  assert.equal(parent.mode & 0o777, 0o700, 'evidence directory must remain private');
  for (const name of names) assert.ok(['receipt.json', 'execution.json'].includes(name));
  scanEvidenceFiles(names.map(name => join(root, name)));
  for (const name of names) {
    const source = join(root, name), stat = fs.lstatSync(source);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 20 * 1024 * 1024);
    const bytes = fs.readFileSync(source);
    JSON.parse(bytes.toString('utf8'));
    const fd = fs.openSync(join(destination, name), 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fchownSync(fd, parent.uid, parent.gid);
    } finally { fs.closeSync(fd); }
  }
}
