// Qualification infrastructure only. No installed h2a code or ambient state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir, userInfo } from 'node:os';

function userInfoHomedir() {
  const info = userInfo();
  assert.ok(info && typeof info.homedir === 'string' && info.homedir.startsWith('/'), 'owner home unavailable');
  return info.homedir;
}
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const CLIS = Object.freeze(['claude', 'codex', 'agy', 'gemini', 'muse', 'vibe']);

// R15 (class-c): the exact launch flags the harness passes each CLI before
// the prompt, single-sourced. qualify-cross-cli.mjs launches from this map;
// the seat preflight re-verifies them against `<cli> --help` (no login), so
// a version drift that drops a flag fails closed as preflight-args-unproven
// instead of an unexplained cli-exited-before-ready.
export const PINNED_CLI_ARGS = Object.freeze({
  claude: Object.freeze([]),
  codex: Object.freeze(['--no-daemon', '--no-alt-screen']),
  agy: Object.freeze(['--prompt-interactive']),
  gemini: Object.freeze(['--prompt-interactive']),
  muse: Object.freeze(['--no-session-log']),
  vibe: Object.freeze([]),
});

// Lot L11 (SPEC v3 §7.1): single-sourced tier-C oracle table. Families with
// kind 'npm'/'uv' are installed pinned by xcli-install-oracles.mjs and must
// answer their config oracle with no login. Families with kind 'none' have
// no installable no-login parse path: muse ships as a channel-tracked
// launcher with no version pin (installing it would track latest), and agy
// has no published install recipe (binary provenance unknown). 'none' is a
// tested verdict, never a silent gap: the receipt still records the real
// binary version + digest the campaign lane measured.
export const ORACLE_SOURCES = Object.freeze({
  codex: Object.freeze({ kind: 'npm', package: '@openai/codex', bin: 'codex', pin: '0.162.1' }),
  claude: Object.freeze({ kind: 'npm', package: '@anthropic-ai/claude-code', bin: 'claude', pin: '2.1.301',
    bootstrapSha256: '32a7b2429d7447c5aa043e383bcf9a72e0b233dff66336ea4b5b32531da981ad' }),
  vibe: Object.freeze({ kind: 'uv', tool: 'mistral-vibe', pin: '2.26.1' }),
  muse: Object.freeze({ kind: 'none',
    reason: 'channel-tracked launcher without a version pin; login-adjacent' }),
  agy: Object.freeze({ kind: 'none', reason: 'no published install recipe; binary provenance unknown' }),
});
export const PROBE = 'H2A_XCLI_PROBE_20261015';
export const REPLY = 'H2A_XCLI_REPLY_20261015';
export const repo = resolve(import.meta.dirname, '..');

// Lot L4 evidence hygiene: every retained MCP/terminal record shares one
// envelope. REPLAY_TRANSCRIPT_BODY names the live transcript field; the
// transcript is the JSON of the evidence-shaped detail, truncated so a runaway
// line can never bloat retained evidence. Secret-shaped keys are stripped
// from the retained detail; bodies and envelopes stay only where the recorded
// tests demand them (probe/reply matching), never secret material.
export const REPLAY_TRANSCRIPT_BODY = 'transcript';
export const TRANSCRIPT_RETAIN_LIMIT = 32768;
const SECRET_KEY_PATTERN = /(secret|passwd|password|token|credential|private[_-]?key|oauth|session[_-]?key|api[_-]?key)/i;
export function stripSecretFields(value) {
  if (Array.isArray(value)) return value.map(stripSecretFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, stripSecretFields(entry)]));
  }
  return value;
}
export function canonicalEventRecord(at, event, detail) {
  assert.ok(Number.isSafeInteger(at) && typeof event === 'string' && event.length > 0, 'canonical record needs time and name');
  assert.ok(detail && typeof detail === 'object' && !Array.isArray(detail), 'canonical record needs an evidence-shaped detail');
  const clean = stripSecretFields(detail);
  const transcript = JSON.stringify(clean);
  return { at, event, [REPLAY_TRANSCRIPT_BODY]: transcript.slice(0, TRANSCRIPT_RETAIN_LIMIT) };
}
// Inverse of the canonical envelope for readers: rehydrate the evidence-shaped
// flat fields from the transcript so consumers keep their established access.
// Non-canonical lines (older files, worker-pushed memory events) pass through.
export function rehydrateEventRecord(record) {
  if (record && typeof record[REPLAY_TRANSCRIPT_BODY] === 'string') {
    try { return { ...JSON.parse(record[REPLAY_TRANSCRIPT_BODY]), at: record.at, event: record.event }; }
    catch { return record; }
  }
  return record;
}

