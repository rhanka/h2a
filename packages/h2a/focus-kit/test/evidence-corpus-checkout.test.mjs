import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

test('should retain the frozen corpus when CI checks out a changed source with depth one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-corpus-checkout-'));
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const checkout = join(root, 'checkout');
  const env = { ...process.env, HOME: root, TMPDIR: root, XDG_RUNTIME_DIR: root,
    XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root, H2A_ROOT: join(root, 'h2a') };
  const run = (command, args, cwd = root) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  };
  try {
    run('git', ['clone', '--quiet', '--depth=1', '--single-branch', pathToFileURL(repo).href, checkout]);
    const workflow = parse(readFileSync(join(repo, '.github/workflows/focus-dossier.yml'), 'utf8'));
    const prepare = 'packages/h2a/focus-kit/test/prepare-evidence-corpus.mjs';
    for (const step of workflow.jobs['portable-focus'].steps) {
      if (step.run === `node ${prepare}`) run(process.execPath, [join(repo, prepare)], checkout);
    }
    const { corpus } = await import(pathToFileURL(join(checkout, 'packages/h2a/focus-kit/test/evidence-corpus.mjs')).href);
    const documents = corpus(root);
    assert.equal(documents.large.sources.length, 31);
    assert.equal(documents.large.sources.reduce((total, source) => total + source.size, 0), 22_945_971);
    console.log('Depth-one checkout: all 1,731 frozen source blobs and original corpus bytes verified');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
