import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';
import { H2A_CODEX_HOST, H2A_CLAUDE_HOST } from '../dist/index.js';

// Interim direct Vibe MCP entry (owner 16/10, derogation spec-astra-v9 O7.2).
// Isolated HOME copies only; never the owner's real ~/.vibe.
function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'vibe-mcp-direct-'));
  const runtime = join(dir, 'runtime');
  fs.mkdirSync(runtime);
  const previous = { ...process.env };
  process.env.HOME = dir;
  process.env.VIBE_HOME = join(dir, 'vibe home');
  process.env.XDG_RUNTIME_DIR = runtime;
  fs.mkdirSync(process.env.VIBE_HOME);
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, vibe: process.env.VIBE_HOME };
}

function cli(args, cwd) {
  let out = '', err = '';
  const code = runCli(args, { cwd: () => cwd, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } });
  return { code, out, err, json: () => JSON.parse(out) };
}

const FULL_ARGS = ['mcp-serve', '--auto-open', '--host', 'vibe', '--auto-upgrade', '--wake', 'auto'];

test('setup --write installs the interim direct h2a entry with host-parity args', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, 'mcp_servers = []\n');
  const first = cli(['host', 'setup', '--host', 'vibe', '--write', target], dir);
  assert.equal(first.code, 0, first.err);
  const body = fs.readFileSync(target, 'utf8');
  assert.match(body, /\[\[mcp_servers\]\]/);
  assert.match(body, /name = "h2a"/);
  assert.match(body, /command = "h2a"/);
  assert.doesNotMatch(body, /mcp_servers = \[\]/);
  const parsed = first.json();
  assert.equal(parsed.migration, 'voie directe — non migrée');
  // Args identical in meaning to the other hosts' entries.
  const codex = H2A_CODEX_HOST.renderMcpConfig({ args: ['mcp-serve', '--auto-open', '--host', 'codex', '--auto-upgrade', '--wake', 'auto'] });
  assert.deepEqual(codex.config.mcpServers.h2a.args.slice(0, 2), ['mcp-serve', '--auto-open']);
  const claude = H2A_CLAUDE_HOST.renderMcpConfig({ args: [...FULL_ARGS.slice(0, 3), 'claude', ...FULL_ARGS.slice(4)] });
  assert.equal(claude.config.mcpServers.h2a.command, 'h2a');
  assert.ok(body.includes('--auto-open') && body.includes('--host') && body.includes('vibe') && body.includes('--auto-upgrade') && body.includes('--wake'));
});

test('setup --write is idempotent and backs up the previous config', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, '# operator comment\nmcp_servers = []\n');
  assert.equal(cli(['host', 'setup', '--host', 'vibe', '--write', target], dir).code, 0);
  const backups = fs.readdirSync(join(vibe, '.h2a-install', 'backups'));
  assert.equal(backups.length, 1);
  const afterFirst = fs.readFileSync(target, 'utf8');
  const mtime = fs.statSync(target).mtimeMs;
  const second = cli(['host', 'setup', '--host', 'vibe', '--write', target], dir);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.json().merged, false);
  assert.equal(fs.readFileSync(target, 'utf8'), afterFirst);
  assert.equal(fs.statSync(target).mtimeMs, mtime);
  assert.equal(fs.readdirSync(join(vibe, '.h2a-install', 'backups')).length, 1);
  assert.match(afterFirst, /# operator comment/);
});

test('setup --write preserves user entries and consolidates h2a duplicates', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target,
    '[[mcp_servers]]\nname="other"\ncommand="other-bin"\nargs=["serve"]\n' +
    '[[mcp_servers]]\nname="h2a-old"\ncommand="h2a"\nargs=["mcp-serve"]\n' +
    '[[mcp_servers]]\nname="h2a"\ncommand="h2a"\nargs=["mcp-serve"]\n');
  const result = cli(['host', 'setup', '--host', 'vibe', '--write', target], dir);
  assert.equal(result.code, 0, result.err);
  const body = fs.readFileSync(target, 'utf8');
  assert.match(body, /name="other"|name = "other"/);
  assert.equal(body.match(/name = "h2a"/g)?.length ?? body.match(/name="h2a"/g)?.length ?? 0, 1);
  assert.doesNotMatch(body, /h2a-old/);
});

test('setup --write refuses invalid TOML even with --force, and JSON targets', t => {
  const { dir, vibe } = fixture(t);
  const bad = join(vibe, 'config.toml');
  fs.writeFileSync(bad, '[[mcp_servers]\nname = \n');
  assert.notEqual(cli(['host', 'setup', '--host', 'vibe', '--write', bad, '--force'], dir).code, 0);
  assert.equal(fs.readFileSync(bad, 'utf8'), '[[mcp_servers]\nname = \n');
  const inline = join(vibe, 'inline.toml');
  fs.writeFileSync(inline, 'mcp_servers = [{name="h2a", command="h2a"}]\n');
  assert.notEqual(cli(['host', 'setup', '--host', 'vibe', '--write', inline], dir).code, 0);
  const json = join(dir, 'mcp.json');
  assert.notEqual(cli(['host', 'setup', '--host', 'vibe', '--write', json, '--force'], dir).code, 0);
  assert.equal(fs.existsSync(json), false);
});

test('setup --remove clears the direct entry for registry migration and preserves others', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target,
    '[[mcp_servers]]\nname = "other"\ncommand = "other-bin"\nargs = ["serve"]\n' +
    '[[mcp_servers]]\nname = "h2a"\ncommand = "h2a"\nargs = ["mcp-serve"]\n');
  const removed = cli(['host', 'setup', '--host', 'vibe', '--remove', '--write', target], dir);
  assert.equal(removed.code, 0, removed.err);
  assert.equal(removed.json().removed, true);
  const body = fs.readFileSync(target, 'utf8');
  assert.doesNotMatch(body, /"h2a"/);
  assert.match(body, /"other"/);
  const again = cli(['host', 'setup', '--host', 'vibe', '--remove', '--write', target], dir);
  assert.equal(again.code, 0);
  assert.equal(again.json().removed, false);
});

test('doctor --repair installs the direct entry and status reports the non-migrated way', t => {
  const { dir, vibe } = fixture(t);
  fs.writeFileSync(join(vibe, 'config.toml'), 'mcp_servers = []\n');
  cli(['init', '--root', join(dir, 'bus')], dir);
  const before = cli(['host', 'status', '--host', 'vibe'], dir);
  assert.match(before.out, /bootstrap registre attendu/);
  const repaired = cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe', '--repair'], dir);
  assert.equal(repaired.code, 0, repaired.err);
  const body = fs.readFileSync(join(vibe, 'config.toml'), 'utf8');
  assert.match(body, /\[\[mcp_servers\]\]/);
  assert.match(body, /"h2a"/);
  const after = cli(['host', 'status', '--host', 'vibe'], dir);
  assert.match(after.out, /voie directe — non migrée/);
  assert.doesNotMatch(after.out, /Skills installées, outils MCP absents/);
});
