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

for (const mode of ["pass", "failure", "timeout"]) {
  test(`should reap fixture hosts and journals after ${mode}, including interrupted setup`, { timeout: 15_000 }, async t => {
    const root = createPrivateTestDirectory("life-");
    const env = nativeTestEnvironment(root);
    const marker = join(root, "owned.json"), script = join(root, "fixture.mjs");
    writeFileSync(script, `import test from 'node:test';
      import {writeFileSync,existsSync} from 'node:fs';
      import {join} from 'node:path';
      import {setupNativeTestEnvironment,assertNativeTestSpawnRefused,spawnIsolatedNative as spawn} from ${JSON.stringify(helper)};
      import {NativeTerminalClient} from ${JSON.stringify(clientModule)};
      let keepalive;test.after(()=>clearInterval(keepalive));
      setupNativeTestEnvironment(hook=>test.after(async()=>{
        const env={...process.env};await hook();
        assertNativeTestSpawnRefused(()=>spawn(process.execPath,[${JSON.stringify(entry)},'--socket',env.H2A_NATIVE_SOCKET],{env,stdio:'ignore'}));
        console.log('late spawn refused');
      }));
      test('fixture ${mode}', {timeout:4000}, async () => {
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
        if(${JSON.stringify(mode)}==='failure') {
          const ready=join(process.env.XDG_RUNTIME_DIR,'stubborn-ready');
          const stubborn=spawn(process.execPath,['--input-type=module','-e',
            'import {writeFileSync} from "node:fs";process.on("SIGTERM",()=>{});writeFileSync('+JSON.stringify(ready)+',"ready");setInterval(()=>{},1000);'],
            {env:process.env,detached:true,stdio:'ignore'});
          stubborn.unref();stubbornPid=stubborn.pid;
          while(!existsSync(ready))await new Promise(resolve=>setTimeout(resolve,10));
        }
        if(${JSON.stringify(mode)}==='timeout')host.kill('SIGSTOP');
        writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:ping.hostPid,stubbornPid,env:Object.fromEntries(
          ['HOME','XDG_RUNTIME_DIR','XDG_CONFIG_HOME','XDG_STATE_HOME','H2A_NATIVE_SOCKET',
          'H2A_TEST_PROC_ROOT','H2A_TEST_OWNED_PROC_ROOT'].map(key=>[key,process.env[key]]))}));
        if(${JSON.stringify(mode)}==='failure')throw new Error('injected setup failure');
        if(${JSON.stringify(mode)}==='timeout')await new Promise(()=>{keepalive=setInterval(()=>{},1000);});
      });`);
    const runner = spawn(process.execPath, ["--test", script], { env, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(runner, "close");
    let output = "", receipt, release, pinned = [];
    const survivors = () => pinned.filter(({ target }) => {
      try { return !/\) [ZX] /.test(readFileSync(join(target, "stat"), "utf8")); }
      catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
    });
    runner.stdout.on("data", bytes => { output += bytes; });
    runner.stderr.on("data", bytes => { output += bytes; });
    try {
      const deadline = performance.now() + 5000;
      while (!existsSync(marker)) {
        assert.ok(runner.exitCode === null && runner.signalCode === null && performance.now() < deadline, output);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      receipt = JSON.parse(readFileSync(marker, "utf8"));
      // Pin the host and its journal in this surviving parent before the
      // nested test exits: never enumerate or signal an unrelated process.
      const releases = [pinPrivateNativeProcess(receipt.pid, receipt.env)];
      if(receipt.stubbornPid)releases.push(pinPrivateNativeProcess(receipt.stubbornPid, receipt.env));
      release = () => { for(const unpin of releases.reverse())unpin(); };
      pinned = readdirSync(receipt.env.H2A_TEST_OWNED_PROC_ROOT).filter(name=>/^\d+\.pin$/.test(name))
        .map(name => ({ pid: Number(name.slice(0, -4)), target: readlinkSync(join(receipt.env.H2A_TEST_OWNED_PROC_ROOT, name)) }));
      t.diagnostic(`${mode}: owned host pid=${receipt.pid}; pinned tree ${pinned.map(row=>row.pid).join(", ")}`);
      const [status] = await closed;
      assert.equal(status, mode === "pass" ? 0 : 1, output);
      if (mode === "failure") assert.match(output, /injected setup failure/);
      if (mode === "timeout") assert.match(output, /testTimeoutFailure/);
      assert.match(output, /late spawn refused/);
      // Held descriptors outlive the fixture directory. Deleting its proc
      // symlinks cannot turn a still-running host into a false absence.
      assert.deepEqual(survivors().map(row=>row.pid), [], "fixture teardown left an owned host or journal alive");
      await waitForPrivateNativeProcesses(receipt.env);
      assert.doesNotMatch(output, /fixture processes still writing/);
      t.diagnostic(`${mode}: runner exit ${status}; no surviving owned host or journal`);
    } finally {
      // The red-before run deliberately leaves hosts behind. This outer
      // safety net kills only the descendants we pinned above, then proves
      // them dead; it is never part of the assertion's success path.
      if (receipt) {
        for (const { pid } of survivors()) {
          try { process.kill(pid, "SIGKILL"); }
          catch (error) { if (error.code !== "ESRCH") throw error; }
        }
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
