import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';

function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'native-equipment-'));
  const previous = { ...process.env };
  process.env.HOME = dir;
  process.env.VIBE_HOME = join(dir, 'vibe with spaces');
  fs.mkdirSync(process.env.VIBE_HOME);
  fs.writeFileSync(join(process.env.VIBE_HOME, 'config.toml'), 'mcp_servers = []\n');
  t.after(() => { process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, vibe: process.env.VIBE_HOME };
}
function cli(args, cwd) {
  let out = '', err = '';
  const code = runCli(args, { cwd: () => cwd, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } });
  return { code, out, err, json: () => JSON.parse(out) };
}
test('Vibe installs resources under VIBE_HOME and preserves custom skills even with force', t => {
  const { dir, vibe } = fixture(t);
  const first = cli(['install-skills', '--host', 'vibe'], dir);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.json().targetBase, join(vibe, 'skills'));
  assert.ok(fs.existsSync(join(vibe, 'skills/branch-lifecycle/assets/check.sh')));
  assert.ok(fs.existsSync(join(vibe, 'skills/present-decision/assets')));
  const path = join(vibe, 'skills/h2a/SKILL.md');
  const before = fs.statSync(path).mtimeMs;
  assert.equal(cli(['install-skills', '--host', 'vibe'], dir).code, 0);
  assert.equal(fs.statSync(path).mtimeMs, before);
  fs.writeFileSync(path, 'personal instructions\n');
  assert.notEqual(cli(['install-skills', '--host', 'vibe', '--force'], dir).code, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), 'personal instructions\n');
});
test('doctor and status expose the mandatory missing-MCP diagnostic without a write workaround', t => {
  const { dir } = fixture(t);
  cli(['init', '--root', join(dir, 'bus')], dir);
  for (const args of [['doctor', '--root', join(dir, 'bus')], ['host', 'status']]) {
    const result = cli([...args, '--host', 'vibe'], dir);
    assert.match(result.out, /Skills installées, outils MCP absents — bootstrap registre attendu/);
    assert.doesNotMatch(result.out, /Merge the snippet|Translate the snippet/);
  }
});
test('Vibe setup refuses MCP writes including JSON and force', t => {
  const { dir } = fixture(t);
  const path = join(dir, 'mcp.json');
  const result = cli(['host', 'setup', '--host', 'vibe', '--write', path, '--force'], dir);
  assert.notEqual(result.code, 0, result.out);
  assert.equal(fs.existsSync(path), false);
});
for (const host of ['vibe', 'muse', 'agy']) {
  test(`${host} setup labels historical rendering without recommending direct configuration`, t => {
    const { dir } = fixture(t);
    const result = cli(['host', 'setup', '--host', host, '--print'], dir);
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /non migré|non migrée/);
    assert.doesNotMatch(result.out, /Merge|Translate|re-run this/);
  });
}
