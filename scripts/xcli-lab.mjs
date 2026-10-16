// Qualification infrastructure only. No installed h2a code or ambient state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const CLIS = Object.freeze(['claude', 'codex', 'agy', 'gemini', 'muse', 'vibe']);
export const PROBE = 'H2A_XCLI_PROBE_20261015';
export const REPLY = 'H2A_XCLI_REPLY_20261015';
export const repo = resolve(import.meta.dirname, '..');

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
    H2A_UPGRADE_REEXECED: '1', DISABLE_AUTOUPDATER: '1',
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

export function sourceBuild(root) {
  const require = createRequire(join(repo, 'package.json'));
  const ts = require('typescript');
  const dest = join(root, 'build');
  const sourceHash = createHash('sha256');
  const packages = ['h2a', 'h2a-runtime', 'track', 'remote-protocol'];
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
    for (const name of ['schema', 'fixtures']) {
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
    '-DNAPI_CPP_EXCEPTIONS', `-I${process.env.XCLI_NODE_HEADERS ?? '/usr/include/node'}`, `-I${join(repo, 'node_modules/node-addon-api')}`,
    join(pty, 'src/unix/pty.cc'), '-o', join(native, 'pty.node'), '-lutil'];
  const result = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'compiler')), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, 'private node-pty compilation failed (requires Linux, g++, Node headers)');
  return { path: dest, sourceDigest: sourceHash.digest('hex'), nativeBuild: { command, exitCode: result.status } };
}

// These are the documented auth-only files, not the product's broad remote
// auth bundle: hooks, plugins, commands and MCP settings must never be copied.
const authFiles = {
  claude: ['.claude/.credentials.json'], codex: ['.codex/auth.json'],
  agy: ['.gemini/oauth_creds.json', '.gemini/google_accounts.json'],
  gemini: ['.gemini/oauth_creds.json', '.gemini/google_accounts.json'],
  muse: ['.config/muse/auth.json'], vibe: [],
};
export function copyLogin(cli, authHome, target, env) {
  const copied = [];
  if (!authHome) return copied;
  for (const name of authFiles[cli]) {
    const src = join(authHome, name);
    // No recursive traversal or symlink to an owner's configuration tree.
    let info;
    try { info = fs.lstatSync(src); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isFile() || info.isSymbolicLink()) continue;
    const out = cli === 'muse' ? join(env.XDG_CONFIG_HOME, 'muse/auth.json') : join(env.HOME, name);
    inside(target, out);
    fs.mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, out);
    fs.chmodSync(out, 0o600);
    copied.push(name);
  }
  if (cli === 'claude') {
    try {
      const source = JSON.parse(fs.readFileSync(join(authHome, '.claude.json'), 'utf8'));
      const login = {};
      if (source.oauthAccount && typeof source.oauthAccount === 'object') login.oauthAccount = source.oauthAccount;
      if (typeof source.hasCompletedOnboarding === 'boolean') login.hasCompletedOnboarding = source.hasCompletedOnboarding;
      if (typeof source.lastOnboardingVersion === 'string' && /^\d+\.\d+\.\d+$/.test(source.lastOnboardingVersion)) login.lastOnboardingVersion = source.lastOnboardingVersion;
      if (Object.keys(login).length) {
        fs.writeFileSync(inside(target, join(env.CLAUDE_CONFIG_DIR, '.claude.json')), JSON.stringify(login), { mode: 0o600 });
        copied.push('.claude.json:login-metadata-only');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return copied;
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

export function pythonEntrypoint(path) {
  const fd = fs.openSync(path, 'r');
  try {
    const buf = Buffer.alloc(256);
    fs.readSync(fd, buf, 0, buf.length, 0);
    return /^#![^\n]*\bpython\d*(?:\s|$)/i.test(buf.toString());
  } finally { fs.closeSync(fd); }
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
