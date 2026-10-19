import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedEvidence } from '../focus-kit/test/distribution-fixture.mjs';

test('H4-H1 fresh tarball installation exports the evidence template and builds without checkout imports', () => {
  const root = mkdtempSync(join(tmpdir(),'focus-distribution-'));
  try { installedEvidence(root); console.log('H4-H1: fresh offline install, guarded imports, explicit v2 template/build, fingerprints OK'); }
  finally { rmSync(root,{recursive:true,force:true}); }
});
