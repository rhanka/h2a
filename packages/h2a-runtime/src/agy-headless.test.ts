import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const quota = 'AGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 156h32m24s.","status":"RESOURCE_EXHAUSTED","error_code":429,"code_kind":"http","retryable":true}';

describe("AGY Claude run-once supervisor with an offline binary", () => {
  it("retains a split quota diagnostic when stdout arrives between stderr chunks", () => {
    const dir=mkdtempSync(join(tmpdir(),"agy-split-"));
    try {
      const split=quota.indexOf("156h")+4;
      writeFileSync(join(dir,"prompt"),"review this");
      writeFileSync(join(dir,"fake.mjs"),`process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(quota.slice(0,split))});setTimeout(()=>{process.stdout.write('working\\n');setTimeout(()=>{process.stderr.write(${JSON.stringify(quota.slice(split)+"\n")});},20);},20);});`);
      const child=spawnSync(process.execPath,[fileURLToPath(new URL("../dist/agy-headless.js", import.meta.url)),
        join(dir,"result.json"),join(dir,"output.log"),join(dir,"prompt"),"claude-opus-5-5-high","",process.execPath,join(dir,"fake.mjs")],{
        env:{...process.env,HOME:dir,XDG_RUNTIME_DIR:dir,XDG_STATE_HOME:join(dir,"state")},encoding:"utf8",timeout:10_000});
      const result=JSON.parse(readFileSync(join(dir,"result.json"),"utf8"));
      expect(result.code).toBe("agy-claude-quota-exhausted");
      expect(result.quota.resetsAt).toBeTypeOf("string");
      expect(child.status,child.stderr).toBe(1);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it.each([
    ["written", "claude-sonnet-5-5-medium", undefined],
    ["missing", "claude-sonnet-5-5-medium", "agy-output-missing"],
    ["unchanged", "claude-sonnet-5-5-medium", "agy-output-missing"],
    ["written", "gemini-4-argon", "agy-model-mismatch"],
  ])("reports output=%s and observed model=%s", (outputState, reportedModel, code) => {
    const dir=mkdtempSync(join(tmpdir(),"agy-completion-"));
    try {
      const artifact=join(dir,"review.md");
      if(outputState==="unchanged") writeFileSync(artifact,"old review");
      writeFileSync(join(dir,"prompt"),"challenge this");
      writeFileSync(join(dir,"fake.mjs"),`import fs from 'node:fs'; process.stdin.resume(); process.stdin.on('end',()=>{${outputState==="written"?`fs.writeFileSync(${JSON.stringify(artifact)},'review');`:""} console.log(JSON.stringify({model:${JSON.stringify(reportedModel)}}));});`);
      const child=spawnSync(process.execPath,[fileURLToPath(new URL("../dist/agy-headless.js", import.meta.url)),
        join(dir,"result.json"),join(dir,"output.log"),join(dir,"prompt"),"claude-sonnet-5-5-medium",artifact,process.execPath,join(dir,"fake.mjs")],{
        env:{...process.env,HOME:dir,XDG_RUNTIME_DIR:dir,XDG_STATE_HOME:join(dir,"state")},encoding:"utf8",timeout:10_000});
      expect(child.status,child.stderr).toBe(code?1:0);
      const result=JSON.parse(readFileSync(join(dir,"result.json"),"utf8"));
      expect(result.code).toBe(code);
      expect(result.output.state).toBe(outputState);
      expect(result.effectiveModel).toBe(reportedModel);
      expect(result.quota).toEqual({status:"unknown"});
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  it.each([0, 1])("returns quota-exhausted on provider exit %i with missing output and no fallback", exit => {
    const dir = mkdtempSync(join(tmpdir(), "agy-quota-"));
    try {
      const prompt = "challenge the design; $(must-not-run)";
      writeFileSync(join(dir, "prompt"), prompt, { mode: 0o600 });
      writeFileSync(join(dir, "fake.mjs"), `import fs from 'node:fs'; let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(join(dir,"seen.json"))},JSON.stringify({args:process.argv.slice(2),input})); console.error(${JSON.stringify(quota)}); process.exit(${exit});});`);
      const before = Date.now();
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/agy-headless.js", import.meta.url)),
        join(dir, "result.json"), join(dir, "output.log"), join(dir, "prompt"), "claude-opus-5-5-high", join(dir,"review.md"),
        process.execPath, join(dir,"fake.mjs"), "--model", "claude-opus-5-5-high"], {
        env: { ...process.env, XDG_STATE_HOME: join(dir,"state"), XDG_RUNTIME_DIR: dir, HOME: dir }, encoding: "utf8", timeout: 10_000 });
      expect(child.status, child.stderr).toBe(1);
      const result = JSON.parse(readFileSync(join(dir,"result.json"),"utf8"));
      expect(result.code).toBe("agy-claude-quota-exhausted");
      expect(result.exitCode).toBe(exit);
      expect(result.output).toEqual({ path: join(dir,"review.md"), state: "missing" });
      expect(result.retryable).toBe(false);
      expect(result.retrySafe).toBe(false);
      const reset = Date.parse(result.resetsAt);
      const duration = (156*3600+32*60+24)*1000;
      expect(reset).toBeGreaterThanOrEqual(before+duration);
      expect(reset).toBeLessThanOrEqual(Date.now()+duration);
      expect(result.quota.resetsAt).toBe(result.resetsAt);
      expect(JSON.parse(readFileSync(join(dir,"state/h2a/agy-claude-quota.json"),"utf8"))).toEqual(result.quota);
      expect(result.model).toBe("claude-opus-5-5-high");
      expect(result.effectiveModel).toBe("unknown");
      expect(JSON.parse(readFileSync(join(dir,"seen.json"),"utf8"))).toEqual({ args:["--model","claude-opus-5-5-high"],input:prompt });
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
