import { spawn } from 'node:child_process';
import path from 'node:path';
import { closeForeign } from './guardian.mjs';
import { identity, sameBirth, here } from './lab.mjs';

export function frontManager(root) {
  let child, birth, generation = 0;
  return request => {
    if (request.op === 'front-kill') {
      if (!birth || !sameBirth(birth)) return { error: 'no-live-frontend' };
      child.kill('SIGKILL'); return { killed: birth };
    }
    child = spawn('/usr/bin/setpriv', ['--pdeathsig', 'SIGKILL', '--', '/usr/bin/bash', '-c',
      `${closeForeign}\nexec "$@"`, 'spike-frontend-launcher', process.execPath,
      path.join(here, 'frontend.mjs'), String(++generation)], {
      cwd: root, env: process.env,
      stdio: process.env.SPIKE_B_ACTIVATION === '0' ? ['ignore', 'inherit', 'inherit'] : [3, 'inherit', 'inherit'],
    });
    child.on('error', error => { throw error; });
    birth = identity(child.pid); return { birth, generation };
  };
}
