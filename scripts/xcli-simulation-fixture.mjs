import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

export function runWakeCell(args, spawnTimeoutMs = 300000) {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-wake-'));
  const output = join(root, 'receipt.json');
  const env = { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
    ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) };
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'qualify-cross-cli.mjs'),
    '--simulated', ...args, '--output', output],
  { env, encoding: 'utf8', timeout: spawnTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.existsSync(output), `qualification produced no receipt: ${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
  return { status: result.status, receipt, cells: receipt.cells };
}

export function receiverInboxReads(cell) {
  return cell.evidence.filter(e => e.event === 'inbox' && e.role === 'receiver' && e.ok);
}
