import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, appendFileSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ContentFence } from "./session-content-fence.js";
describe("durable native content fence", () => {
  it("should retain denial and consumed proofs across native restarts", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      let f = new ContentFence(root);
      const revision = f.revision("scope");
      f.consume("scope", revision, "challenge", "a".repeat(64));
      f = new ContentFence(root);
      expect(() => f.consume("scope", revision, "challenge", "a".repeat(64))).toThrow();
      f.deny("scope");
      f = new ContentFence(root);
      expect(f.denied("scope")).toBe(true);
      expect(() => f.consume("scope", revision, "other", "b".repeat(64))).toThrow();
      const cleared = f.clear("scope");
      expect(f.denied("scope")).toBe(false);
      expect(() => f.consume("scope", revision, "other", "b".repeat(64))).toThrow();
      f.consume("scope", cleared, "other", "b".repeat(64));
      expect(readFileSync(join(root, "proofs.jsonl"), "utf8")).not.toContain(':"challenge"');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("should let exclusion win against stale async acceptance and independent fence instances", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      const a = new ContentFence(root), b = new ContentFence(root);
      const old = a.revision("scope"); b.deny("scope");
      expect(() => a.consume("scope", old, "pending", "a".repeat(64))).toThrow();
      expect(a.denied("scope")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("should refuse corrupt or uncertain proof journals while keeping durable denial available", () => {
    const root = mkdtempSync(join(tmpdir(), "f2-fence-"));
    try {
      const f = new ContentFence(root);
      appendFileSync(join(root, "proofs.jsonl"), '{"partial":');
      expect(() => f.consume("scope", 0, "pending", "a".repeat(64))).toThrow();
      f.deny("scope");
      expect(new ContentFence(root).denied("scope")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

it('should recover an abandoned lock without losing denial floors or consumed proofs',()=>{
  const root=mkdtempSync(join(tmpdir(),'f2-crash-'));
  try{const first=new ContentFence(root);first.consume('scope',0,'used','a'.repeat(64));first.deny('old');
    writeFileSync(join(root,'.fence-lock'),'',{mode:0o600});const restarted=new ContentFence(root);
    expect(()=>restarted.deny('scope')).not.toThrow();expect(restarted.denied('old')).toBe(true);
    const revision=restarted.clear('scope');expect(()=>restarted.consume('scope',revision,'used','a'.repeat(64))).toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('should exclude concurrent writers even with an old lock and recover after the owned holder is killed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'f2-lock-')),fence=new ContentFence(root);
 const child=spawn(process.execPath,['-e',"const fs=require('node:fs'),cp=require('node:child_process');const fd=fs.openSync(process.argv[1],'a+',0o600);const r=cp.spawnSync('flock',['-x','3'],{stdio:['ignore','ignore','ignore',fd]});if(r.status!==0)process.exit(1);process.stdout.write('locked');setInterval(()=>{},1000);",join(root,'.fence-lock')],{stdio:['ignore','pipe','pipe']});
 const exit=once(child,'exit');
 try{await once(child.stdout!,'data');utimesSync(join(root,'.fence-lock'),new Date(0),new Date(0));
   expect(()=>fence.deny('scope')).toThrow('resource_busy');child.kill('SIGKILL');await exit;
   expect(()=>fence.deny('scope')).not.toThrow();expect(new ContentFence(root).denied('scope')).toBe(true);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}rmSync(root,{recursive:true,force:true});}
});
