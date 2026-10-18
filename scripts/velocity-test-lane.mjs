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

export function commandPlan(lane) {
  const { checkout, selection } = lane;
  const command = (args, cwd = checkout) => ({ command: 'rtk', args, cwd });
  const commands = [command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'])];
  if (selection.package === 'h2a' || selection.publicContract) {
    commands.push(command(['npm', 'run', 'build', '-w', '@sentropic/agent-stats']),
      command(['npm', 'run', 'build', '-w', '@sentropic/track']), command(['npm', 'run', 'build:h2a']));
    if (selection.publicContract) commands.push(command(['bash', 'scripts/check-public-contract.sh']));
    else commands.push(command(['node', '--import', './' + guard, '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
      '--test-reporter=./scripts/node-evidence-reporter.mjs', '--test-reporter-destination=' + join(lane.path, 'tests.json'),
      ...selection.files.map(file => 'packages/h2a/' + file)]));
  } else commands.push(command(['npx', '--no-install', 'vitest', 'run', '--config', 'vitest.config.ts', ...selection.files,
    '--reporter=default', '--reporter=json', '--outputFile=' + join(lane.path, 'tests.json')], join(checkout, 'packages', selection.package)));
  return commands;
}

export function checkReport(report, requiredFiles, declaredNonTests) {
  const failures = verifyExecutionReport(report, requiredFiles, { declaredNonTests });
  if (failures.length) throw Error('test execution failed:\n' + failures.join('\n'));
  return { passed: report.numPassedTests, excluded: report.numPendingTests + report.numTodoTests };
}

export function executeLane(lane, { run = spawnSync } = {}) {
  const steps = [];
  for (const [index, command] of commandPlan(lane).entries()) {
    const last = index === commandPlan(lane).length - 1;
    if (last && (lane.selection.package === 'h2a' || lane.selection.publicContract)) {
      for (const entry of ['agent-stats/dist/index.js', 'h2a/dist/bin.js', 'h2a-runtime/dist/index.js']) {
        if (!fs.existsSync(join(lane.checkout, 'packages', entry))) throw Error('missing checkout build: ' + entry);
      }
    }
    const { result, command: actual } = invoke(command, { cwd: command.cwd, env: lane.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, run);
    const step = { ...actual, exit: result.status, signal: result.signal ?? null };
    steps.push(step);
    fs.writeFileSync(join(lane.path, `command-${index}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
    fs.writeFileSync(join(lane.path, 'commands.json'), JSON.stringify(steps, null, 2));
    process.stdout.write(JSON.stringify(step) + '\n');
    if (result.status !== 0) {
      process.stdout.write((result.stdout ?? '') + (result.stderr ?? ''));
      throw Error(`${last ? 'test' : 'build/bootstrap'} command failed: exit ${result.status ?? result.error?.code ?? result.signal}`);
    }
  }
  if (lane.selection.publicContract) return { passed: null, excluded: 0, gate: 'public-contract' };
  const reportFile = join(lane.path, 'tests.json');
  if (!fs.existsSync(reportFile)) throw Error('missing test execution report');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const required = lane.selection.files.map(file => join(lane.checkout, 'packages', lane.selection.package, file));
  const policy = JSON.parse(fs.readFileSync(join(lane.checkout, 'scripts/test-non-tests-0986.json'), 'utf8'));
  const nonTests = policy.entries.map(entry => ({ ...entry, file: join(lane.checkout, entry.file) }));
  const counts = checkReport(report, required, nonTests);
  fs.writeFileSync(join(lane.path, 'result.json'), JSON.stringify({ ...counts, requiredFiles: required, sourceRevision: lane.sourceRevision, sourceDigest: lane.sourceDigest }));
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let lane;
  try {
    const selection = selectFiles(process.argv.slice(2));
    lane = createLane({ selection });
    process.stdout.write(`LANE=${lane.path}\nSOURCE=${lane.sourceRevision} DIGEST=${lane.sourceDigest}\n`);
    const result = executeLane(lane);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
