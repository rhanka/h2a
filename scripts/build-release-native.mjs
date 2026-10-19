// Release-time build/verification only. Never invoked by an install script.
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';

const exec = promisify(execFile);
const lockPath = fileURLToPath(new URL('./release/native-toolchain.lock.json', import.meta.url));
const lock = () => JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const binaryPath = 'node_modules/node-pty/build/Release/pty.node';
function profile(recipe) {
  const glibc = process.report.getReport().header.glibcVersionRuntime;
  if (process.platform !== 'linux' || process.arch !== 'x64' || !glibc ||
    !recipe.nodeMajors.includes(Number(process.versions.node.split('.')[0])) ||
    !recipe.nodeAbis.includes(process.versions.modules) || Number(process.versions.napi) < recipe.napiVersion) {
    throw Error('native_profile_unqualified');
  }
  const [major, minor] = glibc.split('.').map(Number);
  if (major < 2 || (major === 2 && minor < 31)) throw Error('native_profile_unqualified');
}
function bytesAt(path) {
  const info = fs.lstatSync(path);
  if (!info.isFile() || info.nlink !== 1) throw Error('native_file_unqualified');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd), now = fs.lstatSync(path);
    if (opened.dev !== info.dev || opened.ino !== info.ino || after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || now.dev !== opened.dev || now.ino !== opened.ino) {
      throw Error('native_file_changed');
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}
function inventory(root) {
  const rows = [];
  const walk = (directory, base = '') => {
    for (const name of fs.readdirSync(directory).sort()) {
      const path = join(directory, name), relative = base ? `${base}/${name}` : name, info = fs.lstatSync(path);
      if (info.isDirectory()) {
        rows.push({ path: relative, type: 'directory', mode: info.mode & 0o777 }); walk(path, relative);
      } else if (info.isFile()) rows.push({ path: relative, type: 'file', mode: info.mode & 0o777, digest: hash(bytesAt(path)) });
      else throw Error('native_payload_link_or_special_file');
    }
  };
  if (!fs.lstatSync(root).isDirectory() || fs.realpathSync(root) !== resolve(root)) throw Error('native_payload_location_invalid');
  walk(root); return rows;
}
function descriptor(recipe, payload) {
  return { schemaVersion: 1, recipeDigest: digest(recipe), payloadDigest: digest(inventory(payload)),
    binaryDigest: hash(bytesAt(join(payload, binaryPath))) };
}
function copyLib(source, target) {
  fs.mkdirSync(target, { mode: 0o755 });
  for (const name of fs.readdirSync(source).sort()) {
    const path = join(source, name), info = fs.lstatSync(path);
    if (info.isDirectory()) copyLib(path, join(target, name));
    else if (info.isFile() && /\.js$/.test(name) && !/\.test\.js$/.test(name)) {
      fs.writeFileSync(join(target, name), bytesAt(path), { mode: 0o644 });
    }
  }
}