export function inside(root, path) {
  const rel = relative(root, resolve(path));
  assert.ok(rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')), 'path outside private qualification');
  return path;
}

export function environment(root, bin = join(root, 'bin')) {
  const env = {
    PATH: `${bin}:/usr/bin:/bin`, TERM: 'xterm-256color', LANG: 'C.UTF-8',
    HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home/.config'),
    XDG_STATE_HOME: join(root, 'state'), XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'), XDG_RUNTIME_DIR: join(root, 'run'),
    TMPDIR: join(root, 'tmp'), TMUX_TMPDIR: join(root, 'run'),
    REMOTE_CLI_CONFIG_HOME: join(root, 'home'), H2A_ROOT: join(root, 'store'),
    H2A_NATIVE_SOCKET: join(root, 'host.sock'), H2A_SESSION_HOST: 'native',
    H2A_UPGRADE_REEXECED: '1', DISABLE_AUTOUPDATER: '1', MUSE_NO_AUTO_UPDATE: '1',
    CLAUDE_CONFIG_DIR: join(root, 'home/.claude'), CODEX_HOME: join(root, 'home/.codex'),
    VIBE_HOME: join(root, 'home/.vibe'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CEILING_DIRECTORIES: root,
  };
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
    'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'VIBE_HOME']) {
    fs.mkdirSync(inside(root, env[key]), { recursive: true, mode: 0o700 });
  }
  fs.mkdirSync(inside(root, bin), { recursive: true, mode: 0o700 });
  // setup-node lives outside /usr/bin on GitHub runners. Keep PATH private
  // while allowing CLI shebangs to use this exact selected Node executable.
  const node = join(bin, 'node');
  if (fs.existsSync(node)) {
    assert.ok(fs.lstatSync(node).isSymbolicLink() && fs.readlinkSync(node) === process.execPath, 'unexpected private Node shim');
  } else fs.symlinkSync(process.execPath, node);
  return env;
}

// Campaign and worker roots are passed as H2A_TEST_QUALIFICATION_ROOT to
// processes importing packages/h2a/test/helpers/native-isolation.js, whose
// admission guard on main only accepts /tmp/h2a-qual-* (forbidden by the
// owner no-/tmp rule) or $HOME/.cache-tmp/h2a-test/run-*. A plain mkdtemp
// root under TMPDIR is refused at import, so every such root goes through
// here: a fresh 0700 run-* directory under the admitted base.
export function compliantQualificationRoot() {
  // homedir() follows an overridden HOME (test fixtures scrub it to a
  // private dir). The guard compares against the owner home, like
  // native-isolation.js does with os.userInfo().
  let ownerHome = null;
  try { ownerHome = userInfoHomedir(); } catch { ownerHome = null; }
  const base = join(ownerHome ?? homedir(), '.cache-tmp', 'h2a-test');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(join(base, 'run-'));
  fs.chmodSync(root, 0o700);
  return root;
}

// Test-called campaign parents mint an admitted sibling root that outlives
// the test's own dir by design (receipt/resume live there until the caller
// removes it). Every test that spawns a parent without --campaign-root must
// remove the exact root the parent reported — a surprising path is never
// deleted, and the main guard is never widened.
export function removeCampaignRoot(reported) {
  assert.ok(typeof reported === 'string' && reported.length > 0, 'parent reports its campaign root');
  assert.ok(/^\/home\/[^/]+\/\.cache-tmp\/h2a-test\/run-[A-Za-z0-9]+$/.test(reported),
    `campaign root outside the admitted base: ${reported}`);
  fs.rmSync(reported, { recursive: true, force: true });
}

export function removeReportedCampaignRoot(stdout) {
  const reported = (String(stdout).match(/Private qualification root: (\S+)/) ?? [])[1];
  assert.ok(reported, `parent reports its campaign root\n${stdout}`);
  return removeCampaignRoot(reported);
}

// Node headers for the direct node-pty build (no node-gyp/Python). The
// pre-provisioned XCLI_NODE_HEADERS wins; otherwise fetch the matching
// public headers once via xcli-node-headers.mjs (setup-node ships no
// /usr/include/node). A provisioning failure keeps the system-headers
// fallback with a warning — the g++ step then fails closed on its own.
let cachedNodeHeaders = null;
export function resolveNodeHeaders() {
  if (process.env.XCLI_NODE_HEADERS) return process.env.XCLI_NODE_HEADERS;
  if (cachedNodeHeaders) return cachedNodeHeaders;
  const provisioned = spawnSync(process.execPath, [join(repo, 'scripts/xcli-node-headers.mjs')],
    { encoding: 'utf8', timeout: 120000 });
  const line = String(provisioned.stdout ?? '').split('\n').find((candidate) => candidate.startsWith('XCLI_NODE_HEADERS='));
  if (provisioned.status === 0 && line) {
    cachedNodeHeaders = line.slice('XCLI_NODE_HEADERS='.length).trim();
    return cachedNodeHeaders;
  }
  console.warn('xcli: node headers not provisioned, falling back to /usr/include/node');
  return '/usr/include/node';
}

export function sourceBuild(root) {
  const require = createRequire(join(repo, 'package.json'));
  const ts = require('typescript');
  const dest = join(root, 'build');
  // A resumed campaign reuses its root: rebuild from scratch so a resume
  // after new commits can never run a stale build.
  fs.rmSync(dest, { recursive: true, force: true });
  const sourceHash = createHash('sha256');
  const packages = ['h2a', 'h2a-runtime', 'track', 'remote-protocol', 'focus'];
  for (const pkg of packages) {
    const from = join(repo, 'packages', pkg), to = join(dest, 'packages', pkg);
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(join(from, 'package.json'), join(to, 'package.json'));
    function compile(dir, sub = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = join(sub, entry.name), src = join(dir, entry.name);
        if (entry.isDirectory()) { compile(src, rel); continue; }
        if (entry.name.endsWith('.d.ts')) continue;
        const out = join(to, 'dist', rel.replace(/\.ts$/, '.js'));
        fs.mkdirSync(dirname(out), { recursive: true });
        const bytes = fs.readFileSync(src);
        sourceHash.update(`${pkg}/${rel}\0`).update(bytes).update('\0');
        fs.writeFileSync(out, entry.name.endsWith('.ts') ? ts.transpileModule(bytes.toString(), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText : bytes);
      }
    }
    compile(join(from, 'src'));
    for (const name of ['schema', 'fixtures', 'schemas', 'registry']) {
      if (fs.existsSync(join(from, name))) fs.cpSync(join(from, name), join(to, name), { recursive: true });
    }
  }
  fs.cpSync(join(repo, 'packages/h2a/test/helpers'), join(dest, 'packages/h2a/test/helpers'), { recursive: true });
  const modules = join(dest, 'node_modules');
  fs.mkdirSync(join(modules, '@sentropic'), { recursive: true });
  for (const entry of fs.readdirSync(join(repo, 'node_modules'))) {
    if (entry === '@sentropic' || entry === 'node-pty') continue;
    fs.symlinkSync(join(repo, 'node_modules', entry), join(modules, entry));
  }
  for (const entry of fs.readdirSync(join(repo, 'node_modules/@sentropic'))) {
    fs.symlinkSync(packages.includes(entry) ? join(dest, 'packages', entry) :
      join(repo, 'node_modules/@sentropic', entry), join(modules, '@sentropic', entry));
  }
  for (const pkg of packages) {
    const nested = join(repo, 'packages', pkg, 'node_modules');
    if (!fs.existsSync(nested)) continue;
    const target = join(dest, 'packages', pkg, 'node_modules');
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(nested)) {
      if (name.startsWith('@')) {
        fs.mkdirSync(join(target, name), { recursive: true });
        for (const entry of fs.readdirSync(join(nested, name))) {
          if (name === '@sentropic' && packages.includes(entry)) continue;
          fs.symlinkSync(join(nested, name, entry), join(target, name, entry));
        }
      } else fs.symlinkSync(join(nested, name), join(target, name));
    }
  }
  // node-pty on Linux normally invokes node-gyp/Python. Compile its unchanged
  // N-API source directly in this disposable build; never run install scripts.
  const pty = join(modules, 'node-pty');
  fs.cpSync(join(repo, 'node_modules/node-pty'), pty, { recursive: true });
  const native = join(pty, 'build/Release');
  fs.mkdirSync(native, { recursive: true });
  const command = ['/usr/bin/g++', '-std=c++17', '-shared', '-fPIC', '-O2', '-pthread',
    '-DNAPI_CPP_EXCEPTIONS', `-I${resolveNodeHeaders()}`, `-I${join(repo, 'node_modules/node-addon-api')}`,
    join(pty, 'src/unix/pty.cc'), '-o', join(native, 'pty.node'), '-lutil'];
  const result = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'compiler')), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, 'private node-pty compilation failed (requires Linux, g++, Node headers)');
  return { path: dest, sourceDigest: sourceHash.digest('hex'), nativeBuild: { command, exitCode: result.status } };
}

