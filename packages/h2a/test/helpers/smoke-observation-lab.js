import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { EventEmitter, once } from 'node:events'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// Execute the smoke's complete orchestration. Only OS/packaged dependencies
// are simulated. Assertions below observe their effects, not source tokens.
// The expected train follows the script's pinned literal: no hard-coded
// version here, so the next `release.mjs` bump cannot desynchronize the lab.
export async function observeSmoke(source, scriptPath, options = {}) {
  const pinned = /^const PINNED_RUNTIME_VERSION = '([^']+)'$/m.exec(source)?.[1]
  assert.ok(pinned, 'the smoke must declare exactly one `const PINNED_RUNTIME_VERSION = X.Y.Z` literal')
  assert.match(pinned, /^\d+\.\d+\.\d+$/, 'the pinned literal must be a strict X.Y.Z train')
  const focusPinned = /^const PINNED_FOCUS_VERSION = '([^']+)'$/m.exec(source)?.[1]
  assert.ok(focusPinned, 'the smoke must declare exactly one `const PINNED_FOCUS_VERSION = X.Y.Z` literal')
  assert.match(focusPinned, /^\d+\.\d+\.\d+$/, 'the focus pinned literal must be a strict X.Y.Z train')
  const tarballVersion = (pkg) => pkg === '@sentropic/focus' ? focusPinned : pinned
  const root = fs.mkdtempSync(join(tmpdir(), 'smoke-observation-'))
  const observations = { packed: [], installed: [], seeded: false, faults: [], closed: false, ptys: [], pruned: false, pings: [], versions: [] }
  const children = new Map()
  const prebuilt = join(root, 'candidate-tarballs')
  if (options.prebuilt) {
    fs.mkdirSync(prebuilt)
    for (const name of ['h2a', 'h2a-runtime', 'h2a-cli', 'track']) fs.writeFileSync(join(prebuilt, `sentropic-${name}-${pinned}.tgz`), `prebuilt candidate ${name}`)
    fs.writeFileSync(join(prebuilt, `sentropic-focus-${focusPinned}.tgz`), 'prebuilt candidate focus')
  }
  const nodeRequire = createRequire(import.meta.url)
  let resolvedManifest
  let resolvedTrackManifest
  let resolvedFocusManifest
  let resolvedNestedFocusManifest = null
  let polls = 0
  const fakeProcess = { ...process, argv: ['node', scriptPath, ...(options.prebuilt ? ['--tarballs', prebuilt] : [])], execPath: process.execPath,
    env: { HOME: root, XDG_RUNTIME_DIR: root }, exit: (code) => { throw new Error(`premature exit ${code}`) } }
  const spawnSync = (command, args, spawnOptions) => {
    if (command === process.execPath && String(args[0]).endsWith("/scripts/pack-candidate.mjs")) {
      for (const name of ["h2a", "h2a-runtime", "h2a-cli", "track"]) {
        observations.packed.push("@sentropic/" + name);
        fs.writeFileSync(join(args[1], "sentropic-" + name + `-${pinned}.tgz`), name);
      }
      // The closed candidate cohort is five tarballs: the focus pack rides
      // the same producer (pack-candidate.mjs packs track/h2a-cli/focus via
      // workspaces after the two verified payloads).
      observations.packed.push("@sentropic/focus");
      fs.writeFileSync(join(args[1], `sentropic-focus-${focusPinned}.tgz`), "focus");
    } else if (command === 'npm' && args[0] === 'pack') {
      const pkg = args[2], staging = args[4]
      observations.packed.push(pkg)
      fs.writeFileSync(join(staging, pkg.replace('@', '').replace('/', '-') + `-${tarballVersion(pkg)}.tgz`), pkg)
    } else if (command === 'npm' && args[0] === 'install') {
      const prefix = args[2]
      observations.installed = args.slice(5)
      const dist = join(prefix, 'node_modules/@sentropic/h2a-runtime/dist')
      fs.mkdirSync(join(dist, 'native-terminal'), { recursive: true })
      for (const name of ['process.js', 'client.js', 'op.js']) fs.writeFileSync(join(dist, 'native-terminal', name), '')
      resolvedManifest = join(dirname(dist), 'package.json')
      fs.writeFileSync(resolvedManifest, JSON.stringify({ version: options.loadedVersion ?? pinned }))
      const trackDir = join(prefix, 'node_modules/@sentropic/track')
      fs.mkdirSync(trackDir, { recursive: true })
      resolvedTrackManifest = join(trackDir, 'package.json')
      fs.writeFileSync(resolvedTrackManifest, JSON.stringify({ version: options.loadedTrackVersion ?? pinned }))
      const focusDir = join(prefix, 'node_modules/@sentropic/focus')
      fs.mkdirSync(focusDir, { recursive: true })
      resolvedFocusManifest = join(focusDir, 'package.json')
      fs.writeFileSync(resolvedFocusManifest, JSON.stringify({ version: options.loadedFocusVersion ?? focusPinned }))
      // The installed h2a the focus gate resolves FROM: its dist entry is
      // what `require.resolve('@sentropic/h2a')` returns, and its package
      // directory anchors the createRequire focus resolution. With
      // `nestedFocusVersion` the lab reproduces the registry-fallback layout
      // (h2a's exact focus dependency served from the registry): npm nests a
      // second focus copy under h2a while the root still holds the candidate.
      const h2aDir = join(prefix, 'node_modules/@sentropic/h2a')
      fs.mkdirSync(join(h2aDir, 'dist'), { recursive: true })
      fs.writeFileSync(join(h2aDir, 'dist', 'bin.js'), '')
      fs.writeFileSync(join(h2aDir, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version: pinned }))
      if (options.nestedFocusVersion) {
        const nestedDir = join(h2aDir, 'node_modules/@sentropic/focus')
        fs.mkdirSync(nestedDir, { recursive: true })
        resolvedNestedFocusManifest = join(nestedDir, 'package.json')
        fs.writeFileSync(resolvedNestedFocusManifest, JSON.stringify({ version: options.nestedFocusVersion }))
      }
    } else if (args[0] === '-p') {
      // Emulate Node resolution from the installed h2a: a focus query issued
      // through h2a's package directory lands on the nested copy when npm
      // put one there, exactly as the production createRequire call does.
      const query = args[1] ?? ''
      // The h2a-anchored focus probe resolves focus through a require
      // anchored at the installed h2a manifest: emulate Node and land on the
      // nested copy when npm put one there, the shared candidate otherwise.
      if (query.includes('createRequire') && query.includes('@sentropic/focus')) {
        return { status: 0, stdout: resolvedNestedFocusManifest ?? resolvedFocusManifest, stderr: '' }
      }
      const target = query.includes('@sentropic/track') ? resolvedTrackManifest : resolvedManifest
      return { status: 0, stdout: target, stderr: '' }
    } else if (typeof args[0] === 'string' && args[0].endsWith('/dist/bin.js') && ['version', '--version', '-v'].includes(args[1])) {
      // Emulate the packaged binary's version probe (gate 4b): record the
      // probed word and answer with the pinned version, or with the
      // caller-supplied wrong version to prove the gate fails closed.
      observations.versions.push(args[1])
      return { status: 0, stdout: options.binVersion ?? pinned, stderr: '' }
    }
    else if (args[1] === 'host-stop') {
      const child = children.get(args[3])
      child.exitCode = 0
      queueMicrotask(() => child.emit('exit', 0))
    } else throw new Error(`unexpected command ${command} ${args}`)
    return { status: 0, stdout: '', stderr: '' }
  }
  const spawn = (command, args, options) => {
    const child = new EventEmitter()
    child.pid = 500 + children.size
    child.exitCode = null; child.signalCode = null
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.stderr.destroy = () => {
      assert.ok(observations.ptys.includes('smoke-exit'), 'stderr must close after the live session was created')
      assert.equal(polls, 0, 'stderr must close before the prune observation')
      child.stderr.destroyed = true; observations.closed = true
    }
    child.kill = () => { child.exitCode = 1; queueMicrotask(() => child.emit('exit', 1)) }
    child.generation = args[4]
    child.registry = args[6]
    children.set(args[2], child)
    if (child.generation === 'smoke-cold') {
      const row = JSON.parse(fs.readFileSync(child.registry, 'utf8')).entries[0]
      observations.seeded = row?.pgidBootId === '1f0e3d99-c948-4a67-8b11-2c5b7a9d0001' && row.pgidMachineId === 'a'.repeat(32) && row.pgidPidNamespace === '4026531836'
    }
    queueMicrotask(() => child.stdout.emit('data', 'h2a.native-terminal.ready'))
    return child
  }
  const NativeTerminalClient = { connect: async (socket) => {
    const host = children.get(socket)
    return {
      ping: async () => {
        observations.pings.push(host.generation)
        const changed = (options.changedIdentity === 'client' && host.generation === 'smoke-cold' && observations.faults.length > 0) ||
          (options.changedIdentity === 'stderr' && host.generation === 'smoke-stderr' && observations.closed)
        return { hostPid: changed ? host.pid + 1 : host.pid, generation: changed ? 'replacement-host' : host.generation }
      },
      close: () => {},
      create: async (request) => {
        observations.ptys.push(request.id)
        if (request.id === 'smoke-exit') {
          fs.writeFileSync(host.registry, JSON.stringify({ entries: [{ id: 'native-terminal-pty:smoke-exit' }] }))
        } else if (request.id !== options.omitMarker) {
          // The actual command requested from the PTY writes the marker.
          const run = new Function('require', request.args[1])
          run(nodeRequire)
        }
      },
    }
  } }
  const registryReader = {
    loadRegistry: async (path) => {
      const host = [...children.values()].find((child) => child.registry === path)
      if (polls++ > 0 && host.stderr.destroyed) {
        observations.pruned = true
        fs.writeFileSync(path, JSON.stringify({ entries: [] }))
      }
      return { state: 'ok', entries: JSON.parse(fs.readFileSync(path, 'utf8')).entries, unreadable: [] }
    },
    unreadableRowsForTarget: () => [],
  }
  const loadModule = async (url) => {
    if (url.endsWith('/client.js')) return { NativeTerminalClient }
    if (url.endsWith('/registry.js')) return registryReader
    if (url.endsWith('/protocol.js')) return { NATIVE_TERMINAL_MAX_FRAME_BYTES: 32 * 1024 * 1024 }
    if (url === 'node:fs/promises') return { readlink: async () => 'pid:[4026531836]' }
    throw new Error(`unexpected module ${url}`)
  }
  const readFileSync = (path, encoding) => {
    if (String(path).endsWith('/packages/h2a-runtime/package.json')) return JSON.stringify({ version: pinned })
    if (path === '/proc/sys/kernel/random/boot_id') return 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    if (path === '/etc/machine-id') return 'a'.repeat(32)
    return fs.readFileSync(path, encoding)
  }
  const createConnection = (socket) => {
    assert.ok(children.has(socket), 'fault must target the packaged host under test')
    const faulty = new EventEmitter()
    faulty.resume = () => {}
    faulty.write = (bytes) => {
      observations.faults.push(bytes)
      if (Buffer.byteLength(bytes) > 32 * 1024 * 1024) queueMicrotask(() => faulty.emit('close'))
    }
    queueMicrotask(() => {
      if (options.failConnect) { faulty.emit('error', new Error('fault connection refused')); faulty.emit('close') }
      else faulty.emit('connect')
    })
    return faulty
  }
  // Keep timers real enough for stream ordering, bounded and local.
  const timer = (fn, ms) => setTimeout(fn, Math.min(ms, 10))
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const code = source.replace(/^#!.*\n/, '').replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(scriptPath).href))
    .replace(/\bimport\(/g, 'loadModule(')
    .replaceAll('20_000', '200').replaceAll('30_000', '200')
  const deps = { spawn, spawnSync, createConnection, once, existsSync: (path) => path === '/etc/machine-id' || fs.existsSync(path),
    mkdirSync: fs.mkdirSync, mkdtempSync: (prefix) => fs.mkdtempSync(join(root, prefix.split('/').at(-1))),
    readFileSync, readdirSync: fs.readdirSync, rmSync: fs.rmSync, writeFileSync: fs.writeFileSync,
    tmpdir: () => root, dirname, join, resolve, fileURLToPath, pathToFileURL, createHash,
    process: fakeProcess, loadModule, setTimeout: timer, clearTimeout, console: { log: () => {} } }
  try {
    await new AsyncFunction(...Object.keys(deps), code)(...Object.values(deps))
    assert.deepEqual(observations.packed.sort(), options.prebuilt ? [] : ['@sentropic/focus', '@sentropic/h2a', '@sentropic/h2a-cli', '@sentropic/h2a-runtime', '@sentropic/track'])
    assert.equal(observations.installed.length, 5)
    for (const name of ['h2a', 'h2a-runtime', 'h2a-cli', 'track']) assert.ok(observations.installed.some((path) => path.startsWith(root + '/') && path.endsWith(`sentropic-${name}-${pinned}.tgz`)), `candidate ${name} must be installed from its local tarball`)
    assert.ok(observations.installed.some((path) => path.startsWith(root + '/') && path.endsWith(`sentropic-focus-${focusPinned}.tgz`)), 'candidate focus must be installed from its local tarball')
    if (options.prebuilt) for (const name of ['h2a', 'h2a-runtime', 'h2a-cli', 'track']) {
      const path = join(prebuilt, `sentropic-${name}-${pinned}.tgz`)
      assert.ok(observations.installed.includes(path), 'smoke must install the workflow-built bytes')
      assert.equal(fs.readFileSync(path, 'utf8'), `prebuilt candidate ${name}`, 'the provided tarballs must be preserved')
    }
    if (options.prebuilt) {
      const path = join(prebuilt, `sentropic-focus-${focusPinned}.tgz`)
      assert.ok(observations.installed.includes(path), 'smoke must install the workflow-built focus bytes')
      assert.equal(fs.readFileSync(path, 'utf8'), 'prebuilt candidate focus', 'the provided focus tarball must be preserved')
    }
    assert.equal(observations.seeded, true, 'cold-boot previous-boot row was not observed')
    assert.deepEqual(observations.faults.slice(0, 2), ['this is not a frame at all\n', '\x00\x01\x02garbage'], 'faulty client bytes were not injected')
    assert.equal(observations.faults.length, 3)
    assert.equal(observations.faults[2], 'x'.repeat(32 * 1024 * 1024 + 1), 'the destructive oversize frame was not injected')
    assert.equal(observations.closed, true, 'stderr reader was not closed')
    assert.equal(observations.pruned, true, 'post-close prune was not observed')
    assert.deepEqual(observations.versions, ['version', '--version', '-v'], 'the smoke must probe the packaged binary version/--version/-v')
    assert.deepEqual(observations.ptys, ['smoke-pty', 'smoke-pty-after-fault', 'smoke-exit', 'smoke-pty-after-stderr-fault'])
    assert.deepEqual(observations.pings, ['smoke-cold', 'smoke-cold', 'smoke-stderr', 'smoke-stderr'])
    return observations
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
