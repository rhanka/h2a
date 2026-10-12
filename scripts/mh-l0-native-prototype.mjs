// Feasibility only: local compiler is measured, not a pinned release toolchain.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';
const exec = promisify(execFile);
const hash = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

export async function buildNativePrototype(temp) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('prototype_profile_unqualified');
  const require = createRequire(import.meta.url);
  const sourceRoot = dirname(require.resolve('node-pty/package.json'));
  const addonRoot = dirname(require.resolve('node-addon-api/package.json'));
  const source = join(sourceRoot, 'src/unix/pty.cc');
  const probePath = join(temp, 'node_modules/node-pty');
  mkdirSync(join(probePath, 'build/Release'), { recursive: true, mode: 0o700 });
  cpSync(join(sourceRoot, 'lib'), join(probePath, 'lib'), { recursive: true });
  cpSync(join(sourceRoot, 'LICENSE'), join(probePath, 'LICENSE'));
  const packageInfo = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  writeFileSync(join(probePath, 'package.json'), JSON.stringify({ name: 'node-pty',
    version: packageInfo.version, license: packageInfo.license, main: './lib/index.js' }));
  const binary = join(probePath, 'build/Release/pty.node');
  const flags = ['-shared', '-fPIC', '-std=c++17', '-O2', '-D_FORTIFY_SOURCE=2',
    '-DNODE_ADDON_API_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty',
    '-I/usr/include/node', `-I${addonRoot}`, source, '-lutil', '-pthread', '-o', binary];
  const env = { PATH: process.env.PATH, XDG_RUNTIME_DIR: temp, XDG_STATE_HOME: temp, LC_ALL: 'C' };
  const compiler = (await exec('c++', ['--version'], { env })).stdout.split('\n')[0];
  await exec('c++', flags, { cwd: temp, env, timeout: 30000 });
  const inputs = { compiler, flags: flags.map(s => s === binary ? '<output>' : s),
    sourceDigest: hash(source), nodeHeaderDigest: hash('/usr/include/node/node_api.h'),
    addonHeaderDigest: hash(join(addonRoot, 'napi.h')), addonInlineDigest: hash(join(addonRoot, 'napi-inl.h')) };
  return { binary, probePath, packageVersion: packageInfo.version,
    binaryDigest: hash(binary), toolchainDigest: digest(inputs), compiler,
    profile: { platform: process.platform, arch: process.arch, libc: 'glibc', node: process.version,
      nodeAbi: process.versions.modules, napi: process.versions.napi }, qualification: 'L0-local-feasibility-only' };
}