// These are the documented auth-only files, not the product's broad remote
// auth bundle: hooks, plugins, commands and MCP settings must never be copied.
// Sources are opened through descriptor-relative, no-symlink walks; only
// regular files in the explicit family allowlist cross into the private
// HOME. Mapped bytes are 0600. The caller witnesses the mapping
// (role, allowlisted name, sha256 — never content) in the row evidence.
// LOGIN_ROLES is declared after LOGIN_ALLOWLIST below (derived keys).
// Shared home for the login allowlist (Lot L5): the worker records copies
// against it, the parent re-wipes a lost worker cell against it.
export const LOGIN_ALLOWLIST = Object.freeze({
  codex: Object.freeze(['.codex/auth.json']),
  claude: Object.freeze(['.claude/.credentials.json', '.claude.json']),
  muse: Object.freeze(['.config/muse/auth.json']),
  vibe: Object.freeze([]),
});
const LOGIN_ROLES = Object.freeze(Object.keys(LOGIN_ALLOWLIST));
// Absolute destination of an allowlisted login copy inside a role env.
export function loginCopyPath(env, cli, name) {
  assert.ok(LOGIN_ROLES.includes(cli), `login-not-confined:${cli}`);
  if (cli === 'claude') return join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME, '.claude'),
    name === '.claude.json' ? '.claude.json' : '.credentials.json');
  return join(env.HOME, name);
}
// Lot L5 secret wipe: absolute secret-bearing paths inside a cell: recorded
// login copies or, when the worker never reported, the allowlisted candidates
// for both login roles, plus harness transcript files. Content is never read.
export function cellSecretPaths(cell, copies) {
  const paths = [];
  for (const role of ['sender', 'receiver']) {
    const dir = join(cell, role);
    const env = { HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'home/.config') };
    const recorded = copies?.[role];
    if (recorded) {
      for (const name of recorded.files ?? []) paths.push(loginCopyPath(env, recorded.cli, name));
    } else {
      for (const cli of LOGIN_ROLES) for (const name of LOGIN_ALLOWLIST[cli]) paths.push(loginCopyPath(env, cli, name));
    }
    // Transcripts can occur anywhere under HOME/XDG, not just at login paths.
    paths.push(...['home', 'state', 'cache', 'data', 'run', 'tmp', 'workspace', 'events.jsonl'].map(name => join(dir, name)));
  }
  paths.push(join(cell, 'wake-lines'), join(cell, 'exec-trace'));
  return paths;
}
// Remove every path and re-check absence file by file. Returns the surviving
// paths (empty means the wipe is proven). Callers list survivors by name only.
export function wipeSecrets(paths) {
  const surviving = [];
  for (const path of paths) {
    try { fs.rmSync(path, { recursive: true, force: true }); } catch { /* the re-check below decides */ }
    if (fs.existsSync(path)) surviving.push(path);
  }
  return surviving;
}
// Lot L7 (QO4, section 8.2): the vendor vibe product may run as installed,
// vendor Python runtime included. Its entrypoint is recorded, never blocked.
// A future non-Python backend surfaces as a non-python label here: adopting
// it is a follow-up change, never a silent swap.
export function vendorRuntimeLabel(cli, path) {
  if (cli !== 'vibe') return null;
  try { fs.accessSync(path, fs.constants.R_OK); } catch { return null; }
  return pythonEntrypoint(path) ? 'python (not shipped)' : 'non-python (upstream follow-up)';
}

