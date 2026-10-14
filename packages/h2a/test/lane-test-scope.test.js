import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTestFiles, LANE_TEST_FILES, RUNNER_TEST_FILE } from '../../../scripts/run-tests.mjs';

// The lane-scoped suites must run exactly once: through the identity lane,
// never through the plain `node --test` discovery (there is no lane there,
// so they fail with IDLOCK_LANE undefined). LANE_TEST_FILES is the single
// source both sides read — discovery excludes these names and main() passes
// them to identity-isolated-run.mjs. A rename that updates only one side
// would silently drop a suite from both, so this file pins the pairing.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every lane-scoped suite exists on disk', () => {
  assert.ok(Array.isArray(LANE_TEST_FILES) && LANE_TEST_FILES.length > 0, 'lane scope must not be empty');
  assert.equal(new Set(LANE_TEST_FILES).size, LANE_TEST_FILES.length, 'duplicate lane file identity');
  for (const file of LANE_TEST_FILES) {
    assert.ok(file.endsWith('.test.js'), `lane file must be a node test: ${file}`);
    assert.ok(existsSync(join(REPO_ROOT, file)), `lane file missing on disk: ${file}`);
  }
});

test('node discovery excludes the lane suites and the trust-root runner test', () => {
  const files = discoverTestFiles();
  assert.ok(files.length > 0, 'discovery must not be empty');
  for (const file of LANE_TEST_FILES) {
    assert.ok(!files.map((f) => f.split('\\').join('/')).includes(file), `lane file leaked into node discovery: ${file}`);
  }
  assert.ok(!files.map((f) => f.split('\\').join('/')).includes(RUNNER_TEST_FILE), 'trust-root runner test leaked into node discovery');
});
