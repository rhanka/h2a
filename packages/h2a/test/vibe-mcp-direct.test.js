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

function vibeHostReport(result) {
  const hosts = result.json().checks?.nativeHostInstallations?.hosts;
  assert.ok(Array.isArray(hosts) && hosts.length === 1, `expected one vibe host report: ${result.out}`);
  return hosts[0];
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
  // Mistral Vibe validates mcp_servers against a discriminated union on
  // `transport` (vibe/core/config/models.py: MCPServer): without it vibe
  // crashes at startup with union_tag_not_found.
  assert.match(body, /transport = "stdio"/);
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
  assert.match(afterFirst, /transport = "stdio"/);
  const mtime = fs.statSync(target).mtimeMs;
  const second = cli(['host', 'setup', '--host', 'vibe', '--write', target], dir);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.json().merged, false);
  assert.equal(fs.readFileSync(target, 'utf8'), afterFirst);
  assert.equal(fs.statSync(target).mtimeMs, mtime);
  assert.equal(fs.readdirSync(join(vibe, '.h2a-install', 'backups')).length, 1);
  assert.match(afterFirst, /# operator comment/);
});

test('setup --write preserves user entries and converges degraded h2a duplicates to canonical', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target,
    '[[mcp_servers]]\nname="other"\ncommand="other-bin"\nargs=["serve"]\n' +
    '[[mcp_servers]]\nname="h2a-old"\ncommand="h2a"\nargs=["mcp-serve"]\n' +
    '[[mcp_servers]]\nname="h2a"\ncommand="h2a"\nargs=["broken"]\n');
  const result = cli(['host', 'setup', '--host', 'vibe', '--write', target], dir);
  assert.equal(result.code, 0, result.err);
  const body = fs.readFileSync(target, 'utf8');
  assert.match(body, /name="other"|name = "other"/);
  assert.equal(body.match(/name = "h2a"/g)?.length ?? body.match(/name="h2a"/g)?.length ?? 0, 1);
  assert.doesNotMatch(body, /h2a-old/);
  assert.doesNotMatch(body, /"broken"/);
  assert.match(body, /transport = "stdio"/);
  assert.ok(body.includes('--auto-open') && body.includes('--host') && body.includes('vibe'));
});

test('setup --write refuses invalid TOML even with --force (code 2), and JSON targets (code 1)', t => {
  const { dir, vibe } = fixture(t);
  const bad = join(vibe, 'config.toml');
  fs.writeFileSync(bad, '[[mcp_servers]\nname = \n');
  const refused = cli(['host', 'setup', '--host', 'vibe', '--write', bad, '--force'], dir);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /refused|invalid|incompatible/);
  assert.equal(fs.readFileSync(bad, 'utf8'), '[[mcp_servers]\nname = \n');
  const inline = join(vibe, 'inline.toml');
  fs.writeFileSync(inline, 'mcp_servers = [{name="h2a", command="h2a"}]\n');
  const inlineRefused = cli(['host', 'setup', '--host', 'vibe', '--write', inline], dir);
  assert.equal(inlineRefused.code, 2, inlineRefused.out + inlineRefused.err);
  const json = join(dir, 'mcp.json');
  const jsonRefused = cli(['host', 'setup', '--host', 'vibe', '--write', json, '--force'], dir);
  assert.equal(jsonRefused.code, 1, jsonRefused.out + jsonRefused.err);
  assert.equal(fs.existsSync(json), false);
});

test('setup --remove clears the direct entry for registry migration and refuses non-TOML targets', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target,
    '[[mcp_servers]]\nname = "other"\ncommand = "other-bin"\nargs = ["serve"]\n' +
    '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\ncommand = "h2a"\nargs = ["mcp-serve"]\n');
  const removed = cli(['host', 'setup', '--host', 'vibe', '--remove', '--write', target], dir);
  assert.equal(removed.code, 0, removed.err);
  assert.equal(removed.json().removed, true);
  const body = fs.readFileSync(target, 'utf8');
  assert.doesNotMatch(body, /"h2a"/);
  assert.match(body, /"other"/);
  const again = cli(['host', 'setup', '--host', 'vibe', '--remove', '--write', target], dir);
  assert.equal(again.code, 0);
  assert.equal(again.json().removed, false);
  const json = join(dir, 'mcp.json');
  const jsonRefused = cli(['host', 'setup', '--host', 'vibe', '--remove', '--write', json], dir);
  assert.equal(jsonRefused.code, 1, jsonRefused.out + jsonRefused.err);
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
  assert.match(body, /transport = "stdio"/);
  const after = cli(['host', 'status', '--host', 'vibe'], dir);
  assert.match(after.out, /voie directe — non migrée/);
  assert.doesNotMatch(after.out, /Skills installées, outils MCP absents/);
});