// R15 (class-c): the copy report names every skipped allowlisted file with
// its reason. A missing source used to copy silently: the cell then failed
// with authentication-required and nothing said which file was absent.
export function copyLoginReport(cli, authHome, target, env) {
  const copied = [];
  const skipped = [];
  if (!authHome) return { copied, skipped };
  assert.ok(LOGIN_ROLES.includes(cli), `login-not-confined:${cli}`);
  if (LOGIN_ALLOWLIST[cli].length === 0) {
    skipped.push({ file: '(allowlist-empty)', reason: `no-allowlisted-login-files:${cli}` });
    return { copied, skipped };
  }
  for (const name of LOGIN_ALLOWLIST[cli]) {
    let fd = null;
    try { fd = openLoginFile(authHome, name); }
    catch (error) {
      if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) {
        skipped.push({ file: name, reason: `login-source-${error.code.toLowerCase()}` });
        continue;
      }
      throw error;
    }
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile()) { skipped.push({ file: name, reason: 'login-source-not-regular' }); continue; }
      const out = loginCopyPath(env, cli, name);
      inside(target, out);
      let bytes = fs.readFileSync(fd);
      if (cli === 'claude' && name === '.claude.json') {
        const source = JSON.parse(bytes.toString('utf8'));
        bytes = JSON.stringify({ oauthAccount: source.oauthAccount,
          hasCompletedOnboarding: source.hasCompletedOnboarding === true,
          lastOnboardingVersion: /^\d+\.\d+\.\d+$/.test(source.lastOnboardingVersion ?? '') ? source.lastOnboardingVersion : undefined });
      }
      const destination = openLoginFile(target, relative(target, out), true);
      try {
        assert.ok(fs.fstatSync(destination).isFile(), 'login destination must be regular');
        fs.writeFileSync(destination, bytes); fs.fchmodSync(destination, 0o600);
      } finally { fs.closeSync(destination); }
      copied.push(name);
    } finally { if (fd !== null) fs.closeSync(fd); }
  }
  return { copied, skipped };
}

