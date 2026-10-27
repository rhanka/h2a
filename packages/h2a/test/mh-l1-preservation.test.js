import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';

test('C03 should preserve every foreign byte and create an exact backup on explicit host setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-config-'));
  try {
    const path = join(dir, '.mcp.json');
    const before = '{\r\n "mcpServers" : { "graphify-ts" : {"command":"npx"}, "track-mcp" : {"command":"track-mcp"}, "h2a" : ';
    const after = ' }, "theme" : "雪"\r\n}\r\n';
    const original = before + '{"command":"old-h2a"}' + after;
    writeFileSync(path, original, { mode: 0o600 });
    const code = runCli(['host', 'setup', '--host', 'claude', '--write', path], {
      stdout: { write() {} }, stderr: { write() {} }, cwd: () => dir
    }, { doctorHostInstallations: () => ({ ok: true, hosts: [{ host: 'claude', ok: true, unrepaired: [] }] }) });
    assert.equal(code, 0);
    const written = readFileSync(path, 'utf8');
    assert.ok(written.startsWith(before), 'foreign bytes and CRLF preserved');
    assert.ok(written.endsWith(after));
    const backups = readdirSync(dir).filter(name => name.startsWith('.mcp.json.backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
