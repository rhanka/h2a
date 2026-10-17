import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createPrivateTestDirectory, nativeTestEnvironment, pinPrivateNativeProcess,
  spawnIsolatedNative as spawn, waitForPrivateNativeProcesses,
} from "./helpers/native-isolation.js";

const helper = new URL("./helpers/native-isolation.js", import.meta.url).href;
const clientModule = new URL("../../h2a-runtime/dist/native-terminal/client.js", import.meta.url).href;
const entry = new URL("../../h2a-runtime/dist/native-terminal/process.js", import.meta.url).pathname;

for (const mode of ["pass", "failure", "timeout", "timeout-delayed", "pass-delayed"]) {
  // Delayed modes arrive with the outer ack after the 3 s ack barrier expired:
  // regression cover for the ackDeadline/timeout deadlock. "timeout-delayed"
  // guards the keepalive placement (a post-hook interval would hang the
  // runner); "pass-delayed" guards the inner budget (setup + barrier must fit
  // inside the inner timeout) and the pin-miss proof on the throw path.
  const innerMode = mode === "timeout-delayed" ? "timeout" : mode === "pass-delayed" ? "pass" : mode;
  test(`should reap fixture hosts and journals after ${mode}, including interrupted setup`, { timeout: 30_000 }, async t => {
    const root = createPrivateTestDirectory("life-");
    const env = nativeTestEnvironment(root);
    const marker = join(root, "owned.json"), script = join(root, "fixture.mjs");
    writeFileSync(script, `import test from 'node:test';
      import {writeFileSync,existsSync,readFileSync} from 'node:fs';
      import {join} from 'node:path';
      import {setupNativeTestEnvironment,assertNativeTestSpawnRefused,spawnIsolatedNative as spawn} from ${JSON.stringify(helper)};
      import {NativeTerminalClient} from ${JSON.stringify(clientModule)};
      let keepalive;test.after(()=>clearInterval(keepalive));
      setupNativeTestEnvironment(hook=>test.after(async()=>{
        const env={...process.env};await hook();
        assertNativeTestSpawnRefused(()=>spawn(process.execPath,[${JSON.stringify(entry)},'--socket',env.H2A_NATIVE_SOCKET],{env,stdio:'ignore'}));
        console.log('late spawn refused');
      }));
      const readStartTime=pid=>{try{const raw=readFileSync('/proc/'+pid+'/stat','utf8');const at=raw.lastIndexOf(') ');if(at<0)return null;const n=Number(raw.slice(at+2).split(' ')[19]);return Number.isFinite(n)&&n>=0?n:null;}catch{return null;}};
      const readChildren=pid=>{try{const text=readFileSync('/proc/'+pid+'/task/'+pid+'/children','utf8').trim();return text?text.split(/\\s+/).map(Number).filter(n=>Number.isInteger(n)&&n>0):[];}catch{return[];}};
      const readCmd=pid=>{try{return readFileSync('/proc/'+pid+'/cmdline','utf8').split(String.fromCharCode(0)).join(' ').slice(0,400);}catch{return '';}};
      test('fixture ${innerMode}', {timeout:10000}, async () => {
        // Created BEFORE the ack barrier: test.after always sees a live
        // interval, so no ref'd timer can outlive the hook and hang the
        // runner, whatever the timeout/barrier interleaving is.
        keepalive=setInterval(()=>{},1000);
        const socket=process.env.H2A_NATIVE_SOCKET;
        const host=spawn(process.execPath,[${JSON.stringify(entry)},'--socket',socket,
          '--registry-path',join(process.env.XDG_RUNTIME_DIR,'registry.json')],
          {env:process.env,detached:true,stdio:'ignore'});
        host.unref();
        let client;
        while(!client) {
          try { client=await NativeTerminalClient.connect(socket); }
          catch { await new Promise(resolve=>setTimeout(resolve,10)); }
        }
        const ping=await client.ping();client.close();
        let stubbornPid;
        if(${JSON.stringify(innerMode)}==='failure') {
          const ready=join(process.env.XDG_RUNTIME_DIR,'stubborn-ready');
          const stubborn=spawn(process.execPath,['--input-type=module','-e',
            'import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});writeFileSync('+JSON.stringify(ready)+',"ready");setInterval(()=>{},1000);'],
            {env:process.env,detached:true,stdio:'ignore'});
          stubborn.unref();stubbornPid=stubborn.pid;
          while(!existsSync(ready))await new Promise(resolve=>setTimeout(resolve,10));
        }
        if(${JSON.stringify(innerMode)}==='timeout')host.kill('SIGSTOP');
        const tree=[{pid:ping.hostPid,startTime:readStartTime(ping.hostPid),cmd:readCmd(ping.hostPid)}];
        for(const kid of readChildren(ping.hostPid))tree.push({pid:kid,startTime:readStartTime(kid),cmd:readCmd(kid)});
        if(stubbornPid)tree.push({pid:stubbornPid,startTime:readStartTime(stubbornPid),cmd:readCmd(stubbornPid)});
        writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:ping.hostPid,pidStartTime:tree[0].startTime,tree,stubbornPid,env:Object.fromEntries(
          ['HOME','XDG_RUNTIME_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','H2A_NATIVE_SOCKET',
          'H2A_TEST_PROC_ROOT','H2A_TEST_OWNED_PROC_ROOT'].map(key=>[key,process.env[key]]))}));
        // Barrier: let the surviving outer parent pin the host and its journal
        // before this test exits and the inner teardown deletes the owned root.
        const ackDeadline=Date.now()+3000;
        while(!existsSync(${JSON.stringify(marker + ".ack")})&&Date.now()<ackDeadline)await new Promise(resolve=>setTimeout(resolve,10));
        if(${JSON.stringify(innerMode)}==='failure')throw new Error('injected setup failure');
        if(${JSON.stringify(innerMode)}==='timeout')await new Promise(()=>{});
      });`);
    const runner = spawn(process.execPath, ["--test", "--test-reporter=tap", script], { env, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(runner, "close");
    // Fail-closed guard: if the runner ever stops exiting by itself (e.g. a
    // leaked ref'd keepalive after an inner timeout), SIGKILL it so `await
    // closed` below always resolves before the outer timeout. Well under the
    // 30 s outer budget, far above the ~13 s slowest legitimate path.
    const killer = setTimeout(() => {
      try { if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL"); } catch {}
    }, 25_000);
    if (killer.unref) killer.unref();
    let output = "", receipt, release, pinned = [];
    const survivors = () => pinned.filter(({ target }) => {
      try { return !/\) [ZX] /.test(readFileSync(join(target, "stat"), "utf8")); }
      catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
    });
    // Start-time identity proof for a recorded tree whose root exited before
    // the outer pin: gone (ENOENT), zombie/drained (Z/X), or PID-recycled
    // (changed startTime) all prove the recorded incarnation ended. A live
    // incarnation with the recorded startTime fails closed.
    const proveTreeReaped = async tree => {
      assert.ok(Array.isArray(tree) && tree.length > 0, "no recorded fixture tree to prove reaped");
      const deadline = Date.now() + 2000;
      for (;;) {
        const pending = [], reaped = [];
        for (const row of tree) {
          assert.ok(Number.isInteger(row.pid) && row.pid > 0, `bad recorded fixture pid ${row.pid}`);
          if (!Number.isFinite(row.startTime)) assert.fail(`no start-time identity recorded for fixture pid ${row.pid}: cannot prove reap`);
          let raw;
          try { raw = readFileSync(`/proc/${row.pid}/stat`, "utf8"); }
          catch (error) { if (error.code === "ENOENT") { reaped.push(row.pid); continue; } throw error; }
          const at = raw.lastIndexOf(") ");
          assert.ok(at >= 0, `unparsable /proc/${row.pid}/stat`);
          const rest = raw.slice(at + 2).split(" ");
          if (rest[0] === "Z" || rest[0] === "X") { reaped.push(row.pid); continue; }
          const now = Number(rest[19]);
          if (!Number.isFinite(now)) assert.fail(`unparsable start-time for fixture pid ${row.pid}: cannot prove reap`);
          if (now !== row.startTime) { reaped.push(row.pid); continue; }
          pending.push(row.pid);
        }
        if (pending.length === 0) return reaped;
        assert.ok(Date.now() < deadline, `fixture processes still alive after teardown: ${pending.join(", ")}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    runner.stdout.on("data", bytes => { output += bytes; });
    runner.stderr.on("data", bytes => { output += bytes; });
    try {
      const deadline = performance.now() + 5000;
      while (!existsSync(marker)) {
        assert.ok(runner.exitCode === null && runner.signalCode === null && performance.now() < deadline, output);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      receipt = JSON.parse(readFileSync(marker, "utf8"));
      // The recorded tree is the proof input: it must name the host first,
      // carry a start-time identity per row, and include the journal writer
      // (host + writer at minimum, plus the stubborn child in failure mode).
      // A tree that silently omits children is a failed test, never a pass.
      const tree = receipt.tree;
      assert.ok(Array.isArray(tree) && tree.length > 0, "no recorded fixture tree");
      for (const row of tree) {
        assert.ok(Number.isInteger(row.pid) && row.pid > 0, `bad recorded fixture pid ${row.pid}`);
        assert.ok(Number.isFinite(row.startTime), `no start-time identity recorded for fixture pid ${row.pid}`);
        assert.equal(typeof row.cmd, "string", `no command line recorded for fixture pid ${row.pid}`);
      }
      assert.equal(tree[0].pid, receipt.pid, "recorded tree root is not the fixture host");
      assert.ok(tree.length >= (innerMode === "failure" ? 3 : 2),
        `recorded fixture tree misses descendants (got ${tree.length}, want ${innerMode === "failure" ? 3 : 2})`);
      assert.ok(tree.some(row => String(row.cmd).includes("--native-host-journal-writer")),
        "recorded fixture tree misses the journal writer");
      // Delayed-ack regression: arrive after the 3 s ack barrier expired, so
      // the fixture already proceeded on the unacked path.
      if (mode.endsWith("-delayed")) await new Promise(resolve => setTimeout(resolve, 5000));
      // Pin the host and its journal in this surviving parent before the
      // nested test exits: never enumerate or signal an unrelated process.
      // The fixture waits for the ack below before exiting, so the inner
      // teardown cannot delete the owned root mid-pin on the acked path. A
      // host that still exited first is proven reaped with its whole recorded
      // tree via start-time identity below, never silently ignored.
      const ackPath = marker + ".ack";
      const releases = [];
      let pinMissed = null;
      try {
        releases.push(pinPrivateNativeProcess(receipt.pid, receipt.env));
        if (receipt.stubbornPid) releases.push(pinPrivateNativeProcess(receipt.stubbornPid, receipt.env));
        release = () => { for (const unpin of releases.reverse()) unpin(); };
        pinned = readdirSync(receipt.env.H2A_TEST_OWNED_PROC_ROOT).filter(name=>/^\d+\.pin$/.test(name))
          .map(name => ({ pid: Number(name.slice(0, -4)), target: readlinkSync(join(receipt.env.H2A_TEST_OWNED_PROC_ROOT, name)) }));
        // A pin that returns without covering the whole recorded tree (e.g. a
        // host already zombie whose children list is empty) is a missed pin:
        // the full tree still goes through the start-time proof below.
        const pinnedPids = new Set(pinned.map(row => row.pid));
        const missing = tree.filter(row => !pinnedPids.has(row.pid)).map(row => row.pid);
        if (missing.length > 0) pinMissed = new Error(`outer pin missed recorded fixture pids: ${missing.join(", ")}`);
      } catch (error) {
        for (const unpin of releases.reverse()) { try { unpin(); } catch {} }
        releases.length = 0;
        release = undefined;
        pinned = [];
        if (!["ENOENT", "ESRCH"].includes(error?.code)) throw error;
        pinMissed = error;
      } finally {
        try { writeFileSync(ackPath, "acked"); } catch {}
      }
      t.diagnostic(`${mode}: owned host pid=${receipt.pid}; pinned tree ${pinned.map(row=>row.pid).join(", ")}${pinMissed ? "; pin missed, will prove recorded tree" : ""}`);
      const [status] = await closed;
      assert.equal(status, innerMode === "pass" ? 0 : 1, output);
      if (innerMode === "failure") assert.match(output, /injected setup failure/);
      if (innerMode === "timeout") assert.match(output, /testTimeoutFailure/);
      assert.match(output, /late spawn refused/);
      // Held descriptors outlive the fixture directory. Deleting its proc
      // symlinks cannot turn a still-running host into a false absence. Both
      // proofs always run: the start-time proof covers recorded processes the
      // pin never saw (zombie host, reparented journal), and the survivors
      // probe covers everything the pin holds.
      const proved = await proveTreeReaped(tree);
      assert.ok(proved.includes(receipt.pid), "vanished host not proven reaped with its whole tree");
      for (const row of tree) assert.ok(proved.includes(row.pid), `recorded fixture pid ${row.pid} not proven reaped`);
      assert.deepEqual(survivors().map(row=>row.pid), [], "fixture teardown left an owned host or journal alive");
      t.diagnostic(`${mode}: proved reaped tree ${proved.join(", ")}${pinMissed ? " after pin miss" : ""}`);
      // On the pin-miss path the owned root may already be deleted; the
      // start-time proof above is the evidence, this only confirms quiet.
      await waitForPrivateNativeProcesses(receipt.env);
      assert.doesNotMatch(output, /fixture processes still writing/);
      t.diagnostic(`${mode}: runner exit ${status}; no surviving owned host or journal`);
    } finally {
      // Safety net: kill the pinned survivors AND every recorded tree row
      // (start-time identity checked, so a recycled PID is never touched),
      // then prove them dead. It is never part of the success path: on the
      // pin-miss path `pinned` is empty and only the recorded tree can name
      // a survivor.
      clearTimeout(killer);
      const killRecordedTree = rows => {
        for (const row of rows ?? []) {
          if (!Number.isInteger(row?.pid) || !Number.isFinite(row?.startTime)) continue;
          let raw;
          try { raw = readFileSync(`/proc/${row.pid}/stat`, "utf8"); }
          catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw error; }
          const at = raw.lastIndexOf(") ");
          if (at < 0) continue;
          const rest = raw.slice(at + 2).split(" ");
          if (rest[0] === "Z" || rest[0] === "X") continue;
          if (Number(rest[19]) !== row.startTime) continue;
          try { process.kill(row.pid, "SIGKILL"); }
          catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      };
      if (receipt) {
        for (const { pid } of survivors()) {
          try { process.kill(pid, "SIGKILL"); }
          catch (error) { if (error.code !== "ESRCH") throw error; }
        }
        killRecordedTree(receipt.tree);
        const deadline = performance.now() + 1000;
        while (survivors().length && performance.now() < deadline) await new Promise(resolve=>setTimeout(resolve,10));
        assert.deepEqual(survivors().map(row=>row.pid), [], "outer red-before safety net left a survivor");
        await waitForPrivateNativeProcesses(receipt.env);
      }
      if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
      await closed;
      release?.();
      if (receipt) rmSync(receipt.env.XDG_RUNTIME_DIR, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
}
