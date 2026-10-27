#!/usr/bin/env node
/**
 * SPEC 0.98.5 R8.3 — smoke the PACKAGED artifact before any publish.
 *
 * `verify` runs this on the exact release SHA. Until it existed, the release
 * gate tested only the WORKSPACE tree; the bytes on npm were never exercised
 * once between `npm pack` and `npm publish`. The pinned steps:
 *
 *   (1) `npm pack` the five candidate packages: the four lockstep packages
 *       (@sentropic/h2a, @sentropic/h2a-runtime, @sentropic/h2a-cli,
 *       @sentropic/track) plus @sentropic/focus at its independent version
 *       (h2a depends on the exact focus release, so a smoke that packs only
 *       the lockstep four resolves focus from the registry — ETARGET before
 *       the focus release is published, a silent registry fallback after);
 *   (2) `mkdtemp` a clean prefix;
 *   (3) install FROM the candidate tarballs — @sentropic/h2a-runtime and
 *       @sentropic/track resolved from the candidate tarballs, never from
 *       the registry (verify runs BEFORE publish, so the lockstep track
 *       X.Y.Z is never on the registry at smoke time);
 *   (4) prove the loaded path/version: `node -p
 *       "require.resolve('@sentropic/h2a-runtime/package.json')"` and
 *       `node -p "require.resolve('@sentropic/track/package.json')"` point
 *       INSIDE the prefix and the versions are exactly the pinned 0.98.6
 *       (R8.3(4) pins the literal — never "whatever the candidate is");
 *   (5) drive the PACKAGED host binary through a cold-boot (registry seeded
 *       with previous-boot rows + an empty runtime directory), the handshake
 *       (ping), a real PTY operation, and the crash-net injections
 *       (scenarios 7-8: stderr reader destroyed BEFORE the deferred prune,
 *       with the prune observed through the registry row disappearing and a
 *       PTY operation proved after EACH fault).
 *
 * The smoke fails closed: any step red => verify red => publish blocked.
 *
 * ISOLATION: every directory this script touches lives under mkdtemp'd temp
 * parents (prefix, HOME, XDG_RUNTIME_DIR, registry, sockets, PTY cwd). It
 * never reads or writes real host state, never touches a real runtime
 * directory, and only starts processes it spawned itself.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const PACKAGES = ['@sentropic/h2a', '@sentropic/h2a-runtime', '@sentropic/h2a-cli', '@sentropic/track', '@sentropic/focus']
const FOCUS_PACKAGE = '@sentropic/focus'

function fail(message) {
  throw new Error(`smoke-artifact: FAIL — ${message}`)
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  })
  if (result.error || result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} failed (status ${result.status ?? 'signal/' + result.signal}): ` +
        `${result.stderr || result.error?.message || 'no output'}`,
    )
  }
  return result.stdout
}

// ---------------------------------------------------------------------------
// (1) pack the five candidate packages
// ---------------------------------------------------------------------------
// SPEC 0.98.5 R8.3(4) pins the LITERAL: the proof is "version === 0.98.6", not
// "version === whatever this tree happens to be". Comparing to the candidate
// version would pass even when the clean prefix silently fell back to a
// previously published version in the same range — the exact hole this step
// exists to close. The focus pin closes the same hole on the independent
// focus train: h2a's exact focus dependency must resolve from the candidate
// tarball, never the registry.
const PINNED_RUNTIME_VERSION = '0.98.7'
const PINNED_FOCUS_VERSION = '0.5.0'
const runtimeVersion = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages', 'h2a-runtime', 'package.json'), 'utf8'),
).version
if (runtimeVersion !== PINNED_RUNTIME_VERSION) {
  fail(
    `the candidate tree is @sentropic/h2a-runtime@${runtimeVersion}, but the smoke proves the ${PINNED_RUNTIME_VERSION} train: ` +
      `bump the lockstep version (npm run release -- --version ${PINNED_RUNTIME_VERSION}) before tagging`,
  )
}
const focusVersion = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages', 'focus', 'package.json'), 'utf8'),
).version
if (focusVersion !== PINNED_FOCUS_VERSION) {
  fail(
    `the candidate tree is @sentropic/focus@${focusVersion}, but the smoke proves the ${PINNED_FOCUS_VERSION} train: ` +
      `publish the matching focus release before depending on it exactly`,
  )
}
const providedTarballs = process.argv[2] === '--tarballs' ? resolve(process.argv[3]) : null
if (process.argv.length > 2 && (!providedTarballs || process.argv.length !== 4)) fail('expected --tarballs <candidate directory>')
const staging = providedTarballs ?? mkdtempSync(join(tmpdir(), 'h2a-smoke-staging-'))
const prefix = mkdtempSync(join(tmpdir(), 'h2a-smoke-prefix-'))
const sandbox = mkdtempSync(join(tmpdir(), 'h2a-smoke-sandbox-'))
const ownedHosts = new Set()
const tarballName = (name) =>
  `${name.replace(/^@/, '').replace(/\//, '-')}-${name === FOCUS_PACKAGE ? focusVersion : runtimeVersion}.tgz`

try {
  const digests = new Map()
  for (const pkg of PACKAGES) {
    if (!providedTarballs) runSync('npm', ['pack', '--workspace', pkg, '--pack-destination', staging])
    const tarball = join(staging, tarballName(pkg))
    if (!existsSync(tarball)) fail(`expected candidate tarball ${tarball} was not packed`)
    digests.set(tarball, createHash('sha256').update(readFileSync(tarball)).digest('hex'))
  }

  // -------------------------------------------------------------------------
  // (2)+(3) clean prefix, install FROM the candidate tarballs
  // -------------------------------------------------------------------------
  runSync('npm', [
    'install',
    '--prefix', prefix,
    '--no-audit',
    '--no-fund',
    ...PACKAGES.map((pkg) => join(staging, tarballName(pkg))),
  ])

  // -------------------------------------------------------------------------
  // (4) prove the loaded runtime path/version from the candidate install
  // -------------------------------------------------------------------------
  const resolved = runSync(process.execPath, ['-p', "require.resolve('@sentropic/h2a-runtime/package.json')"], {
    cwd: prefix,
  }).trim()
  if (!resolve(resolved).startsWith(prefix + '/')) {
    fail(`@sentropic/h2a-runtime resolved OUTSIDE the candidate prefix: ${resolved}`)
  }
  const loadedVersion = JSON.parse(readFileSync(resolved, 'utf8')).version
  if (loadedVersion !== PINNED_RUNTIME_VERSION) {
    fail(
      `packaged runtime version is ${loadedVersion}, expected the pinned ${PINNED_RUNTIME_VERSION} ` +
        '(a registry fallback would load a previously published version — this is exactly the hole the proof closes)',
    )
  }
  console.log(`smoke-artifact: runtime resolved from the candidate prefix at version ${loadedVersion}`)
  // The same proof for @sentropic/track, against the SAME pinned literal:
  // the lockstep train ships all four packages at one version, so the track
  // proof is "version === 0.98.6", never "whatever the candidate is". Without
  // this, the prefix install falls back to the registry for track — and
  // verify runs BEFORE publish, so the lockstep track X.Y.Z is never there
  // yet (ETARGET on every lockstep release).
  const resolvedTrack = runSync(process.execPath, ['-p', "require.resolve('@sentropic/track/package.json')"], {
    cwd: prefix,
  }).trim()
  if (!resolve(resolvedTrack).startsWith(prefix + '/')) {
    fail(`@sentropic/track resolved OUTSIDE the candidate prefix: ${resolvedTrack}`)
  }
  const loadedTrackVersion = JSON.parse(readFileSync(resolvedTrack, 'utf8')).version
  if (loadedTrackVersion !== PINNED_RUNTIME_VERSION) {
    fail(
      `packaged track version is ${loadedTrackVersion}, expected the pinned ${PINNED_RUNTIME_VERSION} ` +
        '(a registry fallback would load a previously published version — this is exactly the hole the proof closes)',
    )
  }
  console.log(`smoke-artifact: track resolved from the candidate prefix at version ${loadedTrackVersion}`)
  // The same proof for @sentropic/focus, against its OWN pinned literal —
  // but resolved FROM the installed @sentropic/h2a, never from the prefix
  // root: h2a carries an exact focus dependency, so with a mutated pin npm
  // nests a REGISTRY copy under h2a's own node_modules while the root still
  // holds the candidate. A root-anchored check stays green on exactly that
  // layout and never sees what h2a loads. Resolving through h2a's package
  // directory is what h2a's own code loads; the gate then proves that copy
  // IS the candidate tarball: version === PINNED_FOCUS_VERSION and NOT a
  // nested copy. Without this, the prefix install falls back to the
  // registry for focus — and verify runs BEFORE publish, so an unpublished
  // focus X.Y.Z is never there yet (ETARGET on every focus release).
  // The installed h2a is the tarball the smoke just laid out at the top
  // level of the prefix (explicit tarball installs always land there), so
  // its manifest path is where npm put the candidate — never the registry,
  // never the workspace. Focus is then resolved THROUGH a require anchored
  // at that manifest — exactly what h2a's own code loads. (The h2a entry
  // itself is not resolved: its "." export carries no "require" condition,
  // so require.resolve('@sentropic/h2a') cannot see it — the manifest file
  // needs no export map at all.)
  const h2aPackageJson = join(prefix, 'node_modules', '@sentropic', 'h2a', 'package.json')
  if (!existsSync(h2aPackageJson)) {
    fail(`installed @sentropic/h2a is missing its manifest at ${h2aPackageJson}: the candidate tarball was not installed`)
  }
  const resolvedFocus = runSync(
    process.execPath,
    [
      '-p',
      `require('node:module').createRequire(${JSON.stringify(resolve(h2aPackageJson))}).resolve('@sentropic/focus/package.json')`,
    ],
    { cwd: prefix },
  ).trim()
  if (!resolve(resolvedFocus).startsWith(prefix + '/')) {
    fail(`@sentropic/focus resolved from the installed h2a is OUTSIDE the candidate prefix: ${resolvedFocus}`)
  }
  if (resolve(resolvedFocus).includes('/node_modules/@sentropic/h2a/node_modules/')) {
    fail(
      `packaged h2a resolves a NESTED @sentropic/focus copy at ${resolvedFocus} ` +
        '(a registry fallback for h2a\u2019s exact focus dependency — the candidate tarball was not used)',
    )
  }
  const loadedFocusVersion = JSON.parse(readFileSync(resolvedFocus, 'utf8')).version
  if (loadedFocusVersion !== PINNED_FOCUS_VERSION) {
    fail(
      `packaged focus version is ${loadedFocusVersion}, expected the pinned ${PINNED_FOCUS_VERSION} ` +
        '(a registry fallback would load a previously published version — this is exactly the hole the proof closes)',
    )
  }
  console.log(`smoke-artifact: focus resolved from the installed h2a at version ${loadedFocusVersion}`)

  // -------------------------------------------------------------------------
  // (5) drive the PACKAGED host binary
  // -------------------------------------------------------------------------
  const runtimeDist = join(prefix, 'node_modules', '@sentropic', 'h2a-runtime', 'dist')
  const hostEntry = join(runtimeDist, 'native-terminal', 'process.js')
  const clientEntry = join(runtimeDist, 'native-terminal', 'client.js')
  for (const required of [hostEntry, clientEntry]) {
    if (!existsSync(required)) fail(`packaged runtime is missing ${required}`)
  }
  const { NativeTerminalClient } = await import(pathToFileURL(clientEntry).href)
  const { NATIVE_TERMINAL_MAX_FRAME_BYTES } = await import(pathToFileURL(join(runtimeDist, 'native-terminal', 'protocol.js')).href)
  // The prune observation reads the registry through the PACKAGED reader —
  // the exact 3-state contract (valid entries / per-row unreadable /
  // whole-file unknown) the shipped CLI uses, from the very bytes under
  // test. Round-4 review finding F07: a hand-rolled read flattened that
  // contract into "entries array or nothing" and proved prunes the
  // production reader says are NOT proven.
  const registryReader = await import(pathToFileURL(join(runtimeDist, 'registry.js')).href)

  const frame = {
    bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    machineId: existsSync('/etc/machine-id')
      ? readFileSync('/etc/machine-id', 'utf8').trim()
      : undefined,
    pidNamespace: undefined,
  }
  try {
    const link = await (await import('node:fs/promises')).readlink('/proc/self/ns/pid')
    // The store-side representation is the NUMERIC INODE, not the raw magic
    // symlink: readPidNamespaceId() returns `4026531836` for
    // `pid:[4026531836]`, and R1 pins the stored pidNamespace as /^\d+$/.
    // Persisting the raw link would be malformed store data -> foreign-frame
    // -> the cold boot would be refused by the very candidate it smokes.
    const inode = /\[(\d+)\]/.exec(link)
    frame.pidNamespace = inode?.[1]
  } catch {
    frame.pidNamespace = undefined
  }
  // A valid boot-id of a DIFFERENT boot: same shape (lowercase UUID with
  // dashes, exactly the recorded format), never the current one.
  const previousBootId = '1f0e3d99-c948-4a67-8b11-2c5b7a9d0001'
  if (frame.bootId === previousBootId) fail('previous-boot fixture collides with the real boot id')

  /** Build an isolated sandbox (temp dirs only) for one packaged host run. */
  function isolatedHostLab(name) {
    const root = join(sandbox, name)
    const home = join(root, 'home')
    const runtimeDir = join(root, 'run')
    mkdirSync(join(home, '.config', 'sentropic', 'h2a'), { recursive: true, mode: 0o700 })
    mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
    const socketPath = join(runtimeDir, 'h2a-nt', 'native-terminal.sock')
    const registryPath = join(home, '.config', 'sentropic', 'h2a', 'registry.json')
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: home,
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      TERM: 'xterm-256color',
    }
    return { root, home, runtimeDir, socketPath, registryPath, env }
  }

  /** Registry seeded with previous-boot rows: the post-hard-reboot state. */
  function seedPreviousBootRows(lab, sessionId) {
    const now = new Date().toISOString()
    const row = {
      id: `native-terminal-pty:${sessionId}`,
      tool: 'claude',
      kind: 'local',
      cwd: '',
      source: 'scan',
      enrolledAt: now,
      lastSeenAt: now,
      pgid: 999999,
      ...(frame.pidNamespace ? { pgidPidNamespace: frame.pidNamespace } : {}),
      pgidBootId: previousBootId,
      ...(frame.machineId ? { pgidMachineId: frame.machineId } : {}),
      ownerHostPid: 424242,
      ownerHostStartTime: 1,
      ownerHostSocketPath: lab.socketPath,
    }
    writeFileSync(lab.registryPath, JSON.stringify({ entries: [row] }, null, 2), {
      mode: 0o600,
    })
  }

  /** Start the packaged host and wait for its ready line. */
  async function startPackagedHost(lab, generation, stdio = ['ignore', 'pipe', 'pipe']) {
    const child = spawn(
      process.execPath,
      [
        hostEntry,
        '--socket', lab.socketPath,
        '--generation', generation,
        '--registry-path', lab.registryPath,
      ],
      { env: lab.env, cwd: lab.root, stdio },
    )
    ownedHosts.add({ lab, child })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    let stdout = ''
    await new Promise((resolveStart, rejectStart) => {
      const timer = setTimeout(
        () => rejectStart(new Error(`packaged host did not become ready in 20s; stderr: ${stderr}`)),
        20_000,
      )
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        if (stdout.includes('h2a.native-terminal.ready')) {
          clearTimeout(timer)
          resolveStart()
        }
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        rejectStart(new Error(`packaged host exited before ready (code ${code}); stderr: ${stderr}`))
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        rejectStart(error)
      })
    })
    return child
  }

  async function stopPackagedHost(lab, child) {
    // host-stop goes through the packaged op.js entry — the same one the CLI
    // uses — so the smoke also proves the packaged control surface.
    runSync(process.execPath, [
      join(runtimeDist, 'native-terminal', 'op.js'),
      'host-stop',
      '--socket', lab.socketPath,
    ], { env: lab.env, cwd: lab.root })
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
    for (const host of ownedHosts) if (host.child === child) ownedHosts.delete(host)
  }

  /** Drive a real PTY operation through a client and wait for its marker file. */
  async function provePtyOperation(lab, client, sessionId) {
    const marker = join(lab.root, `${sessionId}-marker.txt`)
    await client.create({
      id: sessionId,
      command: process.execPath,
      args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`],
      cwd: lab.root,
      env: { PATH: '/usr/bin:/bin', HOME: lab.home },
      cols: 80,
      rows: 24,
    })
    const deadline = Date.now() + 20_000
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    if (!existsSync(marker)) {
      fail(`the PTY operation ${sessionId} never ran (marker file absent)`)
    }
  }

  /**
   * Wait until the durable row of a session has been pruned from the registry.
   * The deferred prune is the exact site of the crash-loop incident (host.js
   * timer -> log line), so scenario 7 must OBSERVE that it ran, not just wait
   * a fixed delay. The observation is TWO-PHASE: the row must first be seen
   * PRESENT, then seen GONE. Round-3 review finding N03: polling only for
   * absence let an ALREADY-EMPTY registry "prove" a prune the instant it was
   * read — a prune of a row that never existed is not evidence that the
   * deferred prune (and its write into the destroyed stream) ever ran.
   *
   * The observation goes THROUGH THE PACKAGED REGISTRY READER (`readers`, the
   * packaged registry module wired above) — never a hand-rolled JSON.parse of
   * the file. Round-4 review finding F07 (G03/G04): a hand-rolled read
   * flattened the reader's 3-state contract into "entries array or nothing",
   * so a row whose id became invalid while its label still identified the
   * session (an UNREADABLE row to the production reader, registry.ts
   * `unreadableRowsForTarget`) and a registry REBUILT from corrupt bytes
   * (state `unknown` to the production reader, `rebuiltFromCorruptAt`) both
   * resolved the wait — announcing a prune the readers say is NOT proven. The
   * control inherits the reader's validation and unknown states before
   * claiming a disappearance: only state `ok` whose VALID rows lack the
   * session id AND whose UNREADABLE rows cannot still be this session under
   * the reader's own identity rules proves the prune.
   */
  async function waitForPrune(lab, sessionId, readers) {
    const rowId = `native-terminal-pty:${sessionId}`
    const deadline = Date.now() + 30_000
    let observedPresent = false
    while (Date.now() < deadline) {
      let present = null
      try {
        const read = await readers.loadRegistry(lab.registryPath)
        if (read !== null && typeof read === 'object' && read.state === 'ok') {
          // PRESENT if a valid row carries the session id, OR an unreadable
          // row could still BE this session under the reader's identity rules
          // (id / label / tmux candidates) — an unreadable row that matches
          // the target is never evidence of absence.
          present =
            read.entries.some((row) => row.id === rowId) ||
            readers.unreadableRowsForTarget(rowId, read.unreadable).length > 0
        }
        // state "unknown" (unparsable, invalid shape, rebuilt from corrupt
        // bytes, ...) observes NOTHING: unknown is not empty, in either phase.
      } catch {
        // A reader failure observes nothing either: unknown, never empty.
      }
      if (present !== null) {
        if (!observedPresent) {
          if (present) observedPresent = true
        } else if (!present) {
          return
        }
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    fail(
      observedPresent
        ? `the durable row ${rowId} was never pruned: the deferred prune did not run, so scenario 7 exercised no write-after-close`
        : `the durable row ${rowId} was never observed PRESENT: no prune was proved — an already-empty registry is not evidence that the deferred prune ran`,
    )
  }

  // --- cold-boot: start over previous-boot rows with an empty runtime dir ---
  const cold = isolatedHostLab('cold')
  seedPreviousBootRows(cold, 'smoke-cold-boot')
  if (readdirSync(cold.runtimeDir).length !== 0) fail('cold runtime directory must be empty')
  const seeded = JSON.parse(readFileSync(cold.registryPath, 'utf8')).entries
  if (seeded.length !== 1 || seeded[0].pgidBootId !== previousBootId || seeded[0].pgidMachineId !== frame.machineId || !frame.machineId || !frame.pidNamespace) fail('cold-boot seed is absent or unattributed')
  const coldHost = await startPackagedHost(cold, 'smoke-cold')
  console.log('smoke-artifact: packaged host started over previous-boot rows (cold-boot)')

  // --- handshake ---
  const goodClient = await NativeTerminalClient.connect(cold.socketPath)
  const ping = await goodClient.ping()
  console.log(`smoke-artifact: handshake ok (generation ${ping.generation})`)

  // --- PTY operation: a real process runs under the packaged host ---
  const marker = join(cold.root, 'pty-marker.txt')
  await goodClient.create({
    id: 'smoke-pty',
    command: process.execPath,
    args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`],
    cwd: cold.root,
    env: { PATH: '/usr/bin:/bin', HOME: cold.home },
    cols: 80,
    rows: 24,
  })
  const markerDeadline = Date.now() + 20_000
  while (!existsSync(marker) && Date.now() < markerDeadline) {
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!existsSync(marker)) fail('the packaged PTY never ran the command (marker file absent)')
  console.log('smoke-artifact: PTY operation ok (command output observed)')

  // --- crash-net injection, scenario 8: a faulty client connection must be
  // --- isolated; the good client and the PTY keep working.
  await new Promise((resolveFault, rejectFault) => {
    const faulty = createConnection(cold.socketPath)
    faulty.resume()
    let connected = false
    const timeout = setTimeout(() => rejectFault(new Error('faulty connection was not destroyed')), 5_000)
    faulty.on('error', (error) => { if (!connected) { clearTimeout(timeout); rejectFault(error) } })
    faulty.on('close', () => {
      clearTimeout(timeout)
      if (!connected) rejectFault(new Error('fault connection closed before connect'))
      else resolveFault()
    })
    // Malformed JSON gets an error response while preserving the connection.
    // A frame over the packaged protocol's limit must destroy this peer only.
    faulty.once('connect', () => {
      connected = true
      faulty.write('this is not a frame at all\n')
      faulty.write('\x00\x01\x02garbage')
      faulty.write('x'.repeat(NATIVE_TERMINAL_MAX_FRAME_BYTES + 1))
    })
  })
  await new Promise((r) => setTimeout(r, 500))
  const afterFault = await goodClient.ping()
  if (afterFault.hostPid !== ping.hostPid || afterFault.generation !== ping.generation) fail('host identity changed after client fault')
  // PTY operation AFTER the fault: a ping proves the connection; only a real
  // PTY proves the sessions. The review's gap: ping-only after the fault.
  await provePtyOperation(cold, goodClient, 'smoke-pty-after-fault')
  console.log('smoke-artifact: faulty client isolated; connection and PTYs keep working')

  await stopPackagedHost(cold, coldHost)
  goodClient.close()

  // --- crash-net injection, scenario 7: the host must survive its stderr
  // --- reader disappearing, and the deferred prune must OBSERVEDLY happen
  // --- AFTER the close. The review's defect: the reader died 2s after a
  // --- prune that ran at delay zero, so no write-after-close was exercised.
  // --- Order here: session alive -> reader destroyed -> session exits ->
  // --- deferred prune logs into the dead stream.
  const stderrLab = isolatedHostLab('stderr')
  const stderrHost = await startPackagedHost(stderrLab, 'smoke-stderr')
  const stderrClient = await NativeTerminalClient.connect(stderrLab.socketPath)
  await stderrClient.create({
    id: 'smoke-exit',
    command: process.execPath,
    // Deliberately still alive while the reader dies, so the prune (and its
    // log line) cannot have happened before the close.
    args: ['-e', 'setTimeout(() => process.exit(0), 4000)'],
    cwd: stderrLab.root,
    env: { PATH: '/usr/bin:/bin', HOME: stderrLab.home },
    cols: 80,
    rows: 24,
  })
  const beforeStderr = await stderrClient.ping()
  // Give the host a moment to register the session, then close its log reader.
  await new Promise((r) => setTimeout(r, 500))
  stderrHost.stderr.destroy()
  if (!stderrHost.stderr.destroyed) fail('stderr reader did not close')
  await waitForPrune(stderrLab, 'smoke-exit', registryReader)
  if (stderrHost.exitCode !== null || stderrHost.signalCode !== null) {
    fail('the packaged host died when its stderr reader disappeared (scenario 7)')
  }
  const survivalClient = await NativeTerminalClient.connect(stderrLab.socketPath)
  const afterStderr = await survivalClient.ping()
  if (afterStderr.hostPid !== beforeStderr.hostPid || afterStderr.generation !== beforeStderr.generation || afterStderr.hostPid !== stderrHost.pid) fail('host identity changed after stderr fault')
  // PTY operation AFTER the fault: a ping proves the connection; only a real
  // PTY proves the sessions still serve through the dead-log host.
  await provePtyOperation(stderrLab, survivalClient, 'smoke-pty-after-stderr-fault')
  console.log('smoke-artifact: host survived its stderr reader disappearing, prune observed after the close (scenario 7)')
  survivalClient.close()
  stderrClient.close()
  await stopPackagedHost(stderrLab, stderrHost)

  for (const [tarball, digest] of digests) {
    if (createHash('sha256').update(readFileSync(tarball)).digest('hex') !== digest) fail('candidate bytes changed during smoke')
  }
  console.log('smoke-artifact: PASS — packaged candidate proved on cold-boot, handshake, PTY, and crash-net injections')
} finally {
  for (const { lab, child } of ownedHosts) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        runSync(process.execPath, [join(prefix, 'node_modules/@sentropic/h2a-runtime/dist/native-terminal/op.js'), 'host-stop', '--socket', lab.socketPath], { env: lab.env, cwd: lab.root })
      } catch { child.kill('SIGTERM') }
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((done) => {
          const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 5_000)
          child.once('exit', () => { clearTimeout(timer); done() })
        })
      }
    }
  }
  // Only paths this script created, all under mkdtemp'd temp parents.
  for (const path of [...(providedTarballs ? [] : [staging]), prefix, sandbox]) {
    rmSync(path, { recursive: true, force: true })
  }
}
