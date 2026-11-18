import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment } from './xcli-lab.mjs';

export function buildSupervisor(root) {
  assert.equal(process.platform, 'linux', 'exec observation requires Linux');
  const binary = join(root, 'process-supervisor');
  const result = spawnSync('/usr/bin/g++', ['-std=c++17', '-O2', join(import.meta.dirname, 'xcli-process-supervisor.cc'), '-o', binary], {
    env: environment(join(root, 'supervisor-compiler')), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, `supervisor compilation failed: ${result.stderr}`);
  return binary;
}
export function supervisedCommand(binary, root, command) {
  return [binary, join(root, 'exec.jsonl'), join(root, 'recovery.json'), ...command];
}
export function supervisorResult(root) {
  const summary = JSON.parse(fs.readFileSync(join(root, 'recovery.json'), 'utf8'));
  return { ...summary, records: fs.readFileSync(join(root, 'exec.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) };
}
