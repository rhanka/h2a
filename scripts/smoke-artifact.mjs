#!/usr/bin/env node
/**
 * SPEC 0.98.5 R8.3 — smoke the PACKAGED artifact before any publish.
 *
 * `verify` runs this on the exact release SHA. Until it existed, the release
 * gate tested only the WORKSPACE tree; the bytes on npm were never exercised
 * once between `npm pack` and `npm publish`. The pinned steps:
 *
 *   (1) `npm pack` the three lockstep packages of the candidate
 *       (@sentropic/h2a, @sentropic/h2a-runtime, @sentropic/h2a-cli);
 *   (2) `mkdtemp` a clean prefix;
 *   (3) install FROM the candidate tarballs — @sentropic/h2a-runtime resolved
 *       from the candidate tarball, never from the registry;
 *   (4) prove the loaded path/version: `node -p
 *       "require.resolve('@sentropic/h2a-runtime/package.json')"` points
 *       INSIDE the prefix and the version is exactly the pinned 0.98.5
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
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const PACKAGES = ['@sentropic/h2a', '@sentropic/h2a-runtime', '@sentropic/h2a-cli']

function fail(message) {
  console.error(`smoke-artifact: FAIL — ${message}`)
  process.exit(1)
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
// (1) pack the three lockstep packages of the candidate
// ---------------------------------------------------------------------------
// SPEC 0.98.5 R8.3(4) pins the LITERAL: the proof is "version === 0.98.5", not
// "version === whatever this tree happens to be". Comparing to the candidate
// version would pass even when the clean prefix silently fell back to a
// previously published version in the same range — the exact hole this step
// exists to close.
const PINNED_RUNTIME_VERSION = '0.98.5'
const staging = mkdtempSync(join(tmpdir(), 'h2a-smoke-staging-'))
const prefix = mkdtempSync(join(tmpdir(), 'h2a-smoke-prefix-'))
const sandbox = mkdtempSync(join(tmpdir(), 'h2a-smoke-sandbox-'))
const runtimeVersion = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages', 'h2a-runtime', 'package.json'), 'utf8'),
).version
if (runtimeVersion !== PINNED_RUNTIME_VERSION) {
  fail(
    `the candidate tree is @sentropic/h2a-runtime@${runtimeVersion}, but the smoke proves the 0.98.5 train: ` +
      `bump the lockstep version (npm run release -- --version ${PINNED_RUNTIME_VERSION}) before tagging`,
  )
}
const tarballName = (name) =>
  `${name.replace(/^@/, '').replace(/\//, '-')}-${runtimeVersion}.tgz`

try {
  for (const pkg of PACKAGES) {
    runSync('npm', ['pack', '--workspace', pkg, '--pack-destination', staging])
    const tarball = join(staging, tarballName(pkg))
    if (!existsSync(tarball)) fail(`expected candidate tarball ${tarball} was not packed`)
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
  if (!resolve(resolved).startsWith(prefix)) {
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
    await once(child, 'exit').catch(() => {})
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
   */
  async function waitForPrune(lab, sessionId) {
    const rowId = `native-terminal-pty:${sessionId}`
    const deadline = Date.now() + 30_000
    let observedPresent = false
    while (Date.now() < deadline) {
      let rows = null
      try {
        const registry = JSON.parse(readFileSync(lab.registryPath, 'utf8'))
        rows = Array.isArray(registry.entries) ? registry.entries : []
      } catch {
        // The registry is rewritten atomically; a torn read is transient.
      }
      if (rows !== null) {
        const present = rows.some((row) => row.id === rowId)
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
    const faulty = createConnection(cold.socketPath, () => resolveFault())
    faulty.on('error', rejectFault)
    // Invalid framing: not JSON, not a legal frame. The host must destroy THIS
    // connection only (server confinement), never the listeners or sessions.
    faulty.write('this is not a frame at all\n')
    faulty.write('\x00\x01\x02garbage')
  })
  await new Promise((r) => setTimeout(r, 500))
  await goodClient.ping()
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
  // Give the host a moment to register the session, then close its log reader.
  await new Promise((r) => setTimeout(r, 500))
  stderrHost.stderr.destroy()
  await waitForPrune(stderrLab, 'smoke-exit')
  if (stderrHost.exitCode !== null || stderrHost.signalCode !== null) {
    fail('the packaged host died when its stderr reader disappeared (scenario 7)')
  }
  const survivalClient = await NativeTerminalClient.connect(stderrLab.socketPath)
  await survivalClient.ping()
  // PTY operation AFTER the fault: a ping proves the connection; only a real
  // PTY proves the sessions still serve through the dead-log host.
  await provePtyOperation(stderrLab, survivalClient, 'smoke-pty-after-stderr-fault')
  console.log('smoke-artifact: host survived its stderr reader disappearing, prune observed after the close (scenario 7)')
  survivalClient.close()
  stderrClient.close()
  await stopPackagedHost(stderrLab, stderrHost)

  console.log('smoke-artifact: PASS — packaged candidate proved on cold-boot, handshake, PTY, and crash-net injections')
} finally {
  // Only paths this script created, all under mkdtemp'd temp parents.
  for (const path of [staging, prefix, sandbox]) {
    rmSync(path, { recursive: true, force: true })
  }
}
