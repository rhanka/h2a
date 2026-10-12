// MH-L1 packaging experiment. No adoption, release qualification or postinstall.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePrototype } from './mh-l0-native-prototype.mjs';
import { createManifest } from '../packages/h2a/src/runtime/handover/image.js';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const testModule = path => /\.test\.(?:[cm]?js|d\.ts)(?:\.map)?$/.test(path);
function removeTestsAndEmptyDirectories(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name); const info = lstatSync(path);
    if (info.isDirectory()) {
      removeTestsAndEmptyDirectories(path);
      if (!readdirSync(path).length) rmdirSync(path);
    } else if (info.isFile() && testModule(path)) rmSync(path);
  }
}
function dependencyDirectory(name, requester) {
  for (let cursor = requester;; cursor = dirname(cursor)) {
    const path = join(cursor, 'node_modules', name);
    if (existsSync(join(path, 'package.json'))) return realpathSync(path);
    if (dirname(cursor) === cursor) return undefined;
  }
}

export async function buildPackagingPrototype(root, { buildId } = {}) {
  root = resolve(root);
  if (!buildId || Number(process.versions.node.split('.')[0]) < 22 || process.platform !== 'linux' ||
      process.arch !== 'x64' || !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('prototype_profile_unqualified');
  }
  if (existsSync(root)) throw new Error('prototype_destination_must_be_new');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const native = await buildNativePrototype(root);
  removeTestsAndEmptyDirectories(root);
  const records = new Map(); const bySource = new Map(); const top = new Map();
  const nativeRelative = 'node_modules/node-pty';
  const nativeInfo = json(join(root, nativeRelative, 'package.json'));
  records.set(nativeRelative, nativeInfo); top.set('node-pty', nativeRelative);
  bySource.set(dependencyDirectory('node-pty', repo), nativeRelative);

  function copyPackage(source, parent) {
    source = realpathSync(source);
    if (bySource.has(source)) return bySource.get(source);
    const original = json(join(source, 'package.json'));
    const existing = top.get(original.name);
    const destination = existing ? `${parent}/node_modules/${original.name}` : `node_modules/${original.name}`;
    if (records.has(destination)) throw new Error(`prototype_dependency_collision:${destination}`);
    if (!existing) top.set(original.name, destination);
    bySource.set(source, destination);
    const absolute = join(root, destination); mkdirSync(absolute, { recursive: true });
    const localWorkspace = dirname(source) === join(repo, 'packages');
    const filter = path => !relative(source, path).split('/').includes('node_modules') &&
      !/\.py$/.test(path) && !testModule(path) && !path.endsWith('.tsbuildinfo');
    if (localWorkspace) {
      if (!existsSync(join(source, 'dist/index.js'))) throw new Error(`prototype_build_required:${original.name}`);
      for (const entry of original.files) if (existsSync(join(source, entry))) {
        cpSync(join(source, entry), join(absolute, entry), { recursive: true, dereference: true, filter });
      }
    } else cpSync(source, absolute, { recursive: true, dereference: true, filter });
    const metadata = { ...original };
    for (const key of ['scripts', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta',
      'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'files']) delete metadata[key];
    // The copied tree is already the chosen payload. A second npm files filter
    // must not silently drop part of that tree (e.g. installed CHANGELOGs).
    metadata.dependencies = {};
    // Freeze the actual peer choices too. No peer range is resolved at install.
    const dependencies = { ...original.peerDependencies, ...original.optionalDependencies, ...original.dependencies };
    if (original.name === '@sentropic/h2a') dependencies['@sentropic/h2a-runtime'] = json(join(repo, 'packages/h2a-runtime/package.json')).version;
    records.set(destination, metadata);
    for (const name of Object.keys(dependencies).sort()) {
      const directory = dependencyDirectory(name, source);
      if (!directory) {
        if (original.optionalDependencies?.[name] || original.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`prototype_dependency_missing:${original.name}:${name}`);
      }
      const child = copyPackage(directory, destination);
      metadata.dependencies[name] = records.get(child).version;
    }
    write(join(absolute, 'package.json'), metadata);
    return destination;
  }
  const corePath = copyPackage(join(repo, 'packages/h2a'), '');
  const runtimePath = copyPackage(join(repo, 'packages/h2a-runtime'), '');
  const coreVersion = records.get(corePath).version;
  const runtimeVersion = records.get(runtimePath).version;
  if (coreVersion !== runtimeVersion) throw new Error('prototype_core_runtime_mismatch');
  cpSync(join(repo, 'packages/h2a/src/runtime/mcp/transport/UPSTREAM.md'),
    join(root, corePath, 'dist/runtime/mcp/transport/UPSTREAM.md'));
  const version = '0.98.7-mh-l1.0';
  const pkg = { name: '@sentropic/h2a-mh-l1-prototype', version, private: true, type: 'module',
    engines: { node: '>=22' }, main: 'dist/index.js', bin: { h2a: 'dist/bin.js' },
    dependencies: Object.fromEntries([...top].sort(([a], [b]) => a.localeCompare(b)).map(([name, path]) => [name, records.get(path).version])),
    bundleDependencies: [...top.keys()].sort() };
  write(join(root, 'package.json'), pkg);
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/bin.js'), `#!/usr/bin/env node\nimport '../${corePath}/dist/bin.js';\n`, { mode: 0o755 });
  writeFileSync(join(root, 'dist/index.js'), `export * from '../${corePath}/dist/index.js';\n`);
  const lock = { name: pkg.name, version, lockfileVersion: 3, requires: true, packages: {
    '': { name: pkg.name, version, dependencies: pkg.dependencies, engines: pkg.engines, bundleDependencies: pkg.bundleDependencies }
  } };
  for (const [path, info] of [...records].sort(([a], [b]) => a.localeCompare(b))) lock.packages[path] = {
    name: info.name, version: info.version, inBundle: true, dependencies: info.dependencies ?? {}
  };
  write(join(root, 'npm-shrinkwrap.json'), lock);
  write(join(root, 'prototype.json'), { schemaVersion: 1, buildId, releaseQualified: false,
    installationLayout: 'prototype-unmanaged', closureQualification: 'dependency-snapshot-only',
    installerProfile: { npmUmask: '022', processUmask: '022' },
    coreVersion, runtimeVersion, transport: `${corePath}/dist/runtime/mcp/transport/streamable-http.js`,
    remainingGates: ['closed-late-import-graph-U12', 'pinned-native-toolchain-U10', 'final-0.98.6-byte-freeze-U13', 'real-Claude-MH-L8'] });
  // npm's tar/install path normalizes modes. Describe those actual payload
  // modes before hashing; an installed payload must match, not just repeat.
  removeTestsAndEmptyDirectories(root);
  const normalize = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name); const info = lstatSync(path);
      if (info.isDirectory()) { chmodSync(path, 0o755); normalize(path); }
      else if (info.isFile()) chmodSync(path, info.mode & 0o111 ? 0o755 : 0o644);
      else throw new Error('prototype_special_file');
    }
  };
  normalize(root);
  for (const [path, metadata] of [...records, ['', pkg]]) {
    const bins = typeof metadata.bin === 'string' ? [metadata.bin] : Object.values(metadata.bin ?? {});
    for (const bin of bins) chmodSync(join(root, path, bin), 0o755);
  }
  // npm regenerates bundled dependency bins during install. Include their
  // internal links in the expected payload rather than excluding .bin.
  for (const [path, metadata] of records) {
    const bins = typeof metadata.bin === 'string'
      ? { [metadata.name.split('/').at(-1)]: metadata.bin } : metadata.bin ?? {};
    const moduleDirectory = join(root, path.slice(0, -metadata.name.length));
    for (const [name, bin] of Object.entries(bins)) {
      const directory = join(moduleDirectory, '.bin'); mkdirSync(directory, { recursive: true, mode: 0o755 });
      symlinkSync(relative(directory, join(root, path, bin)), join(directory, name));
    }
  }
  const manifest = createManifest(root, { packageVersion: version, buildId,
    profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
    entrypoints: { shim: 'dist/bin.js', core: `${corePath}/dist/index.js`, runtime: `${runtimePath}/dist/index.js` },
    startupWaitBudgetMs: 10000, maxAttachments: 64,
    nativeArtifacts: [{ path: `${nativeRelative}/build/Release/pty.node`, digest: native.binaryDigest,
      nodeAbi: process.versions.modules, arch: process.arch, libc: 'glibc', toolchainDigest: native.toolchainDigest, probePath: nativeRelative }]
  });
  write(join(root, 'manifest.json'), manifest);
  return { root, manifest, manifestDigest: digest(manifest), native, coreVersion, runtimeVersion };
}
