import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect, preflight } from './pty-io.mjs';
import { json, here, fdFlags } from './lab.mjs';

export function transition(state, request) {
  const eligible = preflight(state.sessions);
  if (!eligible.ok) return eligible;
  const next = path.join(here, `image-${(state.generation + 1) % 2}.mjs`);
  if (request.fault === 'candidate') return { ok: false, reason: 'candidate-invalid', attempted: false };
  if (request.fault === 'checkpoint') return { ok: false, reason: 'schema-invalid', attempted: false };
  if (request.fault === 'fd') return { ok: false, reason: 'bad-fd', attempted: false };
  // The native-addon preflight is a child we start, with the same private env.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {version} from ${JSON.stringify(new URL('./pty-io.mjs', import.meta.url).href)}; if(version!=='1.1.0')process.exit(1);`],
  { cwd: process.env.SPIKE_ROOT, env: process.env });
  if (probe.status !== 0) return { ok: false, reason: 'addon-preflight-failed', attempted: false };
  if (fdFlags(3) & 0o2000000) return { ok: false, reason: 'listener-CLOEXEC', attempted: false };
  for (const session of state.sessions) { collect(session); session.epoch++; session.controller = null; }
  state.generation++;
  state.transitionAt = performance.timeOrigin + performance.now();
  state.fault = request.fault;
  json(path.join(process.env.SPIKE_ROOT, 'checkpoint.json'), state);
  state.quiescing = true;
  setTimeout(() => {
    process.execve(request.fault === 'abort' ? '/no-such-spike-node' : process.execPath,
      [process.execPath, next], { ...process.env, SPIKE_RESUME: '1' });
  }, request.delay ?? 30);
  return { ok: true, accepted: true, generation: state.generation };
}
