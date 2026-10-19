import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sourceBuild, environment, cliPath, ORACLE_SOURCES } from './xcli-lab.mjs';

// Lot L11: tier-C covers every family with an installable no-login parse
// path. Pinned families must state their install source; the rest must state
// a reason — never a silent gap.
test('every seated family declares a tier-C oracle source or a reason', () => {
  assert.deepEqual(Object.keys(ORACLE_SOURCES).sort(), ['agy', 'claude', 'codex', 'muse', 'vibe']);
  for (const [family, source] of Object.entries(ORACLE_SOURCES)) {
    assert.ok(['npm', 'uv', 'none'].includes(source.kind), `${family} oracle kind`);
    if (source.kind === 'none') {
      assert.ok(source.reason.length > 0, `${family} documents why no oracle installs it`);
    } else {
      assert.match(source.pin, /^\d+\.\d+\.\d+$/, `${family} oracle is pinned`);
    }
  }
  assert.equal(ORACLE_SOURCES.vibe.pin, '2.26.1', 'vibe stays on its reviewed pin');
});

// Native CLI parser is the oracle; no model calls or fixture parser here.
test('Codex actually discovers the MCP configured at the product descriptor path', async () => {
  const executable = cliPath('codex', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(executable, 'native Codex config oracle is mandatory; absence is a failure');
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-qual-'));
  try {
    const build = sourceBuild(root);
    const env = environment(join(root, 'oracle'));
    const { H2A_CODEX_HOST } = await import(pathToFileURL(join(build.path, 'packages/h2a/dist/index.js')));
    const snippet = H2A_CODEX_HOST.renderMcpConfig({ command: process.execPath,
      args: [join(build.path, 'packages/h2a/dist/bin.js'), 'mcp-serve'], root: env.H2A_ROOT });
    const path = snippet.path.example.replace(/^~/, env.HOME);
    fs.mkdirSync(dirname(path), { recursive: true });
    const endpoint = snippet.config.mcpServers.h2a;
    fs.writeFileSync(path, path.endsWith('.toml') ?
      `[mcp_servers.h2a]\ncommand = ${JSON.stringify(endpoint.command)}\nargs = ${JSON.stringify(endpoint.args)}\n` : JSON.stringify(snippet.config));
    const result = spawnSync(executable, ['mcp', 'list', '--json'], { cwd: root, env,
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, 'native Codex config inspection must exit successfully');
    const entries = JSON.parse(result.stdout);
    assert.ok(entries.some(e => e.name === 'h2a'), 'native Codex ignores the configuration written at the product descriptor path');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Vibe actually accepts the MCP configured at the product descriptor path', async () => {
  const executable = cliPath('vibe', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(executable, 'native Vibe config oracle is mandatory; absence is a failure');
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-qual-'));
  try {
    const build = sourceBuild(root);
    const env = environment(join(root, 'oracle'));
    const { H2A_VIBE_HOST } = await import(pathToFileURL(join(build.path, 'packages/h2a/dist/index.js')));
    const snippet = H2A_VIBE_HOST.renderMcpConfig({ command: process.execPath,
      args: [join(build.path, 'packages/h2a/dist/bin.js'), 'mcp-serve'] });
    assert.equal(snippet.path.example, '~/.vibe/config.toml');
    const path = join(env.VIBE_HOME, 'config.toml');
    fs.mkdirSync(dirname(path), { recursive: true });
    const endpoint = snippet.config.mcpServers.h2a;
    fs.writeFileSync(path, '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\n' +
      `command = ${JSON.stringify(endpoint.command)}\nargs = ${JSON.stringify(endpoint.args)}\n`);
    assert.ok(fs.readFileSync(path, 'utf8').includes('name = "h2a"'), 'oracle writes the h2a entry first');
    // The real binary parses the h2a-written TOML and acts on the h2a server:
    // removing it exits 0 and leaves exactly that entry gone.
    const result = spawnSync(executable, ['mcp', 'remove', 'h2a'], { cwd: root, env,
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, `native Vibe must parse the h2a-written config (output: ${(result.stdout + result.stderr).slice(0, 300)})`);
    const after = fs.readFileSync(path, 'utf8');
    assert.ok(!after.includes('"h2a"'), 'native Vibe acted on the h2a entry: it removed exactly that server');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Claude actually connects to the MCP configured at the product descriptor path', async () => {
  const executable = cliPath('claude', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(executable, 'native Claude config oracle is mandatory; absence is a failure');
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-qual-'));
  try {
    const build = sourceBuild(root);
    const env = environment(join(root, 'oracle'));
    const { H2A_CLAUDE_HOST } = await import(pathToFileURL(join(build.path, 'packages/h2a/dist/index.js')));
    const snippet = H2A_CLAUDE_HOST.renderMcpConfig({ command: process.execPath,
      args: [join(build.path, 'packages/h2a/dist/bin.js'), 'mcp-serve'], root: env.H2A_ROOT });
    const path = snippet.path.example === '~/.claude.json' ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') :
      snippet.path.example.replace(/^~/, env.HOME);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify(snippet.config));
    const result = spawnSync(executable, ['mcp', 'list'], { cwd: root, env,
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, 'native Claude config inspection must exit successfully');
    assert.ok(/h2a:/.test(result.stdout) && /Connected/.test(result.stdout),
      'native Claude ignores the MCP written at the product descriptor path');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
