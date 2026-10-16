import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sourceBuild, environment, cliPath } from './xcli-lab.mjs';

// Native CLI parser is the oracle; no model calls or fixture parser here.
test('Codex actually discovers the MCP configured at the product descriptor path', async () => {
  const executable = cliPath('codex', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(executable, 'native Codex config oracle is mandatory; absence is a failure');
  const root = fs.mkdtempSync('/tmp/h2a-qual-');
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

test('Claude actually connects to the MCP configured at the product descriptor path', async () => {
  const executable = cliPath('claude', process.env.PATH ?? '/usr/bin:/bin');
  assert.ok(executable, 'native Claude config oracle is mandatory; absence is a failure');
  const root = fs.mkdtempSync('/tmp/h2a-qual-');
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