test('bare --write and --remove without a path resolve to <VIBE_HOME>/config.toml', t => {
  const { dir, vibe } = fixture(t);
  fs.writeFileSync(join(vibe, 'config.toml'), 'mcp_servers = []\n');
  const written = cli(['host', 'setup', '--host', 'vibe', '--write'], dir);
  assert.equal(written.code, 0, written.err);
  assert.equal(written.json().path, join(vibe, 'config.toml'));
  assert.match(fs.readFileSync(join(vibe, 'config.toml'), 'utf8'), /transport = "stdio"/);
  const removed = cli(['host', 'setup', '--host', 'vibe', '--remove'], dir);
  assert.equal(removed.code, 0, removed.err);
  assert.equal(removed.json().removed, true);
  assert.doesNotMatch(fs.readFileSync(join(vibe, 'config.toml'), 'utf8'), /"h2a"/);
});

test('doctor reports MCP drift as action necessary without writing, then repair writes once with fresh observation', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, 'mcp_servers = []\n');
  cli(['init', '--root', join(dir, 'bus')], dir);
  const readonly = cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe'], dir);
  assert.equal(readonly.code, 0, readonly.err);
  const drifted = vibeHostReport(readonly);
  assert.equal(drifted.installation, 'action necessary');
  assert.equal(drifted.mcp.planned, true);
  assert.equal(drifted.mcp.changed, false);
  assert.equal(drifted.mcp.path, target);
  assert.ok(drifted.planned.includes(target), `expected drift in planned: ${JSON.stringify(drifted.planned)}`);
  assert.equal(drifted.migration, 'non migré — bootstrap registre attendu');
  assert.equal(drifted.observation.mcpAvailable, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'mcp_servers = []\n');
  const repaired = cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe', '--repair'], dir);
  assert.equal(repaired.code, 0, repaired.err);
  const fixed = vibeHostReport(repaired);
  assert.equal(fixed.mcp.planned, true);
  assert.equal(fixed.mcp.changed, true);
  assert.ok(fixed.changed.includes(target), `expected write in changed: ${JSON.stringify(fixed.changed)}`);
  assert.equal(fixed.installation, 'coherent');
  assert.equal(fixed.migration, 'voie directe — non migrée');
  assert.equal(fixed.observation.mcpAvailable, true);
  assert.match(fs.readFileSync(target, 'utf8'), /transport = "stdio"/);
  const settled = vibeHostReport(cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe'], dir));
  assert.equal(settled.installation, 'coherent');
  assert.equal(settled.mcp.planned, false);
  assert.equal(settled.mcp.changed, false);
});

test('doctor --repair converges a degraded h2a entry to the canonical transport and args', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, '[[mcp_servers]]\nname = "h2a"\ncommand = "h2a"\nargs = ["broken"]\n');
  cli(['init', '--root', join(dir, 'bus')], dir);
  const repaired = cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe', '--repair'], dir);
  assert.equal(repaired.code, 0, repaired.err);
  const body = fs.readFileSync(target, 'utf8');
  assert.match(body, /transport = "stdio"/);
  assert.doesNotMatch(body, /"broken"/);
  assert.ok(body.includes('--auto-open') && body.includes('--host') && body.includes('vibe'));
  assert.equal(vibeHostReport(repaired).mcp.changed, true);
});

test('--remove persists across doctor --repair and install-skills until an explicit --write', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, 'mcp_servers = []\n');
  cli(['init', '--root', join(dir, 'bus')], dir);
  assert.equal(cli(['host', 'setup', '--host', 'vibe', '--write'], dir).code, 0);
  assert.match(fs.readFileSync(target, 'utf8'), /"h2a"/);
  const removed = cli(['host', 'setup', '--host', 'vibe', '--remove'], dir);
  assert.equal(removed.code, 0, removed.err);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /"h2a"/);
  const repaired = cli(['doctor', '--root', join(dir, 'bus'), '--host', 'vibe', '--repair'], dir);
  assert.equal(repaired.code, 0, repaired.err);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /"h2a"/);
  assert.equal(vibeHostReport(repaired).mcp.changed, false);
  const installed = cli(['install-skills', '--host', 'vibe'], dir);
  assert.equal(installed.code, 0, installed.err);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /"h2a"/);
  assert.equal(cli(['host', 'setup', '--host', 'vibe', '--write'], dir).code, 0);
  assert.match(fs.readFileSync(target, 'utf8'), /transport = "stdio"/);
});

test('--endpoint remote writes a streamable-http url entry without command or args', t => {
  const { dir, vibe } = fixture(t);
  const target = join(vibe, 'config.toml');
  fs.writeFileSync(target, 'mcp_servers = []\n');
  const result = cli(['host', 'setup', '--host', 'vibe', '--endpoint', 'remote', '--url', 'https://example.test/mcp', '--write', target], dir);
  assert.equal(result.code, 0, result.err);
  const body = fs.readFileSync(target, 'utf8');
  assert.match(body, /transport = "streamable-http"/);
  assert.match(body, /url = "https:\/\/example\.test\/mcp"/);
  assert.doesNotMatch(body, /command =/);
});
