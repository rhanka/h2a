// Prepare the private legacy-fixture root for B2-3/E3c qualification.
//
// Copies the conductor-provided read-only published tarballs (.5/.6) into a
// fresh /tmp/mh-l5-artifacts-* directory after verifying every byte against
// the pinned docs/plan/mh-l6/legacy-integrity.json (sha256 + byte count;
// integrity strings were observed read-only via `npm view
// @sentropic/<pkg>@<version> dist.integrity`). Prints the private root path.
// The read-only source is never written. Usage:
//   root=$(node scripts/mh-l6-legacy-fixtures.mjs <read-only-artifacts-dir>)
//   MH_L5_ARTIFACTS=$root node scripts/mh-l6-test.mjs <file> <label>
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const source = fs.realpathSync(process.argv[2] ?? '');
if (!source || source === fs.realpathSync('.')) throw new Error('read_only_artifacts_dir_required');
const pin = JSON.parse(fs.readFileSync('docs/plan/mh-l6/legacy-integrity.json', 'utf8'));
// MH_L5_ARTIFACTS_ROOT overrides the private root (owner rule: never the
// real /tmp); unset keeps the historical /tmp prefix.
const root = process.env.MH_L5_ARTIFACTS_ROOT
  ? fs.mkdtempSync(join(process.env.MH_L5_ARTIFACTS_ROOT, 'mh-l5-artifacts-'))
  : fs.mkdtempSync('/tmp/mh-l5-artifacts-');
const receipt = { source, verified: [] };
for (const [file, record] of Object.entries(pin.files)) {
  const bytes = fs.readFileSync(join(source, file));
  if (bytes.length !== record.bytes) throw new Error(`byte_count_mismatch:${file}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== record.sha256) throw new Error(`sha256_mismatch:${file}`);
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (integrity !== record.integrity) throw new Error(`integrity_mismatch:${file}`);
  fs.writeFileSync(join(root, file), bytes);
  receipt.verified.push({ file, sha256, bytes: bytes.length });
}
fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(root + '\n');
