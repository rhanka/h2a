// Compile this checkout into a private consumer; never load an installed h2a.
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const repo = resolve(import.meta.dirname, '../../../..');
const ts = createRequire(join(repo, 'package.json'))('typescript');
const lane = fs.mkdtempSync(join(tmpdir(), 'h2a-host-build-'));
const npmCli = (process.env.PATH ?? '').split(':').map(p => join(p, 'npm')).find(p => fs.existsSync(p));
const root = join(lane, 'candidate');
const files = process.argv.slice(2);
if (!files.length || files.some(f => !/^packages\/h2a\/test\/[\w-]+\.test\.js$/.test(f)))
  throw new Error('explicit named h2a test files required');
for (const name of ['home', 'runtime', 'config', 'state', 'tmp', 'bin']) fs.mkdirSync(join(lane, name), { mode: 0o700 });
fs.symlinkSync(process.execPath, join(lane, 'bin/node'));
for (const pkg of ['h2a', 'h2a-runtime', 'track', 'remote-protocol']) {
  const from = join(repo, 'packages', pkg), dest = join(root, 'packages', pkg);
  fs.cpSync(from, dest, { recursive: true, filter: p => !/\/(node_modules|dist)(\/|$)/.test(p) });
  const compile = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) compile(path);
      else if (!path.endsWith('.d.ts')) {
        const out = path.replace('/src/', '/dist/').replace(/\.ts$/, '.js');
        fs.mkdirSync(resolve(out, '..'), { recursive: true });
        const raw = fs.readFileSync(path, 'utf8');
        fs.writeFileSync(out, path.endsWith('.ts') ? ts.transpileModule(raw, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
        }).outputText : raw);
      }
    }
  };
  compile(join(dest, 'src'));
}
fs.cpSync(join(repo, 'scripts'), join(root, 'scripts'), { recursive: true });
fs.copyFileSync(join(repo, 'package.json'), join(root, 'package.json'));
fs.mkdirSync(join(root, 'node_modules', '@sentropic'), { recursive: true });
for (const name of fs.readdirSync(join(repo, 'node_modules'))) {
  if (name !== '@sentropic') fs.symlinkSync(join(repo, 'node_modules', name), join(root, 'node_modules', name));
}
for (const name of fs.readdirSync(join(repo, 'node_modules', '@sentropic'))) {
  const own = ['h2a', 'h2a-runtime', 'track', 'remote-protocol'].includes(name);
  fs.symlinkSync(own ? join(root, 'packages', name) : join(repo, 'node_modules', '@sentropic', name), join(root, 'node_modules', '@sentropic', name));
}
const env = { ...process.env, HOME: join(lane, 'home'), TMPDIR: join(lane, 'tmp'),
  PATH: join(lane, 'bin'),
  HOST_TEST_NPM_CLI: npmCli ? fs.realpathSync(npmCli) : '',
  npm_config_cache: join(lane, 'npm-cache'), npm_config_userconfig: join(lane, 'npmrc'),
  XDG_RUNTIME_DIR: join(lane, 'runtime'), XDG_CONFIG_HOME: join(lane, 'config'),
  XDG_STATE_HOME: join(lane, 'state'), H2A_ROOT: join(lane, 'state', 'bus'), IDLOCK_LANE: lane,
  VIBE_HOME: '', CLAUDE_CONFIG_DIR: '', CODEX_HOME: '',
  NODE_OPTIONS: '--import ' + join(repo, 'packages/h2a/test/helpers/identity-isolation-guard.mjs') };
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
fs.writeFileSync(join(lane, 'tests.tap'), result.stdout + result.stderr);
process.stdout.write(`LANE=${lane}\n${result.stdout}${result.stderr}`);
process.exitCode = result.status ?? 1;