export async function buildReleaseNative(destination, { archives } = {}) {
  const { recipe } = lock(); profile(recipe);
  // All archive bytes are checked before a compiler or extraction is started.
  // Extract the verified buffers, never a pathname that can change after hashing.
  const inputs = recipe.archives.map(input => {
    const bytes = bytesAt(join(archives, input.name));
    if (hash(bytes) !== 'sha256:' + input.sha256) throw Error('native_input_digest_mismatch:' + input.name);
    return { ...input, bytes };
  });
  destination = resolve(destination);
  const stage = fs.mkdtempSync(join(dirname(destination), '.h2a-native-build-'));
  let created = false, completed = false;
  const commandLog = [];
  try {
    fs.mkdirSync(destination, { mode: 0o700 }); created = true;
    const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', SOURCE_DATE_EPOCH: recipe.sourceDateEpoch };
    for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME',
      'XDG_CACHE_HOME', 'TMPDIR', 'ZIG_GLOBAL_CACHE_DIR', 'ZIG_LOCAL_CACHE_DIR']) {
      env[key] = join(stage, key.toLowerCase()); fs.mkdirSync(env[key], { mode: 0o700 });
    }
    for (const input of inputs) {
      const directory = join(stage, input.name.replace(/\.(?:tar\.xz|tgz)$/, ''));
      fs.mkdirSync(directory, { mode: 0o700 });
      const archive = join(stage, input.name); fs.writeFileSync(archive, input.bytes, { mode: 0o600 });
      const listing = await exec('/usr/bin/tar', ['-tf', archive], { env, maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
      if (listing.stdout.split('\n').filter(Boolean).some(path => path.startsWith('/') || path.split('/').includes('..'))) {
        throw Error('native_archive_path_invalid');
      }
      // node-pty's upstream prebuilds, scripts and node-gyp input are not inputs
      // to this release build. Extract just the real source/runtime resources.
      const members = input.name === 'node-pty.tgz'
        ? ['package/src/unix/pty.cc', 'package/lib', 'package/LICENSE', 'package/package.json'] : [];
      await exec('/usr/bin/tar', ['-xf', archive, '--no-same-owner', '--no-same-permissions', '-C', directory, ...members],
        { env, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    }
    const payload = join(destination, 'payload'), pkg = join(payload, 'node_modules/node-pty');
    fs.mkdirSync(join(pkg, 'build/Release'), { recursive: true, mode: 0o755 });
    const source = join(stage, 'node-pty/package'), metadata = JSON.parse(fs.readFileSync(join(source, 'package.json')));
    if (metadata.name !== 'node-pty' || metadata.version !== '1.1.0') throw Error('native_source_identity_mismatch');
    copyLib(join(source, 'lib'), join(pkg, 'lib'));
    fs.writeFileSync(join(pkg, 'LICENSE'), bytesAt(join(source, 'LICENSE')), { mode: 0o644 });
    fs.writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'node-pty', version: metadata.version,
      license: metadata.license, main: './lib/index.js', os: ['linux'], cpu: ['x64'] }, null, 2) + '\n', { mode: 0o644 });
    const zig = join(stage, 'zig/zig-x86_64-linux-0.14.1'), licenses = join(pkg, 'third-party-licenses');
    fs.mkdirSync(licenses, { mode: 0o755 });
    for (const name of ['libcxx', 'libcxxabi', 'libunwind']) {
      fs.writeFileSync(join(licenses, name + '.txt'), bytesAt(join(zig, 'lib', name, 'LICENSE.TXT')), { mode: 0o644 });
    }
    fs.writeFileSync(join(licenses, 'zig.txt'), bytesAt(join(zig, 'LICENSE')), { mode: 0o644 });
    const binary = join(payload, binaryPath), args = recipe.flags.map(arg => arg.replaceAll('@STAGE@', stage).replaceAll('@BINARY@', binary));
    const cpu = /^Cpus_allowed_list:\s*([0-9]+)/m.exec(fs.readFileSync('/proc/self/status', 'utf8'))?.[1];
    if (!cpu) throw Error('native_build_cpu_scope_unknown');
    // One CPU prevents a release qualification from saturating the owner's host.
    const command = ['/usr/bin/taskset', '-c', cpu, join(zig, 'zig'), ...args];
    const result = await exec(command[0], command.slice(1), { cwd: stage, env, timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    commandLog.push({ command, stdout: result.stdout, stderr: result.stderr, code: 0 });
    fs.chmodSync(binary, 0o755);
    const artifact = descriptor(recipe, payload);
    fs.writeFileSync(join(destination, 'native-artifact.json'), JSON.stringify(artifact, null, 2) + '\n', { mode: 0o644 });
    completed = true;
    return { root: destination, payload, artifact, commands: commandLog,
      target: recipe.target, testedHost: { node: process.version, glibc: process.report.getReport().header.glibcVersionRuntime } };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (created && !completed) fs.rmSync(destination, { recursive: true, force: true });
  }
}

// Packagers consume only a precompiled artifact registered in the release lock.
// No compiler, npm script, network operation or source fallback is reachable here.
export function verifyReleaseNative(root) {
  const { recipe, artifact } = lock(); profile(recipe);
  if (!artifact || artifact.recipeDigest !== digest(recipe)) throw Error('native_artifact_unregistered');
  if (fs.readdirSync(root).sort().join(',') !== 'native-artifact.json,payload') throw Error('native_artifact_unexpected_file');
  const stored = JSON.parse(bytesAt(join(root, 'native-artifact.json'))), observed = descriptor(recipe, join(root, 'payload'));
  if (digest(stored) !== digest(artifact) || digest(observed) !== digest(artifact)) throw Error('native_artifact_mismatch');
  return { payload: join(root, 'payload'), ...observed, target: recipe.target, napiVersion: recipe.napiVersion };
}

// Release packaging copies a shipped prebuild. This path has no source or
// compiler fallback and cannot run the upstream package's installation scripts.
export async function copyReleaseNative(destination) {
  const release = lock(); profile(release.recipe);
  const archive = bytesAt(fileURLToPath(new URL('./release/' + release.archive.path, import.meta.url)));
  if (hash(archive) !== 'sha256:' + release.archive.sha256) throw Error('native_archive_mismatch');
  if (fs.readdirSync(destination).length) throw Error('native_destination_must_be_empty');
  const stage = fs.mkdtempSync(join(dirname(resolve(destination)), '.h2a-native-copy-'));
  try {
    const path = join(stage, 'native.tgz'), extracted = join(stage, 'artifact');
    fs.writeFileSync(path, archive, { mode: 0o600 }); fs.mkdirSync(extracted, { mode: 0o700 });
    await exec('/usr/bin/tar', ['-xf', path, '--no-same-owner', '-C', extracted], {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', HOME: stage, XDG_RUNTIME_DIR: stage,
        XDG_CONFIG_HOME: stage, XDG_STATE_HOME: stage, XDG_CACHE_HOME: stage, TMPDIR: stage }, timeout: 30000 });
    const verified = verifyReleaseNative(extracted);
    fs.cpSync(join(verified.payload, 'node_modules'), join(destination, 'node_modules'), {
      recursive: true, dereference: false, errorOnExist: true, force: false });
    return { probePath: join(destination, 'node_modules/node-pty'), binary: join(destination, binaryPath),
      packageVersion: '1.1.0', binaryDigest: verified.binaryDigest, toolchainDigest: verified.recipeDigest,
      qualification: 'release-pinned-prebuild', archiveDigest: 'sha256:' + release.archive.sha256 };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
