// Destructive resource qualification belongs only on a disposable hosted VM.
// Refusal is a FAILED qualification, never a silent skip or a local stress test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { fixture, usable } from '../../packages/h2a/test/helpers/restart-lab.js';
import { NativeTerminalClient } from '../../packages/h2a-runtime/dist/native-terminal/client.js';
import { observeWorkerOom, snapshotOomBaseline } from './oom-observation.mjs';

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
    // Since systemd 258 `systemctl --user` no longer honours
    // DBUS_SESSION_BUS_ADDRESS: its local transport connects to
    // $XDG_RUNTIME_DIR/systemd/private. The fixture points XDG_RUNTIME_DIR at
    // the disposable tree, so these manager calls must carry the runtime dir
    // that owns the bus (hence the scopes): the disposable VM user manager
    // running under /run/user/<uid>.
    const runtimeDir = dirname(bus.replace(/^unix:path=/, ''));
    const manager = args => spawnSync('systemctl', ['--user', ...args], { env: { ...f.env, XDG_RUNTIME_DIR: runtimeDir }, encoding: 'utf8', timeout: 3000 });
    const killed = manager(['kill', '--signal=KILL', launcherGroup.split('/').at(-1)]);
    assert.equal(killed.status, 0, killed.stderr);
    await launch.done;
    await usable(f, 'h2a-human-1', 'after-launcher-death');

    // The fault command allocates at most 160 MiB, only after memory.max and
    // memory.swap.max have been read back from its effective cgroup below.
    writeFileSync(join(f.root, 'agent.mjs'), `const keep=[];let buf='';process.stdout.write('agent-ready\\n');
      process.stdin.on('data',b=>{buf+=b.toString();for(let nl;(nl=buf.indexOf('\\n'))>=0;){const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);if(line==='memory-fault'){
        let count=0;const timer=setInterval(()=>{keep.push(Buffer.alloc(1024*1024,1));if(++count===160)clearInterval(timer);},10);
      }else process.stdout.write('ack:'+line+'\\n');}});setInterval(()=>{},1000);`);
    const results = await Promise.all([f.resume(2).done, f.resume(3).done]);
    assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
    await usable(f, 'h2a-lab-2'); await usable(f, 'h2a-lab-3');
    const onlyChild = (pid, label) => {
      const kids = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
      assert.equal(kids.length, 1, `${label}: expected 1 child of ${pid}, got ${kids.length}`);
      return kids[0];
    };
    const sessionWrapper = async id => {
      const s = await client.state(id);
      // The PTY guardian stays with its host; its child enters the worker unit.
      return onlyChild(s.pid, id);
    };
    const human1Group = cgroup(await sessionWrapper('h2a-human-1'));
    const lab2Group = cgroup(await sessionWrapper('h2a-lab-2'));
    const workerWrapperPid = await sessionWrapper('h2a-lab-3');
    const workerAgentPid = onlyChild(workerWrapperPid, 'h2a-lab-3 agent');
    const workerAgentStart = readFileSync(`/proc/${workerAgentPid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
    const workerGroup = cgroup(workerWrapperPid);
    assert.equal(cgroup(workerAgentPid), workerGroup, 'worker CLI must share its session scope with its wrapper');
    assert.match(human1Group, /\/h2a-session-.*\.scope$/);
    assert.match(lab2Group, /\/h2a-session-.*\.scope$/);
    assert.match(workerGroup, /\/h2a-session-.*\.scope$/);
    assert.equal(new Set([launcherGroup, hostGroup, human1Group, lab2Group, workerGroup]).size, 5);
    const parentGroup = dirname(workerGroup);
    assert.equal(dirname(hostGroup), parentGroup);
    assert.equal(dirname(human1Group), parentGroup);
    assert.equal(dirname(lab2Group), parentGroup);
    const controller = join('/sys/fs/cgroup', workerGroup);
    const parentController = join('/sys/fs/cgroup', parentGroup);
    const siblingControllers = [
      { name: 'host', path: join('/sys/fs/cgroup', hostGroup) },
      { name: 'h2a-human-1', path: join('/sys/fs/cgroup', human1Group) },
      { name: 'h2a-lab-2', path: join('/sys/fs/cgroup', lab2Group) },
    ];
    const memoryMax = Number(readFileSync(join(controller, 'memory.max'), 'utf8'));
    const swapMax = Number(readFileSync(join(controller, 'memory.swap.max'), 'utf8'));
    assert.equal(memoryMax, 128 * 1024 ** 2); assert.equal(swapMax, 0);
    // Force the HARD-limit path deterministically, rather than spending the
    // test in MemoryHigh reclaim/throttling. This changes only our disposable
    // worker unit, retains the verified 128 MiB ceiling and zero swap, and
    // never raises the surrounding VM's resource limits.
    const workerUnit = workerGroup.split('/').at(-1);
    const hardFault = manager(['set-property', '--runtime', workerUnit, 'MemoryHigh=infinity']);
    assert.equal(hardFault.status, 0, hardFault.stderr);
    assert.equal(readFileSync(join(controller, 'memory.high'), 'utf8').trim(), 'max');
    const baseline = snapshotOomBaseline({ controller, parentController, siblingControllers });
    const lease = await client.acquireController('h2a-lab-3', 'bounded-fault');
    await client.write(lease, 'memory-fault\n');
    const observation = await observeWorkerOom({
      controller,
      parentController,
      siblingControllers,
      baseline,
      readSessionState: () => client.state('h2a-lab-3'),
      readSessionOutput: async () => (await client.readOutput('h2a-lab-3', 0)).chunks.map(c => c.data).join(''),
      isAgentAlive: () => {
        try {
          const stat = readFileSync(`/proc/${workerAgentPid}/stat`, 'utf8').split(') ')[1].split(' ');
          return stat[19] === workerAgentStart && !['Z', 'X'].includes(stat[0]);
        } catch (err) {
          if (err.code === 'ENOENT' || err.code === 'ESRCH') return false;
          throw err;
        }
      },
    }).catch(async e => {
      const replay = await client.readOutput('h2a-lab-3', 0).catch(() => null);
      const snapshot = {
        oomd: spawnSync('systemctl', ['is-active', 'systemd-oomd'], { encoding: 'utf8' }).stdout.trim(),
        userManagedOOM: spawnSync('systemctl', ['show', `user@${process.getuid()}.service`, '-p', 'ManagedOOMMemoryPressure', '-p', 'ManagedOOMMemoryPressureLimit'], { encoding: 'utf8' }).stdout.trim(),
        workerUnitState: (manager(['show', workerUnit, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result']).stdout ?? '').trim(),
        workerWrapperCgroup: (() => { try { return readFileSync(`/proc/${workerWrapperPid}/cgroup`, 'utf8').trim(); } catch (err) { return `gone: ${err.code}`; } })(),
        workerAgentAlive: (() => { try { process.kill(workerAgentPid, 0); return true; } catch (err) { return err.code; } })(),
        memoryCurrent: (() => { try { return readFileSync(join(controller, 'memory.current'), 'utf8').trim(); } catch (err) { return err.code; } })(),
        parentEvents: (() => { try { return readFileSync(join(parentController, 'memory.events'), 'utf8').trim(); } catch (err) { return err.code; } })(),
        sessionOutput: replay ? replay.chunks.map(c => c.data).join('').slice(-400) : null,
        kernel: readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim(),
      };
      assert.fail(`DIAG ${e.message} | ${JSON.stringify(snapshot)}`);
    });
    await client.releaseController(lease).catch(() => {});
    assert.equal((await client.ping()).hostPid, hostPid);
    await usable(f, 'h2a-human-1', 'after-worker-oom');
    await usable(f, 'h2a-lab-2', 'other-human-after-oom');
    const workerUnitState = (manager(['show', workerUnit, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result']).stdout ?? '').trim();
    t.diagnostic(JSON.stringify({ launcherGroup, hostGroup, human1Group, lab2Group, workerGroup, memoryMax, swapMax, faultMemoryHigh: 'max', observation, workerUnitState, humanExchanges: 2 }));
  } finally { client.close(); }
});
