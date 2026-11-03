import fs from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { stop } from 'esbuild';
import { buildReleasePayload } from './mh-l1-package-prototype.mjs';
import { verifyPublishablePayload } from './check-publish-payload.mjs';
const exec = promisify(execFile), repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Measured 2026-11-03: the candidate payload (~525 MB tree, 61 MB tarball)
// needs ~38 s CPU for `npm pack` alone and ~59 s for the whole flow on an
// idle box. Under the full parallel CI campaign the 120 s backstop trips
// (SIGTERM kill, empty stderr, exit 1) while npm is still usefully packing.
// 600 s keeps a true hang loud without mistaking loaded progress for a hang.
export const NPM_STEP_TIMEOUT_MS = 600_000;

/**
 * One npm invocation with a loaded-progress-tolerant backstop. Failures keep
 * the command output tails: an empty-stderr SIGTERM kill reads as a timeout
 * instead of masquerading as an npm usage error.
 */
export async function npmStep(label, args, options) {
  try {
    return await exec('npm', args, options);
  } catch (error) {
    const killed = error?.killed === true || error?.signal != null;
    const stdout = typeof error?.stdout === 'string' ? error.stdout.slice(-4000) : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr.slice(-4000) : '';
    throw new Error(`${label} failed (${killed ? `killed${error?.signal ? ` by ${error.signal}` : ''}` : `code ${error?.code ?? 'unknown'}`})` +
      `: ${error?.message ?? error}` +
      (stdout ? `\n--- stdout tail ---\n${stdout}` : '') +
      (stderr ? `\n--- stderr tail ---\n${stderr}` : ''));
  }
}
function breakInstallHardlinks(root) {
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const path = join(directory, name), info = fs.lstatSync(path);
      if (info.isDirectory() && !info.isSymbolicLink()) walk(path);
      else if (info.isFile() && info.nlink > 1) {
        const tmp = `${path}.delink`;
        fs.writeFileSync(tmp, fs.readFileSync(path));
        fs.chmodSync(tmp, info.mode);
        fs.renameSync(tmp, path);
      }
    }
  };
  walk(root);
}
export async function packRelease(directory, options) {
  directory = resolve(directory); fs.mkdirSync(directory, { mode: 0o700 });
  const payload = await buildReleasePayload(join(directory, 'payload'), options), artifacts = join(directory, 'artifacts');
  const original = verifyPublishablePayload(payload.root);
  fs.mkdirSync(artifacts, { mode: 0o700 });
  const profile = join(directory, 'npm-profile'), check = join(directory, 'installed-check');
  fs.mkdirSync(profile, { mode: 0o700 });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_ignore_scripts$/i.test(key)) delete env[key];
  for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
    env[key] = join(profile, key.toLowerCase()); fs.mkdirSync(env[key], { mode: 0o700 });
  }
  for (const key of ['npm_config_userconfig', 'npm_config_globalconfig']) { env[key] = join(profile, key); fs.writeFileSync(env[key], ''); }
  Object.assign(env, { npm_config_offline: 'true', npm_config_umask: '022', npm_config_bin_links: 'true', npm_config_cache: join(profile, 'cache') });
  const args = ['pack', '--offline', '--json', '--pack-destination', artifacts];
  try {
    const packed = await npmStep('npm pack', args, { cwd: payload.root, env, timeout: NPM_STEP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const receipt = JSON.parse(packed.stdout)[0];
    if (!receipt?.filename || basename(receipt.filename) !== receipt.filename) throw Error('release_tarball_path_invalid');
    const filename = join(artifacts, receipt.filename), bytes = fs.readFileSync(filename);
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (integrity !== receipt.integrity) throw Error('release_tarball_integrity_mismatch');
    // npm omits .bin links from the tar and recreates them during installation.
    // Verify the real installed tree, including those links; add no exclusions
    // to the executable payload and do not regenerate/bless a different manifest.
    // The check install proves the tarball extracts to the manifest image, so no
    // lifecycle script runs here: a native rebuild would add files and hardlinks
    // the manifest does not cover. Production installs still run the kept
    // prebuild resolver scripts, which resolve the vendored prebuilds.
    const installArgs = ['install', '-g', '--prefix', check, '--offline', '--umask=022', '--no-audit', '--no-fund', '--ignore-scripts', filename];
    const installed = await npmStep('npm install', installArgs, { cwd: directory, env, timeout: NPM_STEP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    // npm links byte-identical files on install. The image invariant forbids
    // shared inodes, but the manifest covers bytes: break install-time
    // hardlinks into real copies (identical bytes, exclusive inodes) so the
    // verified tree matches the manifest exactly.
    breakInstallHardlinks(join(check, 'lib/node_modules', original.packageName));
    const actual = verifyPublishablePayload(join(check, 'lib/node_modules', original.packageName));
    if (actual.publishedDigest !== original.publishedDigest) throw Error('release_packed_manifest_changed');
    return { payload, root: payload.root, filename, integrity, name: receipt.name, version: receipt.version,
      files: receipt.files.length, command: ['npm', ...args], stdout: packed.stdout, stderr: packed.stderr,
      installCheck: { command: ['npm', ...installArgs], stdout: installed.stdout, stderr: installed.stderr } };
  } finally { for (const path of [profile, check]) fs.rmSync(path, { recursive: true, force: true }); }

}
async function main() {
  process.umask(0o022);
  const { values } = parseArgs({ options: { output: { type: 'string' }, package: { type: 'string' },
    version: { type: 'string' }, 'build-id': { type: 'string' }, all: { type: 'boolean' },
    publish: { type: 'boolean' }, tag: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write('node scripts/package-release.mjs --output <new-directory> [--package @sentropic/h2a|@sentropic/h2a-runtime | --all] [--version X.Y.Z] [--build-id ID] [--publish] [--tag TAG]\n'); return;
  }
  if (values.all && values.package) throw Error('release_package_options_conflict');
  let buildId = values['build-id'];
  if (!buildId) buildId = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const base = values.output ? resolve(values.output) : fs.mkdtempSync(join(tmpdir(), 'h2a-release-'));
  const names = values.all ? ['@sentropic/h2a-runtime', '@sentropic/h2a'] : [values.package ?? '@sentropic/h2a'];
  if (values.all && values.output) fs.mkdirSync(base, { mode: 0o700 });
  const results = [];
  for (const packageName of names) {
    const destination = values.all ? join(base, packageName.split('/').at(-1)) : values.output ? base : join(base, 'package');
    const result = await packRelease(destination, { packageName, buildId, ...(values.version ? { version: values.version } : {}) });
    if (values.publish) {
      const args = ['publish', result.filename, '--access', 'public', ...(values.tag ? ['--tag', values.tag] : [])];
      const published = await exec('npm', args, { cwd: repo, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      result.publish = { command: ['npm', ...args], stdout: published.stdout, stderr: published.stderr };
    }
    // The full npm file list is retained by callers of packRelease; the CLI's
    // review receipt stays small and contains the exact artifact to publish.
    const { stdout, payload, ...summary } = result; results.push(summary);
  }
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  finally { stop(); }
}
