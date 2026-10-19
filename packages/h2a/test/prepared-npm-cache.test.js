import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { observeNodeTrackEntry } from './helpers/node-track-observation-lab.js';

test('should preserve the prepared npm cache while isolating HOME for every test suite', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const source = readFileSync(new URL('../../../scripts/run-tests.mjs', import.meta.url), 'utf8');
  observeNodeTrackEntry(source, repo, { preparedNpmCache: true });
});
