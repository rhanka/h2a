// Dependency snapshot construction. Prototype and closed release entrypoints
// remain separate: the release path consumes only the registered native prebuild.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

/**
 * Nearest reservation for `name` held by an ancestor strictly above
 * `parent` (`{ claim, owner }`), or `undefined` when no ancestor reserves it.
 *
 * The lookup starts at the parent of `parent`: the enquiring package's own
 * scope must not shadow the chain, otherwise every lookup hits at iteration
 * 0 and the defer/nest branches below stay dead while a transitive squats a
 * slot an ancestor reserved at another source.
 */
export function reservationFor(reservations, parent, name) {
  if (!parent) return undefined;
  for (let cursor = dirname(parent) === '.' ? '' : dirname(parent);;) {
    const scope = reservations.get(cursor);
    if (scope?.has(name)) return { claim: scope.get(name), owner: cursor };
    if (!cursor) return undefined;
    const next = dirname(cursor);
    cursor = next === '.' ? '' : next;
  }
}

/**
 * Whether Node, resolving from `dest`, reaches the recorded `childPath` slot
 * for `name` holding `dirReal`. Refuses when an intermediate holder between
 * `dest` and the slot base records or reserves the same slot with another
 * source (that mask is what `check-publish-payload.mjs` would reject as
 * `release_dependency_not_exact`).
 */
export function slotVisibleFrom(records, slotSource, reservations, dest, childPath, name, dirReal) {
  if (!childPath) return true;
  const suffix = `/node_modules/${name}`;
  let base = '';
  if (childPath !== `node_modules/${name}`) {
    if (!childPath.endsWith(suffix)) return false;
    base = childPath.slice(0, -suffix.length);
    if (dest !== base && !dest.startsWith(base + '/')) return false;
  }
  for (let cursor = dest; cursor && cursor !== base;) {
    const cand = `${cursor}/node_modules/${name}`;
    if (records.has(cand) && slotSource.get(cand) !== dirReal) return false;
    const reserved = reservations.get(cursor)?.get(name);
    if (reserved && reserved.source !== dirReal) return false;
    const next = dirname(cursor);
    cursor = next === '.' ? '' : next;
  }
  return true;
}

/**
 * Source holding the `child` slot: the recorded source when the slot already
 * materialized, else the source of the ancestor reservation the slot defers
 * to (`claim.path === child`), else `undefined`. Lets `claimDirect`
 * recognise a deferred same-source slot whose `slotSource` entry does not
 * exist yet instead of force-copying it.
 */
export function deferredChildSource(slotSource, reservations, destination, child, name) {
  if (slotSource.has(child)) return slotSource.get(child);
  const ancestor = reservationFor(reservations, destination, name);
  return ancestor?.claim.path === child ? ancestor.claim.source : undefined;
}

/**
 * Register the verified native prebuild slot. Records the `slotSource` entry
 * together with `records`/`top`/`bySource`: without it `claimDirect` never
 * recognises the prebuild and force-copies the raw workspace `node-pty`
 * under the runtime destination.
 */
export function recordNativeSlot(maps, nativeRelative, nativeSource, nativeInfo) {
  maps.records.set(nativeRelative, nativeInfo);
  maps.top.set('node-pty', nativeRelative);
  maps.bySource.set(nativeSource, nativeRelative);
  maps.slotSource.set(nativeRelative, nativeSource);
}

/**
 * Top slot already taken for `name` (`{ path }` value) when `source` must
 * nest under its parent instead of squatting it: the recorded top entry, a
 * nearer ancestor reservation holding another source, or the payload-root
 * reservation holding another source. Returns `undefined` when the top slot
 * is free for `source` (same source as the root reservation still hoists).
 * Extracted for the M0-L1 single-mesh unit probe; `copyPackage` below is the
 * only production caller.
 */
export function existingTopSlot(top, reservations, parent, name, source) {
  const found = parent ? reservationFor(reservations, parent, name) : undefined;
  const rootClaim = parent ? reservations.get('')?.get(name) : undefined;
  return top.get(name)
    ?? (found && found.claim.source !== source ? found.claim.path : undefined)
    ?? (rootClaim && rootClaim.source !== source ? rootClaim.path : undefined);
}

/**
 * Single-mesh invariant for the planner records that become
 * npm-shrinkwrap: cluster-mesh and the gateway share ONE hoisted mesh copy.
 * Throws on any nested mesh copy under either parent (the divergent shape
 * the 0.25.0 guard refuses at runtime). Runs before the shrinkwrap is
 * written so a regressing planner fails the build instead of shipping a
 * divergent image.
 */
