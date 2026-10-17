import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildH2aRunInvocation, executeH2aRunWithSpawn, handleH2aRun, validateH2aRunRequest, createH2aRunLauncher } from "../dist/runtime/mcp/agent-launch.js";
import { runCli } from "../dist/cli.js";

function workspace(fn) {
  const dir = mkdtempSync(join(process.cwd(), ".agy-workspace-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const request = workspace => ({ profile: "agy", name: "agy-review", workspace, prompt: "challenge this; $(must-not-run)", background: true,
  gateway: "off", headless: true, h2aSidecar: false, model: "claude-opus-5-5-low" });

test("AGY MCP maps max to high in both the model suffix and effort, preserving stdin", () => workspace(dir => {
  const req = validateH2aRunRequest({ ...request(dir), effort: "max", role: "build", allowClaudeBuild: true, outputFile: join(dir,"review.md") }, dir);
  assert.equal(req.effort, "high");
  assert.equal(req.model, "claude-opus-5-5-high");
  const invocation = buildH2aRunInvocation(req);
  assert.equal(invocation.input, req.prompt);
  assert.ok(invocation.args.includes("--allow-claude-build"));
  assert.ok(invocation.args.includes("--output-file"));
  assert.ok(!invocation.args.some(arg => arg.includes(req.prompt)));
}));

test("AGY MCP normalizes bare and max model tokens and refuses unsupported suffixes before launch", () => workspace(dir => {
  for (const family of ["opus", "sonnet"]) {
    const model = `claude-${family}-5-5`;
    assert.equal(validateH2aRunRequest({...request(dir),model,effort:"max"},dir).model,`${model}-high`);
    assert.equal(validateH2aRunRequest({...request(dir),model:`${model}-max`},dir).model,`${model}-high`);
    for (const suffix of ["xhigh","extreme"]) {
      let calls=0;
      const result=handleH2aRun({...request(dir),model:`${model}-${suffix}`},dir,()=>{calls++;});
      assert.equal(result.code,"agy-effort-unsupported");
      assert.equal(calls,0);
    }
  }
}));

test("AGY MCP ignores an old completion when a headless name is reused", () => workspace(dir => {
  const req=validateH2aRunRequest(request(dir),dir);
  const path=join(dir,"result.json");
  const old={kind:"h2a.run.completion",version:1,state:"done",model:req.model,output:{state:"written"}};
  writeFileSync(path,JSON.stringify(old));
  utimesSync(path,new Date(0),new Date(0));
  let calls=0;
  const launch=createH2aRunLauncher(()=>{calls++;return {state:"started",result:{path}};});
  assert.equal(launch(req).state,"started");
  assert.equal(launch(req).state,"started");
  const fresh={kind:"h2a.run.failure",version:1,state:"failed",code:"agy-claude-quota-exhausted",retrySafe:false,model:req.model};
  writeFileSync(path,JSON.stringify(fresh));
  assert.equal(launch(req).code,fresh.code);
  assert.equal(calls,1);
}));

test("AGY MCP preserves a typed non-zero provider completion", () => workspace(dir => {
  const req=validateH2aRunRequest(request(dir),dir);
  const failure={kind:"h2a.run.failure",version:1,state:"failed",code:"agy-process-failed",retrySafe:false,retryable:false,exitCode:7,model:req.model};
  assert.equal(executeH2aRunWithSpawn(req,()=>({status:1,stdout:JSON.stringify(failure),stderr:""})).code,failure.code);
}));

test("AGY MCP rejects the previous result generation even with a future timestamp", () => workspace(dir => {
  const req=validateH2aRunRequest(request(dir),dir);
  const runDir=join(dir,".h2a/runs",req.name);
  mkdirSync(runDir,{recursive:true});
  const path=join(runDir,"result.json");
  const old={kind:"h2a.run.completion",version:1,state:"done",model:req.model};
  writeFileSync(path,JSON.stringify(old));
  utimesSync(path,new Date(Date.now()+60_000),new Date(Date.now()+60_000));
  const launch=createH2aRunLauncher(()=>({state:"started",result:{path}}));
  assert.equal(launch(req).state,"started");
  assert.equal(launch(req).state,"started");
  const fresh={kind:"h2a.run.failure",version:1,state:"failed",code:"agy-claude-quota-exhausted",retrySafe:false,model:req.model};
  writeFileSync(path,JSON.stringify(fresh));
  assert.equal(launch(req).code,fresh.code);
}));

test("AGY MCP refuses xhigh and builds without opt-in before executing", () => workspace(dir => {
  let calls = 0;
  for (const [extra, code] of [[{ effort: "xhigh" }, "agy-effort-unsupported"], [{ role: "build" }, "agy-claude-build-requires-opt-in"]]) {
    const result = handleH2aRun({ ...request(dir), ...extra }, dir, () => { calls++; });
    assert.equal(result.code, code);
  }
  assert.equal(calls, 0);
}));

test("AGY MCP accepts all six Claude models and preserves review and challenge roles", () => workspace(dir => {
  for (const family of ["opus", "sonnet"]) for (const effort of ["low", "medium", "high"]) for (const role of ["review", "challenge"]) {
    const model = `claude-${family}-5-5-${effort}`;
    const req = validateH2aRunRequest({ ...request(dir), model, role, effort }, dir);
    assert.equal(req.model, model);
    assert.equal(req.role, role);
  }
}));

test("AGY MCP rejects a result that reports Argon instead of the launched Claude", () => workspace(dir => {
  const req = validateH2aRunRequest(request(dir),dir);
  const value = { kind:"h2a.run.result", version:1,apiVersion:"h2a.run/v1",runtimeVersion:"0.98.6",ok:true,state:"started",
    session:{id:req.name,tmuxSession:"h2a-agy-review",profile:"agy",workspace:dir,host:"native",mode:"headless",background:true,gateway:"direct",h2aSidecar:false,pid:123,
      model:req.model,modelSource:"launch-argument",effectiveModel:"unknown"},attach:null };
  const run = () => executeH2aRunWithSpawn(req,() => ({ status:0,stdout:JSON.stringify(value),stderr:"" }));
  assert.equal(run().session.model, req.model);
  value.session.model = "gemini-4-argon";
  assert.throws(run,/invalid h2a.run.result/);
}));

test("AGY MCP polls a late quota failure without launching again", () => workspace(dir => {
  const req = validateH2aRunRequest(request(dir),dir);
  const path = join(dir,"result.json");
  let calls = 0;
  const launch = createH2aRunLauncher(() => { calls++; return {state:"started",result:{path}}; });
  assert.equal(launch(req).state,"started");
  const failure = {kind:"h2a.run.failure",version:1,state:"failed",code:"agy-claude-quota-exhausted",retrySafe:false,retryable:false,
    quota:{status:"exhausted",resetsAt:"2026-10-24T03:27:24Z"},output:{state:"missing"}};
  writeFileSync(path,JSON.stringify(failure));
  assert.equal(launch(req).code,failure.code);
  assert.equal(launch(req).output.state,"missing");
  assert.equal(calls,1);
  assert.equal(executeH2aRunWithSpawn(req,()=>({status:1,stdout:JSON.stringify(failure),stderr:""})).code,failure.code);
}));

test("AGY MCP accepts a fast headless completion and refuses a different completion model", () => workspace(dir => {
  const req=validateH2aRunRequest(request(dir),dir);
  const completed={kind:"h2a.run.completion",version:1,state:"done",exitCode:0,model:req.model,
    modelSource:"launch-argument",effectiveModel:req.model,quota:{status:"unknown"},output:{state:"written"}};
  const run=()=>executeH2aRunWithSpawn(req,()=>({status:0,stdout:JSON.stringify(completed),stderr:""}));
  assert.equal(run().model,req.model);
  completed.model="gemini-4-argon";
  assert.throws(run,/invalid h2a.run.result/);
}));

test("AGY doctor exposes only last observed quota, otherwise unknown", async () => {
  const { readAgyClaudeQuotaStatus, writeAgyClaudeQuotaStatus } = await import("../dist/runtime/agy-claude.js");
  workspace(dir => {
  const path=join(dir,"quota.json");
  assert.deepEqual(readAgyClaudeQuotaStatus(path),{status:"unknown"});
  const observation={status:"exhausted",observedAt:"2026-10-17T14:55:00Z",resetsAt:"2026-10-24T03:27:24Z"};
  writeAgyClaudeQuotaStatus(observation);
  let stdout="";
  runCli(["doctor","--root",dir,"--skip-hosts"],{stdout:{write:s=>stdout+=s},stderr:{write:()=>{}},cwd:()=>dir});
  assert.deepEqual(JSON.parse(stdout).agyClaudeQuota,observation);
  });
});

test("AGY CLI refuses xhigh and unapproved builds before consulting a terminal host", () => workspace(dir => {
  for (const [extra,code] of [[["--effort","xhigh"],"agy-effort-unsupported"],[["--role","build"],"agy-claude-build-requires-opt-in"]]) {
    const result=spawnSync(process.execPath,["--input-type=module","-e",
      'import {main} from "./packages/h2a-runtime/dist/index.js"; process.exitCode=await main([process.execPath,"h2a",...process.argv.slice(1)]);',
      "run","agy",dir,"--background","--no-attach","--json","--model","claude-opus-5-5-high",...extra],{
      cwd:process.cwd(),env:{...process.env,HOME:dir,XDG_RUNTIME_DIR:dir,XDG_CONFIG_HOME:dir,XDG_STATE_HOME:dir},encoding:"utf8",timeout:10_000});
    assert.equal(result.status,2,result.stderr);
    assert.equal(JSON.parse(result.stdout).code,code);
    assert.doesNotMatch(result.stderr,/native PTY host|tmux is not installed/);
  }
}));
