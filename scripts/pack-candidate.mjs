import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stop } from 'esbuild';
import { packRelease } from './package-release.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));

// One artifact producer for verify, rehearsal, smoke and installed-dist tests.
// The workspace prepack refusal remains mandatory for core and runtime.
export async function packCandidate(output, { buildId } = {}) {
  output = resolve(output);
  fs.mkdirSync(output, { recursive: true });
  buildId ??= (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const stage = fs.mkdtempSync(join(tmpdir(), 'h2a-candidate-'));
  try {
    // The two verified payloads are independent (separate stage directories
    // and per-call npm profiles/caches): pack them concurrently so the slow
    // `npm pack` steps overlap instead of stacking end to end.
    const packed = await Promise.all(['h2a-runtime', 'h2a'].map((name) =>
      packRelease(join(stage, name), { packageName: '@sentropic/' + name, buildId })));
    for (const result of packed) {
      fs.copyFileSync(result.filename, join(output, result.filename.split('/').at(-1)), fs.constants.COPYFILE_EXCL);
    }
    // Focus joins the release wave at its own manifest version. It must use
    // the same artifact/sha proof as the four lockstep packages.
    for (const name of ['track', 'h2a-cli', 'focus']) {
      await exec('npm', ['pack', '--workspace', '@sentropic/' + name, '--pack-destination', output], {
        cwd: repo, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      });
    }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.umask(0o022);
    if (process.argv.length !== 3) throw new Error('expected candidate tarball directory');
    await packCandidate(process.argv[2]);
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  finally { stop(); }
}