export function assertSingleHoistedMesh(records) {
  const nested = [...records.keys()].filter(path =>
    /node_modules\/@sentropic\/cluster-mesh\/node_modules\/@sentropic\/llm-mesh(?:\/|$)/.test(path)
    || /node_modules\/@sentropic\/llm-gateway\/node_modules\/@sentropic\/llm-mesh(?:\/|$)/.test(path));
  if (nested.length) throw new Error(`prototype_nested_llm_mesh:${nested.sort().join(',')}`);
}

export async function buildPackagingPrototype(root, { buildId, managedRoot } = {}) {
  return buildPayload(root, { buildId, managedRoot });
}
export async function buildReleasePayload(root, { buildId, managedRoot, version = json(join(repo, 'packages/h2a/package.json')).version,
  packageName = '@sentropic/h2a' } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !['@sentropic/h2a', '@sentropic/h2a-runtime'].includes(packageName)) {
    throw new Error('release_identity_invalid');
  }
  // Closed snapshots remove workspace lifecycle scripts. Preserve main's
  // portable-dossier prepack check before any payload tree is constructed.
  execFileSync(process.execPath, [join(repo, 'scripts/build-focus-dossier.mjs'), '--check'],
    { cwd: repo, encoding: 'utf8', timeout: 30000 });
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
  const records = new Map(); const bySource = new Map(); const top = new Map(); const slotSource = new Map();
  // Every copied package reserves its directs' slots (scope dest → name →
  // { path, source }) before descending into its closure (npm hoisting
  // order). A transitive meeting the SAME source as a reservation defers to
  // the reserving package's own copy (same bytes; the version is read without
  // copying); a transitive with a DIFFERENT source nests under its own
  // parent. Without this, a transitive recorded first squats the slot and the
  // later direct copy escapes as `/node_modules/<name>`
  // (release_shrinkwrap_path_invalid) or collides
  // (prototype_dependency_collision). General case of what the forcedSiblings
  // ordering below fixes for the h2a↔h2a-runtime cross-dep; exposed by the
  // mesh 0.25.0 tuple (optional engram peer pulling commander transitively
  // ahead of the runtime direct; dual mcp-platform generations).
  // A recorded same-source slot Node reaches from dest needs no duplicate:
  // the payload root itself, the top-level slot, or an ancestor slot.
  // Anything else (a sibling subtree, or a slot masked by an intermediate
  // record/reservation at another source) stays invisible and still forces.
  // Decided by the module-level `slotVisibleFrom`.
  const reservations = new Map();
  // Sources currently being copied above us in this walk. A force-copy of a
  // source already on the chain (the h2a<->h2a-runtime lockstep ping-pong
  // under the 0.25.0 tuple) would nest forever until a string limit blows
  // (Invalid string length); accept the dedup path instead. Completed copies
  // leave the set, so intended same-bytes duplicates still materialize.
  const active = new Set();
  const nativeRelative = 'node_modules/node-pty';
  const nativeInfo = json(join(root, nativeRelative, 'package.json'));
  recordNativeSlot({ records, bySource, top, slotSource },
    nativeRelative, dependencyDirectory('node-pty', repo, release), nativeInfo);

  function copyPackage(source, parent, force) {
    source = realpathSync(source);
    if (!force && bySource.has(source)) return bySource.get(source);
    const original = json(join(source, 'package.json'));
    const found = reservationFor(reservations, parent, original.name);
    // Same source as an ancestor's reservation: defer to its own copy (the
    // reserving package's direct loop materializes it; same bytes). The
    // payload root never materializes its own copy, so its reservation only
    // decides hoisting below and never defers.
    if (found && found.owner !== parent && found.owner !== '' && found.claim.source === source && !records.has(found.claim.path)) {
      return found.claim.path;
    }
    // Root directs win the top-level slot (npm hoisting): a transitive that
    // would squat an empty top slot reserved by the payload root at another
    // version nests under its own parent instead. Concrete case: the
    // engram-bundled mesh generation must not claim the top mesh slot ahead
    // of h2a's direct 0.26.0 (single-mesh guard).
    const existing = existingTopSlot(top, reservations, parent, original.name, source);
    // An empty parent is the payload root itself: `${parent}/node_modules/…`
    // would emit a leading-slash key the shrinkwrap checker refuses
    // (release_shrinkwrap_path_invalid). Fall back to the top-level path,
    // mirroring npm nesting (or a loud prototype_dependency_collision when
    // two distinct sources claim it).
    const destination = release && original.name === packageName ? '' :
      !existing ? `node_modules/${original.name}` :
      parent ? `${parent}/node_modules/${original.name}` : `node_modules/${original.name}`;
    if (records.has(destination)) throw new Error(`prototype_dependency_collision:${destination}`);
    if (!existing && destination) top.set(original.name, destination);
    bySource.set(source, destination);
    slotSource.set(destination, source);
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
    // Keep the bare prebuild resolver verbatim. Without its own install script
    // npm falls back to a raw node-gyp rebuild at install time, whose build
    // outputs are hardlinked (obj.target and Release share inodes) and break
    // the no-hardlink image invariant. node-gyp-build resolves the vendored
    // prebuilds without compiling, exactly as the workspace install does.
    if (existsSync(join(source, "binding.gyp")) && (!original.scripts?.install || original.scripts.install === "node-gyp-build")) {
      metadata.scripts = { install: "node-gyp-build" };
    }
    // The copied tree is already the chosen payload. A second npm files filter
    // must not silently drop part of that tree (e.g. installed CHANGELOGs).
    metadata.dependencies = {};
    // Freeze the actual peer choices too. No peer range is resolved at install.
    const dependencies = { ...original.peerDependencies, ...original.optionalDependencies, ...original.dependencies };
    if (original.name === '@sentropic/h2a') dependencies['@sentropic/h2a-runtime'] = json(join(repo, 'packages/h2a-runtime/package.json')).version;
    if (release && original.name === '@sentropic/h2a-runtime') dependencies['@sentropic/h2a'] = releaseVersion;
    records.set(destination, metadata);
    // Reserve this package's directs before descending (npm hoisting order);
    // see reservations above.
    const scope = new Map();
    for (const name of Object.keys(dependencies).sort()) {
      const directory = dependencyDirectory(name, source, release);
      if (directory) scope.set(name, { path: destination ? `${destination}/node_modules/${name}` : `node_modules/${name}`, source: directory });
    }
    reservations.set(destination, scope);
    active.add(source);
    // Version of a just-copied child; a deferred child (same source as a
    // reservation, materialized later by its owner) is read without copying.
    const childVersion = (name, directory, child) =>
      records.get(child)?.version ?? json(join(directory, 'package.json')).version;
    // A direct claims its own Node-resolution slot: when a transitive
    // recorded first shared the same source elsewhere, materialize a second
    // same-bytes copy here (latest direct wins the bySource entry). A slot
    // already held by a different source stays a loud collision.
    const claimDirect = (name, directory) => {
      const want = destination ? `${destination}/node_modules/${name}` : `node_modules/${name}`;
      const child = copyPackage(directory, destination);
      if (child === want) return child;
      const dirReal = realpathSync(directory);
      // Same bytes on a slot visible from here: reuse them instead of
      // nesting a duplicate whose subtree would be re-walked and re-forced
      // (ENOSPC on real trees under the 0.25.0 tuple). A slot deferred to an
      // ancestor reservation has no `slotSource` entry yet: recognise it
      // through the reservation instead of force-copying it.
      const childSource = deferredChildSource(slotSource, reservations, destination, child, name);
      if (childSource === dirReal && slotVisibleFrom(records, slotSource, reservations, destination, child, name, dirReal)) return child;
      if (records.has(want) && slotSource.get(want) !== dirReal) {
        throw new Error(`prototype_dependency_collision:${want}`);
      }
      // A source already copying above us must not be force-copied deeper:
      // that is the lockstep ping-pong, and it only terminates as a crash.
      // The dedup path resolves by Node's upward walk (same bytes).
      if (!records.has(want)) {
        if (active.has(dirReal)) return child;
        return copyPackage(directory, destination, true);
      }
      bySource.set(dirReal, want);
      return want;
    };
    // The h2a↔h2a-runtime lockstep cross-dep resolves after direct deps so a
    // direct pin of the requesting package claims the top-level path (npm
    // semantics). Otherwise a forced-sibling transitive recorded first makes
    // the later direct copy nest under '' as '/node_modules/<name>'.
    const forcedSiblings = ["@sentropic/h2a", "@sentropic/h2a-runtime"].filter((name) => dependencies[name] !== undefined);
    for (const name of Object.keys(dependencies).sort()) {
      if (forcedSiblings.includes(name)) continue;
      const directory = dependencyDirectory(name, source, release);
      if (!directory) {
        if (original.optionalDependencies?.[name] || original.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`prototype_dependency_missing:${original.name}:${name}`);
      }
      const child = claimDirect(name, directory);
      metadata.dependencies[name] = childVersion(name, directory, child);
    }
    for (const name of forcedSiblings) {
      const directory = dependencyDirectory(name, source, release);
      if (!directory) throw new Error(`prototype_dependency_missing:${original.name}:${name}`);
      const child = claimDirect(name, directory);
      metadata.dependencies[name] = childVersion(name, directory, child);
    }
    active.delete(source);
    write(join(absolute, 'package.json'), metadata);
    return destination;
  }
  // Payload-root hoisting reservations: the union of the core and runtime
  // directs, resolved from their workspace dirs. Without this the root-claim
  // branch stays dead and a transitive with another version (the
  // engram-bundled mesh generation pulled via the cluster-mesh subtree
  // before any direct) squats the top slot, forcing the published mesh to
  // nest under both parents (divergent mesh). First workspace wins, mirroring
  // the copy order below.
  {
    const rootScope = new Map();
    for (const workspace of ['packages/h2a', 'packages/h2a-runtime']) {
      const manifest = json(join(repo, workspace, 'package.json'));
      const directs = { ...manifest.peerDependencies, ...manifest.optionalDependencies, ...manifest.dependencies };
      if (workspace === 'packages/h2a') directs['@sentropic/h2a-runtime'] = json(join(repo, 'packages/h2a-runtime/package.json')).version;
      for (const name of Object.keys(directs).sort()) {
        if (rootScope.has(name)) continue;
        const directory = dependencyDirectory(name, join(repo, workspace), release);
        if (directory) rootScope.set(name, { path: `node_modules/${name}`, source: directory });
      }
    }
    reservations.set('', rootScope);
  }
  if (release) copyPackage(join(repo, packageName === '@sentropic/h2a' ? 'packages/h2a' : 'packages/h2a-runtime'), '');
  const corePath = copyPackage(join(repo, 'packages/h2a'), '');
  const runtimePath = copyPackage(join(repo, 'packages/h2a-runtime'), '');
  const atCore = path => corePath ? `${corePath}/${path}` : path;
  const atRuntime = path => runtimePath ? `${runtimePath}/${path}` : path;
  const coreVersion = records.get(corePath).version;
  const runtimeVersion = records.get(runtimePath).version;
  if (coreVersion !== runtimeVersion) throw new Error('prototype_core_runtime_mismatch');
  if (release) for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const filename = join(root, corePath, path), plugin = json(filename);
    plugin.version = releaseVersion; write(filename, plugin);
  }
  cpSync(join(repo, 'packages/h2a/src/runtime/mcp/transport/UPSTREAM.md'),
    join(root, corePath, 'dist/runtime/mcp/transport/UPSTREAM.md'));
  const version = release ? releaseVersion : '0.98.7-mh-l1.0';
  const pkg = { ...(release ? records.get('') : { name: '@sentropic/h2a-mh-l1-prototype', private: true,
    main: 'dist/index.js', bin: { h2a: 'dist/bin.js' } }), version, type: 'module',
    engines: { node: release ? '^22.22.1 || ^24.0.0' : '>=22' },
    dependencies: Object.fromEntries([...top].sort(([a], [b]) => a.localeCompare(b)).map(([name, path]) => [name, records.get(path).version])),
    bundleDependencies: [...top.keys()].sort() };
  write(join(root, 'package.json'), pkg);
  if (!release) {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/bin.js'), `#!/usr/bin/env node\nimport '../${corePath}/dist/bin.js';\n`, { mode: 0o755 });
    writeFileSync(join(root, 'dist/index.js'), `export * from '../${corePath}/dist/index.js';\n`);
  }
  // Single-mesh gate: fail the build here instead of shipping a divergent
  // image the 0.25.0 guard would refuse at runtime.
  assertSingleHoistedMesh(records);
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
    // Measured 2026-11-03: a verified successor boot costs ~7.3s on an idle
    // 32-CPU box (21k files / 396 MB re-hashed twice: once by the spawn guard,
    // once in the child before serve), leaving no margin under the old 10s
    // budget once CI contention and cold caches apply. Schema allows 60000.
    startupWaitBudgetMs: 30000, maxAttachments: 64,
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
    for (const value of Object.values(manifests)) globalThis[Symbol.for('h2a.test.closedBuildReceipt')]?.({ kind: 'image', digest: digest(value) });
  } else write(join(root, 'manifest.json'), manifest);
  globalThis[Symbol.for('h2a.test.closedBuildReceipt')]?.({ kind: 'image', digest: digest(manifest) });
  globalThis[Symbol.for('h2a.test.closedBuildReceipt')]?.({ kind: 'router',
    digest: 'sha256:' + createHash('sha256').update(readFileSync(join(root, atCore('dist/bin.js')))).digest('hex') });
  return { root, manifest, manifestDigest: digest(manifest), native, coreVersion, runtimeVersion, execution };
}
