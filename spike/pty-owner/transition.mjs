import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect, preflight } from './pty-io.mjs';
import { json, here, fdFlags } from './lab.mjs';

export function transition(state, request) {
  const eligible = preflight(state.sessions);
  if (!eligible.ok) return eligible;
  const next = path.join(here, `image-${(state.generation + 1) % 2}.mjs`);
  const target = request.targetNode ?? process.execPath;
  try { fs.accessSync(target, fs.constants.X_OK); }
  catch { return { ok: false, reason: 'candidate-invalid', attempted: false }; }
  if (request.fault === 'candidate') {
    try { fs.accessSync(path.join(process.env.SPIKE_ROOT, 'missing-candidate'), fs.constants.X_OK); }
    catch { return { ok: false, reason: 'candidate-invalid', attempted: false }; }
  }
  if (request.fault === 'checkpoint') {
    const bad = path.join(process.env.SPIKE_ROOT, 'invalid-checkpoint.json');
    json(bad, { ...state, schema: 999 });
    if (JSON.parse(fs.readFileSync(bad)).schema !== 1)
      return { ok: false, reason: 'schema-invalid', attempted: false };
  }
  if (request.fault === 'fd') return preflight([{ ...state.sessions[0], fd: 999999 }]);
  // The native-addon preflight is a child we start, with the same private env.
  const probe = spawnSync(target, ['--input-type=module', '-e',
    `import {version} from ${JSON.stringify(new URL('./pty-io.mjs', import.meta.url).href)}; if(version!=='1.1.0')process.exit(1);`],
  { cwd: process.env.SPIKE_ROOT, env: process.env });
  if (probe.status !== 0) return { ok: false, reason: 'addon-preflight-failed', attempted: false };
  if (process.env.SPIKE_DIRECT_LISTENER === '1' && (fdFlags(3) & 0o2000000))
    return { ok: false, reason: 'listener-CLOEXEC', attempted: false };
  // Detached owner uses stdin exclusively for socket activation. process.execve
  // explicitly clears CLOEXEC on 0/1/2, unlike arbitrary listener descriptors.
  for (const session of state.sessions) { collect(session); session.epoch++; session.controller = null; }
  state.generation++;
  state.transitionAt = performance.timeOrigin + performance.now();
  state.fault = request.fault;
  json(path.join(process.env.SPIKE_ROOT, 'checkpoint.json'), state);
  state.quiescing = true;
  setTimeout(() => {
    process.execve(request.fault === 'abort' ? '/no-such-spike-node' : target,
      [target, next], { ...process.env, SPIKE_RESUME: '1' });
  }, request.delay ?? 30);
  return { ok: true, accepted: true, generation: state.generation };
}
