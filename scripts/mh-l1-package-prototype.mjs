// Dependency snapshot construction. Prototype and closed release entrypoints
// remain separate: the release path consumes only the registered native prebuild.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativePrototype } from './mh-l0-native-prototype.mjs';
import { createManifest } from '../packages/h2a/src/runtime/handover/image.js';
import { digest } from '../packages/h2a/src/runtime/handover/wire.js';
import { buildManagedLauncher } from './build-managed-launcher.mjs';
import { copyReleaseNative } from './build-release-native.mjs';
import { validateFocusArtifact } from './focus-app-artifact-lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o644 });
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
function dependencyDirectory(name, requester, closed = false) {
  for (let cursor = requester;; cursor = dirname(cursor)) {
    const path = join(cursor, 'node_modules', name);
    if (existsSync(join(path, 'package.json'))) {
      const physical = realpathSync(path);
      if (closed && !physical.startsWith(repo + '/')) throw new Error('release_dependency_external:' + name);
      return physical;
    }
    if (closed && cursor === repo) return undefined;
    if (dirname(cursor) === cursor) return undefined;
  }
}

export async function buildPackagingPrototype(root, { buildId, managedRoot } = {}) {
  return buildPayload(root, { buildId, managedRoot });
}
export async function buildReleasePayload(root, { buildId, managedRoot, version = json(join(repo, 'packages/h2a/package.json')).version,
  packageName = '@sentropic/h2a' } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !['@sentropic/h2a', '@sentropic/h2a-runtime'].includes(packageName)) {
    throw new Error('release_identity_invalid');
  }
  const { errors } = validateFocusArtifact();
  if (errors.length) throw new Error('release_focus_artifact_invalid:' + errors.join(';'));
  if (json(join(repo, 'packages/h2a/package.json')).version !== json(join(repo, 'packages/h2a-runtime/package.json')).version) {
    throw new Error('release_core_runtime_mismatch');
  }
  return buildPayload(root, { buildId, managedRoot, releaseVersion: version, packageName });
}
async function buildPayload(root, { buildId, managedRoot, releaseVersion, packageName = '@sentropic/h2a' }) {
  const release = releaseVersion !== undefined;
  root = resolve(root);
  if (!buildId || Number(process.versions.node.split('.')[0]) < 22 || process.platform !== 'linux' ||
      process.arch !== 'x64' || !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('prototype_profile_unqualified');
  }
  if (existsSync(root)) throw new Error('prototype_destination_must_be_new');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const native = release ? await copyReleaseNative(root) : await buildNativePrototype(root);
  removeTestsAndEmptyDirectories(root);
  const records = new Map(); const bySource = new Map(); const top = new Map();
  const nativeRelative = 'node_modules/node-pty';
  const nativeInfo = json(join(root, nativeRelative, 'package.json'));
  records.set(nativeRelative, nativeInfo); top.set('node-pty', nativeRelative);
  bySource.set(dependencyDirectory('node-pty', repo, release), nativeRelative);

  function copyPackage(source, parent) {
    source = realpathSync(source);
    if (bySource.has(source)) return bySource.get(source);
    const original = json(join(source, 'package.json'));
    const existing = top.get(original.name);
    const destination = release && original.name === packageName ? '' :
      existing ? `${parent}/node_modules/${original.name}` : `node_modules/${original.name}`;
    if (records.has(destination)) throw new Error(`prototype_dependency_collision:${destination}`);
    if (!existing && destination) top.set(original.name, destination);
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
    if (release && ['@sentropic/h2a', '@sentropic/h2a-runtime'].includes(original.name)) metadata.version = releaseVersion;
    for (const key of ['scripts', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta',
      'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'files']) delete metadata[key];
    // The copied tree is already the chosen payload. A second npm files filter
    // must not silently drop part of that tree (e.g. installed CHANGELOGs).
    metadata.dependencies = {};
    // Freeze the actual peer choices too. No peer range is resolved at install.
    const dependencies = { ...original.peerDependencies, ...original.optionalDependencies, ...original.dependencies };
    if (original.name === '@sentropic/h2a') dependencies['@sentropic/h2a-runtime'] = json(join(repo, 'packages/h2a-runtime/package.json')).version;
    if (release && original.name === '@sentropic/h2a-runtime') dependencies['@sentropic/h2a'] = releaseVersion;
    records.set(destination, metadata);
    for (const name of Object.keys(dependencies).sort()) {
      const directory = dependencyDirectory(name, source, release);
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
  if (release) copyPackage(join(repo, packageName === '@sentropic/h2a' ? 'packages/h2a' : 'packages/h2a-runtime'), '');
  const corePath = copyPackage(join(repo, 'packages/h2a'), '');
  const runtimePath = copyPackage(join(repo, 'packages/h2a-runtime'), '');
  const atCore = path => corePath ? `${corePath}/${path}` : path;
  const atRuntime = path => runtimePath ? `${runtimePath}/${path}` : path;
  const coreVersion = records.get(corePath).version;
  const runtimeVersion = records.get(runtimePath).version;
  if (coreVersion !== runtimeVersion) throw new Error('prototype_core_runtime_mismatch');
  cpSync(join(repo, 'packages/h2a/src/runtime/mcp/transport/UPSTREAM.md'),
    join(root, corePath, 'dist/runtime/mcp/transport/UPSTREAM.md'));
  const version = release ? releaseVersion : '0.98.7-mh-l1.0';
  const pkg = { ...(release ? records.get('') : { name: '@sentropic/h2a-mh-l1-prototype', private: true,
    main: 'dist/index.js', bin: { h2a: 'dist/bin.js' } }), version, type: 'module',
    ...(release ? { os: ['linux'], cpu: ['x64'] } : {}),
    engines: { node: release ? '^22.22.1 || ^24.0.0' : '>=22' },
    dependencies: Object.fromEntries([...top].sort(([a], [b]) => a.localeCompare(b)).map(([name, path]) => [name, records.get(path).version])),
    bundleDependencies: [...top.keys()].sort() };
  write(join(root, 'package.json'), pkg);
  if (!release) {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/bin.js'), `#!/usr/bin/env node\nimport '../${corePath}/dist/bin.js';\n`, { mode: 0o755 });
    writeFileSync(join(root, 'dist/index.js'), `export * from '../${corePath}/dist/index.js';\n`);
  }
  const lock = { name: pkg.name, version, lockfileVersion: 3, requires: true, packages: {
    '': { name: pkg.name, version, dependencies: pkg.dependencies, engines: pkg.engines, bundleDependencies: pkg.bundleDependencies }
  } };
  for (const [path, info] of [...records].sort(([a], [b]) => a.localeCompare(b))) if (path) lock.packages[path] = {
    name: info.name, version: info.version, inBundle: true, dependencies: info.dependencies ?? {}
  };
  write(join(root, 'npm-shrinkwrap.json'), lock);
  if (release) write(join(root, 'payload-build.json'), { schemaVersion: 1, buildId, packageName, packageVersion: version,
    coreVersion, runtimeVersion, transport: atCore('dist/runtime/mcp/transport/streamable-http.js'),
    nativeRecipeDigest: native.toolchainDigest, nativeArchiveDigest: native.archiveDigest });
  else write(join(root, 'prototype.json'), { schemaVersion: 1, buildId, releaseQualified: false,
    installationLayout: 'prototype-unmanaged', closureQualification: 'dependency-snapshot-only',
    installerProfile: { npmUmask: '022', processUmask: '022' },
    coreVersion, runtimeVersion, transport: atCore('dist/runtime/mcp/transport/streamable-http.js'),
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
    if (!path) continue;
    const bins = typeof metadata.bin === 'string'
      ? { [metadata.name.split('/').at(-1)]: metadata.bin } : metadata.bin ?? {};
    const moduleDirectory = join(root, path.slice(0, -metadata.name.length));
    for (const [name, bin] of Object.entries(bins)) {
      const directory = join(moduleDirectory, '.bin'); mkdirSync(directory, { recursive: true, mode: 0o755 });
      symlinkSync(relative(directory, join(root, path, bin)), join(directory, name));
    }
  }
  const execution = (await buildManagedLauncher()).loader;
  write(join(root, 'execution.json'), { schemaVersion: 1, loaderDigest: execution.digest });
  if (managedRoot) {
    mkdirSync(join(managedRoot, 'bootstrap'), { recursive: true, mode: 0o700 });
    writeFileSync(join(managedRoot, 'bootstrap', execution.filename), execution.code, { mode: 0o700 });
  }
  const manifest = createManifest(root, { packageVersion: version, buildId,
    profile: { platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
    entrypoints: { shim: release ? atCore('dist/bin.js') : 'dist/bin.js', core: atCore('dist/index.js'), runtime: atRuntime('dist/index.js') },
    startupWaitBudgetMs: 10000, maxAttachments: 64,
    nativeArtifacts: [{ path: `${nativeRelative}/build/Release/pty.node`, digest: native.binaryDigest,
      nodeAbi: process.versions.modules, arch: process.arch, libc: 'glibc', toolchainDigest: native.toolchainDigest, probePath: nativeRelative }]
  });
  if (release) {
    const manifests = {};
    for (const [major, abi] of [[22, '127'], [24, '137']]) manifests[major] = {
      ...manifest, profile: { ...manifest.profile, nodeMajor: major, nodeAbi: abi },
      nativeArtifacts: manifest.nativeArtifacts.map(artifact => ({ ...artifact, nodeAbi: abi }))
    };
    write(join(root, 'manifest.json'), { schemaVersion: 1, kind: 'h2a-published-payload', manifests });
  } else write(join(root, 'manifest.json'), manifest);
  return { root, manifest, manifestDigest: digest(manifest), native, coreVersion, runtimeVersion, execution };
}