export function copyLogin(cli, authHome, target, env) {
  return copyLoginReport(cli, authHome, target, env).copied;
}

// Descriptor-relative walk: O_NOFOLLOW protects EVERY component, even if
// an ancestor is concurrently renamed. Other platforms fail closed.
function openLoginFile(authHome, name, write = false) {
  assert.equal(process.platform, 'linux', 'login descriptor confinement requires Linux');
  assert.ok(!name.split('/').includes('..'), 'invalid login path');
  const parts = resolve(authHome, name).split('/').filter(Boolean);
  let directory = fs.openSync('/', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    for (const part of parts.slice(0, -1)) {
      const path = `/proc/self/fd/${directory}/${part}`;
      if (write) {
        try { fs.mkdirSync(path, { mode: 0o700 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const next = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(directory); directory = next;
    }
    return fs.openSync(`/proc/self/fd/${directory}/${parts.at(-1)}`,
      (write ? fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL : fs.constants.O_RDONLY) |
      fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  } finally { fs.closeSync(directory); }
}

export function cliPath(cli, path) {
  assert.ok(CLIS.includes(cli));
  for (const dir of path.split(':')) {
    if (!dir) continue;
    const candidate = join(dir, cli);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next explicit PATH entry */ }
  }
  return undefined;
}

// Muse's launcher resolves its cache beside itself, independently of HOME.
// Even with updates disabled it consumes an installation-side notice on a TTY.
// Copy only program files and release metadata; never copy that mutable state.
export function privateExecutable(cli, executable, root) {
  if (cli !== 'muse') return { path: executable };
  const install = dirname(executable);
  const versionFile = join(install, '.muse-version');
  assert.ok(fs.lstatSync(versionFile).isFile() && !fs.lstatSync(versionFile).isSymbolicLink(), 'Muse version must be a regular program metadata file');
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+-R\d+(?:\.\d+)?$/, 'unknown installed Muse version layout');
  const binaryName = `muse-bin-${version}`;
  const sourceBinary = join(install, binaryName);
  assert.ok(fs.lstatSync(sourceBinary).isFile() && !fs.lstatSync(sourceBinary).isSymbolicLink(), 'Muse binary must be a regular program file');
  const dest = inside(root, join(root, 'muse-program'));
  fs.mkdirSync(dest, { mode: 0o700 });
  const hashes = {};
  for (const [from, name] of [[executable, 'muse'], [sourceBinary, binaryName]]) {
    const to = inside(root, join(dest, name));
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o700);
    const bytes = fs.readFileSync(to);
    if (name === binaryName) assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', 'Muse runtime must be a native ELF, never a Python entrypoint');
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  fs.writeFileSync(join(dest, '.muse-version'), version + '\n', { mode: 0o600 });
  const release = join(install, '.muse-release-info.json');
  try {
    assert.ok(fs.lstatSync(release).isFile() && !fs.lstatSync(release).isSymbolicLink(), 'Muse release metadata must be a regular file');
    fs.copyFileSync(release, join(dest, '.muse-release-info.json'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { path: join(dest, 'muse'), version, hashes };
}

// Lot L6 (§8.3): entrypoint guard aimed at our launch chain. Reads file
// text only, never executes. Recognises versioned interpreters (python,
// python3, python3.14, micro versions), env forms including -S, absolute
// interpreter paths, and one-level shell wrappers that exec a Python
// interpreter (closed patterns over the launcher text).
export function pythonEntrypoint(path) {
  let text = '';
  try {
    const fd = fs.openSync(path, 'r');
    try {
      const buf = Buffer.alloc(4096);
      text = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return false; }
  if (isPythonInterpreterPath(shebangInterpreter(text))) return true;
  return isPythonWrapper(text);
}
export function isPythonInterpreterPath(path) {
  if (typeof path !== 'string' || !path) return false;
  return /^python(\d+(\.\d+){0,2})?$/.test(path.split('/').pop());
}
function shebangInterpreter(text) {
  const first = text.split('\n', 1)[0] ?? '';
  if (!first.startsWith('#!')) return '';
  const tokens = first.slice(2).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  let rest = tokens;
  if (rest[0] === '/usr/bin/env' || rest[0] === 'env') {
    // env forms take options (-S, -u…) and VAR=val assignments before the
    // interpreter: skipping only dash-options leaves an assignment in the
    // interpreter slot and the guard misses the Python behind it.
    rest = rest.slice(1)
      .filter(token => !token.startsWith('-') || /^-\d/.test(token))
      .filter(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  }
  return rest[0] ?? '';
}
function isPythonWrapper(text) {
  const lines = text.split('\n');
  if (!/^#!\s*\/bin\/(ba)?sh\b/.test(lines[0] ?? '') && !/^#!\s*\/usr\/bin\/env\s+(ba)?sh\b/.test(lines[0] ?? '')) return false;
  // VAR=val assignments may precede the interpreter with or without env
  // (exec FOO=bar python3, exec env FOO=bar python3 -u): skip them so the
  // guard sees the interpreter behind them, never the assignment.
  const assignment = String.raw`(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S+)\s+)*`;
  return lines.slice(1).some(line =>
    new RegExp(String.raw`(^|[;&|]\s*|\bexec\s+)${assignment}(python(\d+(\.\d+){0,2})?|\/[\w./~+-]*python(\d+(\.\d+){0,2})?|((?:\/[\w./~+-]*env|env\b)\s+)?${assignment}(-S\s+)?${assignment}python(\d+(\.\d+){0,2})?)\b`).test(line));
}
// Explicit instrumentation is useful for direct-worker diagnostics, but
// proves no descendant observation. The parent replaces this partial view
// with the kernel exec events from xcli-process-supervisor before publishing.
export function recordExec(journalPath, entry) {
  assert.ok(entry && Number.isSafeInteger(entry.pid) && typeof entry.path === 'string' && entry.path.length > 0, 'exec record needs a pid and a path');
  assert.ok(entry.tag === 'harness' || entry.tag === 'vendor', 'exec record needs a chain tag');
  let resolved = entry.path;
  try { resolved = fs.realpathSync(entry.path); } catch { /* record the given path */ }
  fs.mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(journalPath, JSON.stringify({ at: Date.now(), pid: entry.pid, path: resolved, tag: entry.tag }) + '\n', { mode: 0o600 });
}
export function readExecJournal(journalPath) {
  try {
    return fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export function classifyExecJournal(records) {
  const pythonDescendants = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.tag !== 'harness') continue;
    if (isPythonInterpreterPath(record.path)) { pythonDescendants.push(record.path); continue; }
    try { if (pythonEntrypoint(record.path)) pythonDescendants.push(record.path); } catch { /* gone temp path: basename check above stands */ }
  }
  return { observed: Array.isArray(records) ? records.length : 0,
    pythonDescendants, scope: 'explicit-records-only; no descendant-observation' };
}

export function classify(row) {
  if (row.blocker) return 'blocked';
  return ['senderMcp', 'receiverMcp', 'sent', 'delivered', 'received', 'woke', 'replied', 'replyDelivered']
    .every(key => row[key] === true) ? 'measured-OK' : 'measured-KO';
}

export function matrix(cells) {
  assert.equal(cells.length, 36, 'qualification must account for all 36 ordered pairs');
  const keys = new Set(cells.map(c => `${c.sender}>${c.receiver}`));
  assert.equal(keys.size, 36, 'duplicate cell');
  const rows = CLIS.map(sender => `| ${sender} | ${CLIS.map(receiver => {
    const c = cells.find(r => r.sender === sender && r.receiver === receiver);
    assert.ok(c, 'missing ordered pair');
    return `[${c.status}](#${sender}-${receiver})`;
  }).join(' | ')} |`);
  return ['| Émetteur → destinataire | ' + CLIS.join(' | ') + ' |',
    '|---|' + CLIS.map(() => '---|').join(''), ...rows].join('\n');
}
