// Destructive resource qualification belongs only on a disposable hosted VM.
// Refusal is a FAILED qualification, never a silent skip or a local stress test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { fixture, eventually, usable } from '../../packages/h2a/test/helpers/restart-lab.js';
import { NativeTerminalClient } from '../../packages/h2a-runtime/dist/native-terminal/client.js';

test('oom-isolation: effective sibling cgroups survive launcher death and a bounded worker OOM', { timeout: 30000 }, async t => {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Requires a disposable GitHub hosted VM; no local memory fault is permitted');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted workstations are forbidden');
  const bus = process.env.H2A_LAB_DISPOSABLE_BUS;
  assert.ok(bus?.startsWith('unix:path=/run/user/'), 'The disposable VM must supply its user manager bus');
  const f = fixture(t);
  f.env.DBUS_SESSION_BUS_ADDRESS = bus;
  f.env.H2A_NATIVE_SESSION_MEMORY_MAX = String(128 * 1024 ** 2);
  f.save([]);
  const scopeModule = pathToFileURL(resolve('packages/h2a-runtime/dist/native-terminal/host-scope.js')).href;
  const cli = resolve('packages/h2a/dist/bin.js');
  const launcher = join(f.root, 'launcher.mjs');
  writeFileSync(launcher, `import {spawn} from 'node:child_process';import {isolateNativeTerminalSession} from ${JSON.stringify(scopeModule)};
    const moved=await isolateNativeTerminalSession();if(!moved.isolated)throw Error(JSON.stringify(moved));
    const child=spawn(process.execPath,[${JSON.stringify(cli)},'run','codex',process.env.HOME,'--name','human-1','--background','--no-attach','--bare','--no-h2a','--no-gw'],
      {env:{...process.env,H2A_NATIVE_SESSION_MEMORY_MAX:String(128*1024**2)},stdio:'inherit'});
    child.on('exit',code=>{if(code)process.exit(code);});setInterval(()=>{},1000);`);
  const launch = f.start([], launcher, { H2A_NATIVE_SESSION_MEMORY_MAX: String(512 * 1024 ** 2) });
  await usable(f, 'h2a-human-1');
  const client = await NativeTerminalClient.connect(f.env.H2A_NATIVE_SOCKET);
  try {
    const hostPid = (await client.ping()).hostPid;
    const cgroup = pid => readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split('::')[1];
    const launcherGroup = cgroup(launch.child.pid);
    const hostGroup = cgroup(hostPid);
    assert.match(launcherGroup, /\/h2a-session-.*\.scope$/);
    assert.match(hostGroup, /\/h2a-native-.*\.scope$/);
    assert.notEqual(hostGroup, launcherGroup);
    const manager = args => spawnSync('systemctl', ['--user', ...args], { env: f.env, encoding: 'utf8', timeout: 3000 });
    const killed = manager(['kill', '--signal=KILL', launcherGroup.split('/').at(-1)]);
    assert.equal(killed.status, 0, killed.stderr);
    await launch.done;
    await usable(f, 'h2a-human-1', 'after-launcher-death');

    // The fault command allocates at most 160 MiB, only after memory.max and
    // memory.swap.max have been read back from its effective cgroup below.
    writeFileSync(join(f.root, 'agent.mjs'), `const keep=[];process.stdout.write('agent-ready\\n');
      process.stdin.on('data',b=>{if(b.toString().trim()==='memory-fault'){
        let count=0;const timer=setInterval(()=>{keep.push(Buffer.alloc(1024*1024,1));if(++count===160)clearInterval(timer);},10);
      }else process.stdout.write('ack:'+b);});setInterval(()=>{},1000);`);
    const results = await Promise.all([f.resume(2).done, f.resume(3).done]);
    assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
    await usable(f, 'h2a-lab-2'); await usable(f, 'h2a-lab-3');
    const state = await client.state('h2a-lab-3');
    // The PTY guardian stays with its host; its child enters the worker unit.
    const children = readFileSync(`/proc/${state.pid}/task/${state.pid}/children`, 'utf8').trim().split(/\s+/).map(Number);
    assert.equal(children.length, 1);
    const workerGroup = cgroup(children[0]);
    assert.match(workerGroup, /\/h2a-session-.*\.scope$/);
    assert.notEqual(workerGroup, hostGroup); assert.notEqual(workerGroup, launcherGroup);
    const controller = join('/sys/fs/cgroup', workerGroup);
    const memoryMax = Number(readFileSync(join(controller, 'memory.max'), 'utf8'));
    const swapMax = Number(readFileSync(join(controller, 'memory.swap.max'), 'utf8'));
    assert.equal(memoryMax, 128 * 1024 ** 2); assert.equal(swapMax, 0);
    const lease = await client.acquireController('h2a-lab-3', 'bounded-fault');
    await client.write(lease, 'memory-fault\n');
    const events = await eventually(() => readFileSync(join(controller, 'memory.events'), 'utf8'), value => /oom_kill [1-9]/.test(value));
    await client.releaseController(lease).catch(() => {});
    assert.equal((await client.ping()).hostPid, hostPid);
    await usable(f, 'h2a-human-1', 'after-worker-oom');
    await usable(f, 'h2a-lab-2', 'other-human-after-oom');
    t.diagnostic(JSON.stringify({ launcherGroup, hostGroup, workerGroup, memoryMax, swapMax, events, humanExchanges: 2 }));
  } finally { client.close(); }
});
