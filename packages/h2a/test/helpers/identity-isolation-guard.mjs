import fs from 'node:fs';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const lane = process.env.IDLOCK_LANE;
if (!lane) throw new Error('isolated lane required');
const owned = new Set([process.pid]);
const rawRead = fs.readFileSync;
const rawAppend = fs.appendFileSync;
const ownedFile=lane+'/owned-pids.txt';rawAppend(ownedFile,process.pid+'\n');
const isOwned=pid=>owned.has(pid)||rawRead(ownedFile,'utf8').split('\n').includes(String(pid));
const check = (path, write = false) => {
  if (typeof path !== 'string') return;
  if (/^\/run\/user\/|\/h2a-workspace|\/\.config\/sentropic\/h2a|\/\.local\/state\/h2a|\/h2a-nt/.test(path)) throw new Error('forbidden h2a state');
  const pid = path.match(/^\/proc\/(\d+)(?:\/|$)/);
  if (pid && !isOwned(Number(pid[1]))) throw new Error('unowned process');
  if (write && !path.startsWith(lane + '/')) throw new Error('write outside isolated lane');
};
for (const name of ['readFileSync', 'readlinkSync', 'statSync', 'lstatSync', 'statfsSync', 'existsSync', 'readdirSync']) {
  const original = fs[name]; fs[name] = (p, ...args) => { check(p); return original(p, ...args); };
}
for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmSync']) {
  const original = fs[name]; fs[name] = (p, ...args) => { check(p, true); return original(p, ...args); };
}
for (const name of ['linkSync', 'renameSync', 'copyFileSync']) {
  const original = fs[name]; fs[name] = (a, b, ...args) => { check(a, name !== 'copyFileSync'); check(b, true); return original(a, b, ...args); };
}
const open = fs.openSync;
fs.openSync = (p, flags, ...args) => { check(p, typeof flags === 'string' ? /[wa+]/.test(flags) : Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))); return open(p, flags, ...args); };
for (const name of ['spawn', 'spawnSync', 'fork']) {
  const original = child[name]; child[name] = (cmd, ...args) => {
    if (['h2a', 'pkill', 'killall'].includes(cmd)) throw new Error('forbidden executable');
    const proc = original(cmd, ...args); if (proc.pid) {owned.add(proc.pid);rawAppend(ownedFile,proc.pid+'\n');} return proc;
  };
}
const kill = process.kill.bind(process);
process.kill = (pid, signal) => { if (!isOwned(pid)) throw new Error('unowned process'); return kill(pid, signal); };
syncBuiltinESMExports();
// Positive controls: the instrumentation must actually reject both classes.
try { fs.readFileSync('/home/antoinefa/h2a-workspace/control'); throw new Error('guard failed'); } catch (e) { if (e.message !== 'forbidden h2a state') throw e; }
try { process.kill(1, 0); throw new Error('guard failed'); } catch (e) { if (e.message !== 'unowned process') throw e; }
