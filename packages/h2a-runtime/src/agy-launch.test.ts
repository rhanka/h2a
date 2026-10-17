import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  start: vi.fn(), headless: vi.fn(), pid: vi.fn(), stop: vi.fn(), complete: vi.fn(),
  delivery: vi.fn(),
}));
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return {...fs, readFileSync: (path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) =>
    path === 0 ? "review witness" : (fs.readFileSync as Function)(path,...args)};
});
vi.mock("./central-mcp.js", () => ({ prepareCentralMcpForLaunch: vi.fn() }));
vi.mock("./launch-guard.js", () => ({ startLaunchGuard: () => ({ stop: fake.stop, complete: fake.complete }) }));
vi.mock("./registry.js", async original => ({...await original<object>(), enrollFromRun: vi.fn()}));
vi.mock("./prompt-delivery.js", async original => ({...await original<object>(), deliverInitialPrompt: fake.delivery}));
vi.mock("./tmux.js", async original => ({
  ...await original<object>(), tmuxAvailable: () => true, existingLocalSessionSlugs: () => [],
  ensureManagedTmuxProfile: () => {}, startLocalSession: fake.start, startHeadlessSession: fake.headless,
  localSessionPanePid: fake.pid, paneWorkerPid: () => undefined, killLocalSession: fake.stop,
}));
vi.mock("./native-host.js", async original => ({
  ...await original<object>(), nativeHostAvailable: () => ({ok:true}), preflightNativeLaunch: () => {},
  nativeSessionState: () => ({state:"missing"}), startNativeSession: fake.start,
  startNativeHeadlessSession: fake.headless, nativeSessionPid: fake.pid, nativeWorkerPid: () => undefined,
  killNativeSessionTree: fake.stop,
}));
// Fail closed if a future wiring change attempts a real provider, host or process probe.
vi.mock("node:child_process", async original => ({...await original<object>(),
  spawnSync: (command: string) => { throw new Error(`unexpected real process: ${command}`); },
}));

const { main } = await import("./index.js");
const diagnostic='AGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h."}';
let dir: string;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  dir=mkdtempSync(join(tmpdir(),"agy-launch-"));
  for(const key of ["HOME","XDG_RUNTIME_DIR","XDG_STATE_HOME","XDG_CONFIG_HOME","REMOTE_CLI_CONFIG_HOME","H2A_ROOT"]) vi.stubEnv(key,dir);
  fake.start.mockReset().mockReturnValue({name:"h2a-agy-review",slug:"agy-review",agentPane:"%1"});
  fake.headless.mockReset().mockReturnValue({name:"h2a-agy-review",slug:"agy-review",agentPane:"%1"});
  fake.pid.mockReset().mockReturnValue(process.pid);
  fake.stop.mockReset().mockReturnValue(true);
  fake.complete.mockReset();
  fake.delivery.mockReset().mockReturnValue({state:"provider-blocked",reason:"quota",capture:diagnostic,waitedMs:1,evidence:"composer-text"});
  stdout=vi.spyOn(process.stdout,"write").mockImplementation(()=>true);
  stderr=vi.spyOn(process.stderr,"write").mockImplementation(()=>true);
  process.exitCode=0;
});
afterEach(() => {
  stdout.mockRestore(); stderr.mockRestore(); vi.unstubAllEnvs();
  process.exitCode=0;
  rmSync(dir,{recursive:true,force:true});
});
async function launch(host: string, headless = false) {
  vi.stubEnv("H2A_SESSION_HOST",host);
  await main([process.execPath,"h2a","run","agy",dir,"--name","agy-review","--model","claude-opus-5-5-high",
    "--prompt-stdin","--background","--no-attach","--no-h2a","--no-gw","--json",...(headless?["--headless"]:[])]);
  return JSON.parse(stdout.mock.calls.map(call=>String(call[0])).join(""));
}
describe.each(["native","tmux"])("AGY launch on a fake %s host", host => {
  it("returns the interactive quota and persists its absolute reset", async () => {
    const result=await launch(host);
    expect(result.code).toBe("agy-claude-quota-exhausted");
    expect(result.resetsAt).toBeTypeOf("string");
    expect(JSON.parse(readFileSync(join(dir,"h2a/agy-claude-quota.json"),"utf8")).resetsAt).toBe(result.resetsAt);
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
  it("removes the previous result before handing off the new headless launch", async () => {
    const path=join(dir,".h2a/runs/agy-review/result.json");
    mkdirSync(join(dir,".h2a/runs/agy-review"),{recursive:true});
    writeFileSync(path,JSON.stringify({kind:"h2a.run.completion",state:"done"}));
    // Even a recent or future timestamp cannot identify the previous generation.
    fake.headless.mockImplementation(() => {
      expect(existsSync(path)).toBe(false);
      return {name:"h2a-agy-review",slug:"agy-review",agentPane:"%1"};
    });
    expect((await launch(host,true)).state).toBe("started");
  });
  it("returns a typed completion published during the post-launch PID probe", async () => {
    const completed={kind:"h2a.run.failure",version:1,state:"failed",code:"agy-claude-quota-exhausted",retrySafe:false,
      retryable:false,resetsAt:"2026-10-24T03:27:24Z",model:"claude-opus-5-5-high"};
    fake.pid.mockImplementation(() => {
      writeFileSync(join(dir,".h2a/runs/agy-review/result.json"),JSON.stringify(completed));
      return undefined;
    });
    const result=await launch(host,true);
    expect(result.code).toBe(completed.code);
    expect(result.resetsAt).toBe(completed.resetsAt);
    expect(fake.stop).not.toHaveBeenCalled();
  });
});
