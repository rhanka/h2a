// Explicit-file qualification from candidate sources, never installed h2a.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyExecutionReport } from './test-execution-evidence.mjs';

const repository = resolve(import.meta.dirname, '..');
const guard = 'packages/h2a/test/helpers/identity-isolation-guard.mjs';
const patterns = { h2a: /^test\/(?:[\w-]+\/)*[\w.-]+\.test\.js$/, 'agent-stats': /^tests\/(?:[\w-]+\/)*[\w.-]+\.test\.ts$/, track: /^src\/(?:[\w-]+\/)*[\w.-]+\.test\.ts$/ };

function invoke(command, options, run = spawnSync) {
  let result = run(command.command, command.args, options);
  // CI does not install the optional output filter. Preserve the same argv/cwd.
  if (command.command === 'rtk' && result.error?.code === 'ENOENT') {
    command = { ...command, command: command.args[0] === 'node' ? process.execPath : command.args[0], args: command.args.slice(1) };
    result = run(command.command, command.args, options);
  }
  return { result, command };
}

export function selectFiles(args) {
  if (args.length === 1 && args[0] === '--public-contract') return { publicContract: true, files: [] };
  const result = { package: undefined, files: [] };
  for (let i = 0; i < args.length; i += 2) {
    const [option, value] = args.slice(i, i + 2);
    if (!value || !['--package', '--file'].includes(option)) throw Error('exact --package and --file selectors required');
    if (option === '--package') {
      if (result.package) throw Error('duplicate package selector');
      result.package = value;
    } else result.files.push(value);
  }
  if (!patterns[result.package] || result.files.length === 0) throw Error('known package and nonempty exact file list required');
  if (new Set(result.files).size !== result.files.length) throw Error('duplicate file selector');
  for (const file of result.files) if (!patterns[result.package].test(file) || file.split('/').includes('..')) throw Error('invalid exact file selector: ' + file);
  return result;
}

export function createLane({ sourceRoot = repository, selection, inheritedEnv = process.env }) {
  sourceRoot = fs.realpathSync(sourceRoot);
  // Validate the public API too, before any copy, build or process launch.
  selection = selectFiles(selection.publicContract ? ['--public-contract'] : ['--package', selection.package, ...selection.files.flatMap(file => ['--file', file])]);
  const named = new Set(selection.files.map(file => `packages/${selection.package}/${file}`));
  for (const name of named) {
    const source = join(sourceRoot, name);
    if (!fs.existsSync(source)) throw Error('missing exact file: ' + name);
    if (fs.realpathSync(source) !== source || fs.lstatSync(source).isSymbolicLink()) throw Error('symlink selector: ' + name);
    if (!fs.statSync(source).isFile()) throw Error('missing regular file: ' + name);
  }
  const path = fs.mkdtempSync(join(tmpdir(), 'velocity-lane-'));
  const checkout = join(path, 'checkout');
  const privateDir = name => { const dir = join(path, name); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
  try {
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR'].filter(key => inheritedEnv[key]).map(key => [key, inheritedEnv[key]]));
    Object.assign(env, { HOME: privateDir('home'), XDG_RUNTIME_DIR: privateDir('runtime'), XDG_CONFIG_HOME: privateDir('config'),
      XDG_STATE_HOME: privateDir('state'), XDG_CACHE_HOME: privateDir('cache'), XDG_DATA_HOME: privateDir('data'), TMPDIR: privateDir('tmp'),
      H2A_ROOT: privateDir('store'), IDLOCK_LANE: path, H2A_TEST_PROC_ROOT: privateDir('proc'), H2A_BUS_DIR: privateDir('bus'),
      H2A_NATIVE_SOCKET: join(path, 'runtime', 'fixture.sock'), REMOTE_CLI_CONFIG_HOME: privateDir('config'),
      npm_config_cache: privateDir('npm-cache'), npm_config_userconfig: join(path, 'config', 'npmrc'),
      GIT_CONFIG_GLOBAL: join(path, 'config', 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', TZ: 'UTC', CI: '1',
      NODE_OPTIONS: `--import=${join(checkout, guard)}` });
    fs.mkdirSync(checkout, { mode: 0o700 });
    const hashes = [];
    const copy = name => {
      const source = join(sourceRoot, name), target = join(checkout, name);
      const info = fs.lstatSync(source);
      if (info.isSymbolicLink()) throw Error('symlink in candidate sources: ' + name);
      if (info.isDirectory()) {
        if (['node_modules', 'dist', '.git', '.track', '.h2a', 'tmp', '.tmp', '.q'].includes(basename(name))) return;
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        for (const entry of fs.readdirSync(source).sort()) copy(join(name, entry));
      } else if (info.isFile()) {
        if (name.endsWith('.tsbuildinfo') || basename(name) === '.env') return;
        if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(name) && !named.has(name)) return;
        fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        fs.copyFileSync(source, target);
        hashes.push([name, createHash('sha256').update(fs.readFileSync(target)).digest('hex')]);
      }
    };
    for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.mjs',
      'packages', 'apps', 'scripts', 'docs/contracts/golden', 'knowledge', '.github', '.claude-plugin']) if (fs.existsSync(join(sourceRoot, name))) copy(name);
    if (!fs.existsSync(join(checkout, guard))) throw Error('missing isolation guard fixture');
    // These git reads do not use or copy the owner's Git configuration.
    const { result: revision } = invoke({ command: 'rtk', args: ['git', 'rev-parse', 'HEAD'] }, { cwd: sourceRoot, env, encoding: 'utf8' });
    const sourceRevision = revision.status === 0 ? revision.stdout.trim() : 'unversioned-fixture';
    const sourceDigest = createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
    const lane = { path, checkout, selection, env, sourceRevision, sourceDigest };
    fs.writeFileSync(join(path, 'lane.json'), JSON.stringify({ sourceRoot, sourceRevision, sourceDigest, selection, environment: env }, null, 2));
    return lane;
  } catch (error) { fs.rmSync(path, { recursive: true, force: true }); throw error; }
}

export function commandPlan() { return []; }
export function checkReport() { return { passed: 0, excluded: 0 }; }
export function executeLane() { return { passed: 0, excluded: 0 }; }
