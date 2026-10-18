// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment, spawnIsolatedNative as spawn } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { statSync, cpSync, symlinkSync, appendFileSync, chmodSync, accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NativeTerminalClient } from "./client.js";
import { readProcessStartTime } from "./host.js";
import { runAttach } from "./op.js";
import { requestNativeTerminalOwnerControl } from "./owner-protocol.js";
setupNativeTestEnvironment(afterAll);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | Promise<T>, accept: (v: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= deadline) throw new Error(`waiting for ${label}: ${JSON.stringify(value)}`);
    await delay(10);
  }
}
type Cut = "before" | "after" | "timeout" | undefined;

async function fixture(cut?: Cut, launch?: EnrolledCli | "bash") {
  const budget = 1024 * 1024, maxSessions = 4;
  const directory = mkdtempSync(join(process.env.TMPDIR!, "sw-"));
  const socketPath = join(directory, "h"), proxyPath = join(directory, "p");
  const receipts = join(directory, "children");
  const observer = join(directory, "observer.mjs");
  const identityModule = pathToFileURL(fileURLToPath(new URL("../../dist/proc-identity.js", import.meta.url))).href;
  writeFileSync(observer, `import {appendFileSync} from 'node:fs';
import {ChildProcess} from 'node:child_process';
import {readProcessStartTime} from ${JSON.stringify(identityModule)};
const record=pid=>appendFileSync(${JSON.stringify(receipts)},JSON.stringify({pid,birth:readProcessStartTime(pid)})+'\\n');
record(process.pid);const original=ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn=function(options){const result=original.call(this,options);if(this.pid)record(this.pid);return result;};`);
  const owner = spawn(process.execPath, [fileURLToPath(new URL("../../dist/native-terminal/owner-process.js", import.meta.url)),
    "--socket", socketPath, "--generation", "swap", "--registry-path", join(directory, "registry.json"),
    "--replay-bytes", String(budget), "--max-sessions", String(maxSessions)], {
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(observer).href}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "", ready = "";
  owner.stdout!.on("data", chunk => { ready += chunk; });
  owner.stderr!.on("data", chunk => { errors += chunk; });
  const clients: NativeTerminalClient[] = [], sockets = new Set<Socket>();
  let proxy: ReturnType<typeof createServer> | undefined;
  cleanups.push(async () => {
    for (const client of clients) client.close();
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    // PID receipts originate at spawn, including grandchildren and journal writers.
    if (existsSync(receipts)) for (const line of readFileSync(receipts, "utf8").trim().split("\n").filter(Boolean)) {
      const {pid, birth} = JSON.parse(line);
      if (pid === process.pid || birth === undefined || readProcessStartTime(pid) !== birth) continue;
      try { process.kill(pid, "SIGKILL"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
    }
    if (owner.exitCode === null && owner.signalCode === null) { const exit = once(owner, "exit"); owner.kill("SIGKILL"); await exit; }
    await delay(100);
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => ready || errors, () => ready.includes("h2a.native-terminal.ready"), "owner ready");
  let writeTimeouts = 0;
  async function connect(path = socketPath, requestTimeoutMs = 1000) {
    const client = await NativeTerminalClient.connect(path, { requestTimeoutMs });
    const write = client.write.bind(client);
    client.write = async (...args) => { try { await write(...args); } catch(error) { if(/timed out/.test(String(error))) writeTimeouts++; throw error; } };
    clients.push(client); return client;
  }
  const admin = await connect(), listenerInode = statSync(socketPath).ino;
  const bytesPath = join(directory, "bytes"), infoPath = join(directory, "info"), sizePath = join(directory, "size");
  writeFileSync(bytesPath, "");
  const program = `const fs=require('node:fs');process.stdin.setRawMode(true);process.stdin.resume();
fs.writeFileSync(${JSON.stringify(infoPath)},JSON.stringify({pid:process.pid}));process.stdout.write('READY\\r\\n');
process.on('SIGWINCH',()=>fs.writeFileSync(${JSON.stringify(sizePath)},JSON.stringify([process.stdout.columns,process.stdout.rows])));
process.stdin.on('data',b=>{fs.appendFileSync(${JSON.stringify(bytesPath)},b);process.stdout.write('ECHO:'+b.toString()+'\\r\\n');if(b.toString().includes('EXIT'))process.exit(23);});`;
  const isolated = { ...process.env } as Record<string,string>;
  for (const [key, leaf] of [["HOME","home"],["XDG_RUNTIME_DIR","rt"],["XDG_CONFIG_HOME","cfg"],["XDG_STATE_HOME","state"],["XDG_CACHE_HOME","cache"]]) {
    isolated[key!] = join(directory, leaf!); mkdirSync(isolated[key!]!, {mode:0o700});
  }
  const expand = (value: string) => value.replaceAll("{DIR}",directory).replaceAll("{HOME}",isolated.HOME!);
  let command = process.execPath, args = ["-e",program];
  // The guardian runs its command as a background job in one containment
  // group. Disable Bash job control, retaining the interactive readline loop.
  if (launch === "bash") { command = "/bin/bash"; args = ["--noprofile","--norc","-i","+m"]; isolated.PS1 = "B5> "; isolated.PROMPT_COMMAND = ""; isolated.HISTFILE = "/dev/null"; }
  else if (launch) {
    command = launch.binary; args = launch.args.map(expand);
    for (const [key,value] of Object.entries(launch.env)) {
      if (["HOME","XDG_RUNTIME_DIR","XDG_CONFIG_HOME","XDG_STATE_HOME","XDG_CACHE_HOME"].includes(key)) throw new Error("cohort cannot override isolated roots");
      isolated[key] = expand(value);
    }
    for (const [path, contents] of Object.entries(launch.homeFiles)) {
      const destination = resolve(isolated.HOME!,path);
      if (!destination.startsWith(isolated.HOME! + "/")) throw new Error("cohort config must stay inside private HOME");
      mkdirSync(dirname(destination), {recursive:true,mode:0o700}); writeFileSync(destination,expand(contents),{mode:0o600});
    }
    accessSync(command,constants.X_OK);
    const version = spawn(command, launch.versionArgs, {env:isolated,cwd:directory,stdio:["ignore","pipe","pipe"]});
    cleanups.push(async()=>{if(version.exitCode===null&&version.signalCode===null){const exit=once(version,"close");version.kill("SIGKILL");await exit;}});
    let actual = "", error = ""; version.stdout!.on("data",chunk=>{actual+=chunk;}); version.stderr!.on("data",chunk=>{error+=chunk;});
    await until(()=>version.exitCode!==null||version.signalCode!==null,Boolean,"version probe exit");
    const code = version.exitCode; expect(code,error).toBe(0); expect(actual.trim()).toBe(launch.version);
  }
  // Record the exec'ed CLI, not the product guardian returned as state.pid.
  // exec preserves this PID and birth; no conversation is relaunched.
  const state = await admin.create({ id:"cli",command:"/bin/bash",args:["--noprofile","--norc","-c",
    "printf '{\"pid\":%s}\\n' \"$$\" > \"$1\"; shift; exec \"$@\"","b5-exec",infoPath,command,...args],
    cwd:directory,env:isolated,cols:80,rows:24 });
  await until(() => existsSync(infoPath),Boolean,"CLI exec receipt");
  const cliPid = JSON.parse(readFileSync(infoPath,"utf8")).pid;
  const cliBirth = readProcessStartTime(cliPid), ownerBirth = readProcessStartTime(owner.pid!);
  expect(cliBirth).toBeDefined(); expect(ownerBirth).toBeDefined();
  appendFileSync(receipts,JSON.stringify({pid:cliPid,birth:cliBirth})+"\n");
  const dist = fileURLToPath(new URL("../../dist/",import.meta.url));
  const next = join(directory,"next"); cpSync(dist,join(next,"dist"),{recursive:true});
  writeFileSync(join(next,"package.json"),JSON.stringify({name:"@sentropic/h2a-runtime",version:"999.0.0",type:"module"}));
  symlinkSync(fileURLToPath(new URL("../../../../node_modules/",import.meta.url)),join(next,"node_modules"),"dir");
  let upgradeResult: Promise<any> | undefined;
  const upgrade = () => {
    upgradeResult ??= requestNativeTerminalOwnerControl(socketPath,owner.pid!,"replace-frontend",{
      frontendModule:join(next,"dist/native-terminal/frontend-process.js"),rollbackModule:join(dist,"native-terminal/frontend-process.js"),
    });
    void upgradeResult.catch(()=>{}); return upgradeResult;
  };
  let frontendPid = (await admin.ping() as any).frontend.pid as number;
  const killFrontend = () => process.kill(frontendPid, "SIGKILL");
  const receivedPath = launch && launch !== "bash" ? resolve(directory,launch.receivedInputFile) : bytesPath;
  const bytes = () => existsSync(receivedPath) ? readFileSync(receivedPath,"utf8") : "";
  let armed: Cut;
  const observedIdentities: unknown[] = [];
  proxy = createServer(down => {
    const up = createConnection(socketPath); sockets.add(down); sockets.add(up);
    down.setEncoding("utf8"); up.setEncoding("utf8");
    let input = "", output = "", droppedId: string | undefined;
    down.on("error", () => {}); up.on("error", () => down.destroy());
    down.on("close", () => { sockets.delete(down); up.destroy(); });
    up.on("close", () => { sockets.delete(up); down.destroy(); });
    down.on("data", chunk => {
      input += chunk;
      for (;;) {
        const end = input.indexOf("\n"); if (end < 0) break;
        const line = input.slice(0, end); input = input.slice(end + 1);
        const request = JSON.parse(line);
        if (request.operation === "write") {
          observedIdentities.push(request.params.writeIdentity);
          const fault = armed; armed = undefined;
          if (fault === "before") { void upgrade(); down.destroy(); up.destroy(); continue; }
          if (fault === "after" || fault === "timeout") {
            droppedId = request.id;
            if (fault === "after") {
              // Observe execution at the CLI before severing the response path.
              void until(async () => launch && launch !== "bash" ? (await admin.readOutput("cli",0)).chunks.map(chunk=>chunk.data).join("").replaceAll("\r","") : bytes(), text => text.includes(launch && launch !== "bash" ? launch.turns[1].output : request.params.data), "executed cut write").then(() => { void upgrade(); down.destroy(); up.destroy(); });
            }
          }
        }
        up.write(line + "\n");
      }
    });
    up.on("data", chunk => {
      output += chunk;
      for (;;) {
        const end = output.indexOf("\n"); if (end < 0) break;
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (JSON.parse(line).id !== droppedId) down.write(line + "\n");
        else if (cut === "timeout") {
          up.removeAllListeners("close");
          void upgrade();
          // Keep the downstream socket open so the write reaches its real client timeout.
        }
      }
    });
  });
  await new Promise<void>(resolve => proxy!.listen(proxyPath, resolve)); chmodSync(proxyPath, 0o600);
  const input = new PassThrough(), output: string[] = [];
  let connected = 0, resize: (() => void) | undefined;
  const stdout = { columns: 80, rows: 24, write: (s: string) => { output.push(s); return true; } };
  const attach = () => {
    const result = runAttach("cli", {
      // Use the fixture's ordinary transport budget for control operations.
      // Only the selected write ACK is withheld; it must still reach the real
      // client's timeout and recover through D21, on both Linux and Darwin.
      connect: async () => { const c = await connect(proxyPath); connected++; return c; },
      stdin: input as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
      now: Date.now, delay: ms => delay(Math.min(ms, 20)), onResize: fn => { resize = fn; }, offResize() {},
    });
    // Keep a failed assertion from leaving an attach loop alive.
    cleanups.push(async () => { input.emit("end"); await result.catch(() => {}); });
    return result;
  };
  async function replacement() {
    return until(async () => {
      try { const c = await connect(); return await c.ping() as any; } catch { return undefined; }
    }, p => Boolean(p && p.frontend.pid !== frontendPid), "replacement frontend").then(p => { frontendPid = p.frontend.pid; return p; });
  }
  return { admin, connect, state, bytes, infoPath, sizePath, input, output, stdout, attach, resize: () => resize?.(),
    cliPid, cliBirth, owner, ownerBirth, killFrontend, replacement, observedIdentities, listenerInode, socketPath, writeTimeouts:()=>writeTimeouts, upgrade, upgraded: async () => { expect((await upgradeResult).status).toBe("switched"); }, connected: () => connected, arm: () => { armed = cut; } };
}


// Conductor-owned enrollment, fixed before this file executes. The binary is
// real; simulated models may provide deterministic dialogues and the receipt
// of the bytes the CLI actually consumed. No availability filter or fallback.
type EnrolledCli = {
  name: string; binary: string; version: string; versionArgs: string[];
  seat: string; platforms: string[]; args: string[]; env: Record<string,string>;
  homeFiles: Record<string,string>; ready: string; receivedInputFile: string;
  turns: [{input:string;output:string},{input:string;output:string},{input:string;output:string}];
  resize: {input:string;output:string}; exit: {input:string;code:number};
};
function enrollment(): EnrolledCli[] {
  const cohort = JSON.parse(process.env.H2A_TEST_PHASE_B_CLIS ?? "[]");
  if (!Array.isArray(cohort) || cohort.length === 0) throw new Error("B5 incomplete: conductor must enroll a nonempty real CLI cohort in H2A_TEST_PHASE_B_CLIS");
  const names = new Set<string>();
  for (const cli of cohort) {
    for (const key of ["name","binary","version","seat","ready","receivedInputFile"]) if (typeof cli[key] !== "string" || !cli[key].length) throw new Error(`B5 invalid enrollment: ${key} required`);
    if (names.has(cli.name)) throw new Error("B5 duplicate member"); names.add(cli.name);
    if (!isAbsolute(cli.binary) || !Array.isArray(cli.versionArgs) || !cli.versionArgs.length || !cli.versionArgs.every((v: unknown)=>typeof v==="string")) throw new Error("B5 requires an absolute executable and version probe");
    if (!Array.isArray(cli.platforms) || !cli.platforms.includes(`${process.platform}/${process.arch}`)) throw new Error(`B5 member unavailable on ${process.platform}/${process.arch}: ${cli.name}`);
    if (!Array.isArray(cli.args) || !cli.args.every((v: unknown)=>typeof v==="string")) throw new Error("B5 args required");
    for (const key of ["env","homeFiles"]) if (!cli[key] || Array.isArray(cli[key]) || typeof cli[key]!=="object" || !Object.values(cli[key]).every(v=>typeof v==="string")) throw new Error(`B5 ${key} must contain string values`);
    if (isAbsolute(cli.receivedInputFile) || cli.receivedInputFile.split("/").includes("..")) throw new Error("B5 receipt must be inside the private scenario directory");
    if (!Array.isArray(cli.turns) || cli.turns.length!==3 || cli.turns.some((t:any,i:number)=>typeof t.input!=="string" || !t.input.includes(`numbered:00${i+1}`) || typeof t.output!=="string" || !t.output.length)) throw new Error("B5 three numbered input/output turns required");
    if (!cli.resize || typeof cli.resize.input!=="string" || !cli.resize.output?.includes("37 109")) throw new Error("B5 resize dialogue must read back 37 109");
    if (!cli.exit || !Number.isInteger(cli.exit.code) || cli.exit.code<0 || cli.exit.code>255 || typeof cli.exit.input!=="string") throw new Error("B5 exact exit dialogue required");
  }
  return cohort;
}
let cohort: EnrolledCli[] = [], enrollmentError: unknown;
try { cohort = enrollment(); } catch (error) { enrollmentError = error; }

async function identities(f: Awaited<ReturnType<typeof fixture>>) {
  const client = await f.connect();
  expect((await client.state("cli")).pid).toBe(f.state.pid);
  expect((await client.ping()).hostPid).toBe(f.owner.pid);
  expect(readProcessStartTime(f.cliPid)).toBe(f.cliBirth);
  expect(readProcessStartTime(f.owner.pid!)).toBe(f.ownerBirth);
}
async function conversation(cut: Exclude<Cut,undefined>, cli?: EnrolledCli) {
  const f = await fixture(cut,cli), attached = f.attach();
  const turns = cli?.turns ?? [1,2,3].map(n=>({input:`numbered:00${n}\n`,output:`ECHO:numbered:00${n}`}));
  await until(()=>f.output.join(""),text=>text.includes(cli?.ready ?? "READY"),"initial response");
  let expected = "";
  for (let index=0;index<turns.length;index++) {
    if(index===1) f.arm();
    const turn = turns[index]!; f.input.write(turn.input); expected += turn.input;
    await until(f.bytes,text=>text===expected,"exact ordered CLI input");
    await until(()=>f.output.join(""),text=>text.includes(turn.output),"CLI response");
    if(index===1) {
      await until(f.connected,n=>n>=2,"attach recovery after D21 cut");
      await f.upgraded(); expect((await f.replacement()).frontend.version).toBe("999.0.0");
      expect(statSync(f.socketPath).ino).toBe(f.listenerInode);
      if(cut==="timeout") expect(f.writeTimeouts()).toBeGreaterThanOrEqual(1);
      const attempts = f.observedIdentities.filter((id:any)=>id.seq===2);
      expect(attempts.length).toBeGreaterThanOrEqual(cut==="before" ? 2 : 1);
      for (const attempt of attempts) expect(attempt).toEqual(attempts[0]);
    }
    await identities(f);
  }
  // A fresh response after recovery and a real ioctl readback on each member.
  if(cli) {
    f.stdout.columns=109;f.stdout.rows=37;f.resize();
    f.input.write(cli.resize.input);expected+=cli.resize.input;
    await until(()=>f.output.join(""),text=>text.includes(cli.resize.output),"real CLI size readback");
  }
  const exit = cli?.exit ?? {input:"EXIT\n",code:23};
  f.input.write(exit.input);expected+=exit.input;
  expect(await attached).toBe(exit.code); expect(f.bytes()).toBe(expected);
  const ids = f.observedIdentities as Array<{seq:number;incarnation:string;controllerEpoch:number}>;
  expect([...new Set(ids.map(id=>id.seq))]).toEqual(cli ? [1,2,3,4,5] : [1,2,3,4]);
  expect(new Set(ids.map(id=>id.incarnation)).size).toBe(1);
  expect(new Set(ids.map(id=>id.controllerEpoch)).size).toBe(1);
}

describe("Phase B agent qualification (B5)", () => {
  it("should preserve a real interactive shell session across a frontend upgrade", async () => {
    const f=await fixture(undefined,"bash"),attached=f.attach();
    await until(()=>f.output.join(""),text=>/bash-[^\n]*[$#] /.test(text)||text.includes("B5> "),"interactive Bash/readline prompt").catch(async error=>{
      let ownedProcess = "identity no longer matches";
      if(readProcessStartTime(f.cliPid)===f.cliBirth) {
        const ps = spawn("/bin/ps",["-p",String(f.cliPid),"-o","pid=,ppid=,pgid=,stat=,comm="],{env:process.env,stdio:["ignore","pipe","pipe"]});
        ownedProcess="";ps.stdout!.on("data",chunk=>{ownedProcess+=chunk;});await once(ps,"close");
      }
      throw new Error(`${error.message}; owned CLI: ${ownedProcess}; session: ${JSON.stringify(await f.admin.state("cli"))}`);
    });
    f.input.write("printf 'B5-BEFORE\\n'\n");
    await until(()=>f.output.join(""),text=>text.replaceAll("\r","").replace(/\x1b\[[0-9;?]*[A-Za-z]/g,"").includes("\nB5-BEFORE\n"),"Bash before replacement");
    await identities(f); expect((await f.upgrade()).status).toBe("switched"); expect((await f.replacement()).frontend.version).toBe("999.0.0");
    expect(statSync(f.socketPath).ino).toBe(f.listenerInode);
    await until(f.connected,n=>n>=2,"Bash attach recovery");
    f.stdout.columns=109;f.stdout.rows=37;f.resize();
    f.input.write("printf 'B5-BAD\\n'\x01\x0bprintf 'B5-AFTER\\n'; printf 'SIZE:'; stty size\n");
    await until(()=>f.output.join(""),text=>text.replaceAll("\r","").replace(/\x1b\[[0-9;?]*[A-Za-z]/g,"").includes("\nB5-AFTER\nSIZE:37 109\n"),"readline edit and resize readback");
    await identities(f); f.input.write("exit 29\n");expect(await attached).toBe(29);
  },20000);

  for (const cut of ["before","after","timeout"] as const) it(`should preserve a scripted agent conversation across a frontend swap with in-flight writes (${cut})`, async()=>{
    await conversation(cut);
  },20000);

  it("should require an explicitly enrolled nonempty real CLI cohort",()=>{
    if(enrollmentError) throw enrollmentError;
    expect(cohort.length).toBeGreaterThan(0);
  });
  for(const cli of cohort) for(const cut of ["before","after","timeout"] as const) it(`should preserve an enrolled real CLI session across a frontend upgrade (${cli.name}, ${cut})`,async()=>{
    if(enrollmentError) throw enrollmentError;
    await conversation(cut,cli);
  },30000);
});
