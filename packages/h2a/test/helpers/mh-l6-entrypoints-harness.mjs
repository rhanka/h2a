// Fresh process for E2b3 entry guards. Installs the closed image reader
// plus the execution policy for the fixture image, then attempts one
// guarded child entry per action and reports JSON. The test process itself
// stays unpatched: child coverage is never deduced from the parent.
import cp from 'node:child_process';
import threads from 'node:worker_threads';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const [entryUrl, action, operand = '', loaderUrl] = process.argv.slice(2);
if (typeof loaderUrl !== 'string' || !loaderUrl.startsWith('file:')) throw new Error('harness_loader_url_required');
const { ensureManagedImageExecution } = await import(loaderUrl);
const report = value => { process.stdout.write(JSON.stringify(value) + '\n'); };
const refused = error => { report({ refused: error?.message ?? String(error) }); };
const done = value => { report({ ok: true, ...value }); };

try {
  const installed = await ensureManagedImageExecution(entryUrl);
  if (!installed) throw new Error('harness_image_uninstalled');
  const imageRoot = fileURLToPath(new URL('.', entryUrl));
  // Benign decoy under the image root: the shell/bare refusal is about the
  // image-byte location, and a pre-fix run must execute nothing sensitive.
  const entry = operand || join(imageRoot, 'dist/bin.js');
  switch (action) {
    case 'exec-shell-image':
      cp.exec(`node ${entry}`, () => {});
      throw new Error('harness_expected_refusal');
    case 'exec-shell-external': {
      const out = await new Promise((resolve, reject) => {
        cp.exec('echo entrypoints-ok', (error, stdout) => (error ? reject(error) : resolve(stdout)));
      });
      done({ stdout: out.trim() });
      break;
    }
    case 'execsync-shell-image':
      cp.execSync(`node ${entry}`);
      throw new Error('harness_expected_refusal');
    case 'execsync-shell-external':
      done({ stdout: String(cp.execSync('echo entrypoints-ok')).trim() });
      break;
    case 'execfile-bare-image':
      cp.execFile(entry, () => {});
      throw new Error('harness_expected_refusal');
    case 'execfile-bare-external': {
      const code = await new Promise(resolve => {
        const child = cp.execFile('/bin/true', () => {});
        child.once('error', () => resolve('spawn-error'));
        child.once('close', c => resolve(c));
      });
      done({ code });
      break;
    }
    case 'spawn-bare-image': {
      const child = cp.spawn(entry);
      child.once('error', () => {}); // pre-fix EACCES stays a clean RED, never a crash
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      throw new Error('harness_expected_refusal');
    }
    case 'spawn-shell-external': {
      const out = await new Promise((resolve, reject) => {
        const child = cp.spawn('echo entrypoints-ok', { shell: true });
        let text = '';
        child.stdout.on('data', b => { text += b; });
        child.once('error', reject);
        child.once('close', code => (code === 0 ? resolve(text.trim()) : reject(new Error(`exit-${code}`))));
      });
      done({ stdout: out });
      break;
    }
    case 'worker-eval':
      new threads.Worker('evil', { eval: true });
      throw new Error('harness_expected_refusal');
    case 'legacy-load': {
      // Genuine published legacy bytes copied into the image but absent
      // from its manifest: image code must not load them, late or not.
      const probe = join(imageRoot, 'legacy-probe.mjs');
      fs.copyFileSync(operand, probe);
      await import(pathToFileURL(probe).href);
      throw new Error('harness_expected_refusal');
    }
    default:
      throw new Error(`harness_unknown_action:${action}`);
  }
} catch (error) {
  if (error?.message === 'harness_expected_refusal') {
    report({ executed: true });
    process.exitCode = 10;
  } else {
    refused(error);
    process.exitCode = 1;
  }
}
