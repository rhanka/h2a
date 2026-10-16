import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QualificationBudget, VIBE_QUALIFICATION_PLAN } from '../scripts/qualification-budget.mjs';
import { qualifyVibe, nativeStats } from '../scripts/qualification-vibe.mjs';
import { qualifyVibeProbe } from '../scripts/qualification-probe.mjs';
function lane(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'native-pilot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
test('phase continuation rejects duplicate, missing, negative or over-allocation accounting and retains the elapsed watchdog', () => {
  const entries = VIBE_QUALIFICATION_PLAN.filter(e => e.phase === 1).map(e => ({ id: e.id, iterations: 2, price: 0.01 }));
  for (const bad of [[...entries, entries[0]], entries.slice(1), entries.map(e => ({ ...e, price: -1 })), entries.map(e => ({ ...e, price: 0.2 })), entries.map(e => ({ ...e, iterations: -1 }))])
    assert.throws(() => new QualificationBudget().restorePhase1(bad, 100), /accounting/);
  for (const bad of [-1, NaN, 450000]) assert.throws(() => new QualificationBudget().restorePhase1(entries, bad), /accounting/);
  const budget = new QualificationBudget(undefined, () => 300000); budget.restorePhase1(entries, 200000);
  assert.equal(budget.remaining(), 250000);
  assert.throws(() => nativeStats({ steps: 1, sessionPromptTokens: 1, sessionCompletionTokens: 0, sessionCachedTokens: 2, inputPricePerMillion: 1, outputPricePerMillion: 1 }), /accounting/);
});
test('native adapter drives two isolated sessions, consumes history patches, accounts model calls and deletes only its sessions', async t => {
  const dir = lane(t), stub = join(dir, 'app.mjs'), log = join(dir, 'calls.jsonl');
  const resources = [{ path: join(dir, 'assets/help.md'), bytes: 'required resource' }];
  fs.writeFileSync(stub, `import fs from 'node:fs';import readline from 'node:readline';
const sessions=new Map();let next=0;const out=m=>console.log(JSON.stringify(m));const resources=${JSON.stringify(resources)};
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line),p=m.params??{};fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method,params:p})+'\\n');if(!m.id)continue;let result={};
 if(m.method==='initialize')result={serverInfo:{version:'2.26.1'}};
 if(m.method==='session/start'){const id='session-'+(++next);sessions.set(id,{id,cwd:p.agentConfig.cwd,parentSessionId:null});result={state:{session:sessions.get(id)}};}
 if(m.method==='skills/list')result={skills:[{name:'h2a',enabled:true,source:'local'},{name:'track-operation',enabled:true,source:'local'}]};
 if(m.method==='runtime/read')result={runtime:{tools:[{name:'read_file'},{name:'h2a_identity_status'}]}};
 if(m.method==='turn/start'){
  result={turn:{id:'turn-'+p.sessionId}};const sid=p.sessionId,cwd=sessions.get(sid).cwd;
  const entries=[{id:'resource',type:'effect',sessionId:sid,detail:{input:{path:resources[0].path}},state:{status:'running'}},
   {id:'identity',type:'effect',sessionId:sid,detail:{toolName:'h2a_identity_status'},state:{status:'completed',output:{root:${JSON.stringify(join(dir,'bus'))}}}},
   {id:'open',type:'effect',sessionId:sid,detail:{toolName:'h2a_session_open'},state:{status:'completed',output:{session:{sessionId:'h2a-'+sid}}}},
   {id:'track',type:'effect',sessionId:sid,detail:{toolName:'track_status'},state:{status:'completed',output:{workspaceRoot:cwd}}}];
  for(const entry of entries)out({method:'history/entryAdded',params:{sessionId:sid,entry}});
  out({method:'history/entryUpdated',params:{sessionId:sid,entryId:'resource',patch:[{op:'replace',path:'/state',value:{status:'completed',output:{content:resources[0].bytes}}}]}});
  out({method:'turn/completed',params:{sessionId:sid,turn:{id:result.turn.id,status:'completed'}}});
 }
 if(m.method==='stats/read')result={stats:{steps:2,sessionPromptTokens:10,sessionCompletionTokens:10,sessionCachedTokens:0,inputPricePerMillion:1,outputPricePerMillion:1}};
 if(m.method==='session/read')result={state:{session:sessions.get(p.sessionId),childSessions:[]}};
 out({jsonrpc:'2.0',id:m.id,result});
}`);
  const cleanup = { sessions: [], deleted: [], incomplete: false }, budget = new QualificationBudget();
  const workspaces = [join(dir, 'a'), join(dir, 'b')]; workspaces.forEach(p => fs.mkdirSync(p));
  const result = await qualifyVibe({ command: process.execPath, args: [stub], env: process.env, workspaces, busRoot: join(dir, 'bus'), phase: 1, budget, evidence: [], cleanup, components: ['skills', 'MCP', 'context'], requiredResources: resources });
  assert.equal(result.skills, 'observed'); assert.equal(result.MCP, 'observed'); assert.equal(result.context, 'observed');
  assert.equal(cleanup.incomplete, false); assert.deepEqual(cleanup.deleted.sort(), ['session-1','session-2']);
  assert.equal(budget.executions.get('phase1-a').iterations, 2);
  const calls = fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(c => c.method==='session/start').length, 2);
  assert.ok(calls.filter(c => c.method==='session/delete').every(c => cleanup.sessions.includes(c.params.sessionId)));
});
test('failed CLI probe captures emitted session IDs and retains unknown cleanup', async t => {
  const dir = lane(t), stub = join(dir, 'cli.mjs'), server = join(dir, 'server.mjs');
  fs.writeFileSync(stub, "console.log(JSON.stringify({sessionId:'probe-own',type:'message'}));process.exitCode=1;");
  fs.writeFileSync(server, "import readline from 'node:readline';for await(const l of readline.createInterface({input:process.stdin})){const m=JSON.parse(l);if(m.id)console.log(JSON.stringify({id:m.id,result:{}}));}");
  const cleanup = { sessions: [], deleted: [], incomplete: false };
  await assert.rejects(qualifyVibeProbe({ command: process.execPath, commandArgs: [stub], appServer: process.execPath, appServerArgs: [server], cwd: dir, env: process.env, tools: ['read_file'], budget: new QualificationBudget(), evidence: [], cleanup, directory: dir }), /incomplete/);
  assert.deepEqual(cleanup.sessions, ['probe-own']); assert.deepEqual(cleanup.deleted, ['probe-own']);
  const other = join(dir,'unknown'); fs.mkdirSync(other);fs.writeFileSync(stub, 'process.exitCode=1;');
  const unknown = { sessions: [], deleted: [], incomplete: false };
  await assert.rejects(qualifyVibeProbe({ command: process.execPath, commandArgs: [stub], cwd: dir, env: process.env, tools: ['read_file'], budget: new QualificationBudget(), evidence: [], cleanup: unknown, directory: other }), /incomplete/);
  assert.equal(unknown.incomplete, true); assert.deepEqual(unknown.sessions, []);
});
test('corrected phase 2 forks before delegation and observes three calls per origin and copy including the child', async t => {
  const dir = lane(t), stub = join(dir, 'phase2.mjs'), log = join(dir, 'calls.jsonl');
  fs.writeFileSync(stub, `import fs from 'node:fs';import readline from 'node:readline';
const out=m=>console.log(JSON.stringify(m));const emit=(sid,entry)=>out({method:'history/entryAdded',params:{sessionId:sid,entry:{...entry,sessionId:sid}}});let cwd;
for await(const line of readline.createInterface({input:process.stdin})){
 const m=JSON.parse(line),p=m.params??{};fs.appendFileSync(${JSON.stringify(log)},m.method+'\\n');if(!m.id)continue;let result={};
 if(m.method==='initialize')result={serverInfo:{version:'2.26.1'}};
 if(m.method==='session/start'){cwd=p.agentConfig.cwd;result={state:{session:{id:'origin',cwd,parentSessionId:null}}};}
 if(m.method==='session/fork'){if(p.attach!==false)throw Error('copy attached');result={state:{session:{id:'copy',cwd,parentSessionId:'origin'}}};}
 if(m.method==='turn/start'){
  const sid=p.sessionId;result={turn:{id:'turn-'+sid}};
  if(sid==='origin'){
   out({method:'session/updated',params:{sessionId:sid,childSession:{id:'child',status:{type:'idle'}}}});
   emit(sid,{id:'delegate',type:'effect',detail:{kind:'subagent'},state:{status:'completed'}});
   emit(sid,{id:'parent-start',type:'notice',detail:{kind:'hook_run_started',scope:'post_agent'}});
   emit(sid,{id:'parent-end',type:'notice',detail:{kind:'hook_run_completed',scope:'post_agent'}});
  }else{
   emit(sid,{id:'allow',type:'effect',detail:{input:{command:'printf vibe-guard-ok'}},state:{status:'completed'}});
   emit(sid,{id:'deny',type:'effect',detail:{input:{command:'h2a --version'}},state:{status:'failed'}});
   for(const kind of ['hook_run_started','hook_run_completed'])emit(sid,{id:kind,type:'notice',detail:{kind,scope:'pre_tool',toolCallId:'allow'}});
   emit(sid,{id:'refused',type:'notice',detail:{kind:'hook_completed',scope:'pre_tool',toolCallId:'deny',hookName:'sentropic-h2a-deny-manual-cli',status:'error'}});
  }
  out({method:'turn/completed',params:{sessionId:sid,turn:{id:result.turn.id,status:'completed'}}});
 }
 if(m.method==='stats/read')result={stats:{steps:p.sessionId==='origin'?2:p.sessionId==='child'?1:3,sessionPromptTokens:1,sessionCompletionTokens:1,sessionCachedTokens:0,inputPricePerMillion:1,outputPricePerMillion:1}};
 if(m.method==='session/read')result={state:{childSessions:p.sessionId==='origin'?[{id:'child'}]:[]}};
 out({id:m.id,result});
}`);
  const workspaces = [join(dir,'a'),join(dir,'b')]; workspaces.forEach(p=>fs.mkdirSync(p));
  const budget = new QualificationBudget(), cleanup = { sessions:[],deleted:[],incomplete:false }; let snapshots=0;
  const recorded = { own: { stoppedAt: new Date(Date.now()+30000).toISOString() }, others: { untouched:true } };
  const result = await qualifyVibe({ command:process.execPath,args:[stub],env:process.env,workspaces,busRoot:join(dir,'bus'),phase:2,budget,evidence:[],cleanup,components:['guard','lifecycle'],
    recordSnapshot:()=>++snapshots<=3?{own:undefined,others:{untouched:true}}:recorded });
  assert.equal(result.guard,'observed'); assert.equal(result.lifecycle,'observed');
  assert.equal(budget.executions.get('phase2-origin').iterations,3);assert.equal(budget.executions.get('phase2-copy').iterations,3);
  assert.equal(cleanup.incomplete,false);assert.deepEqual(cleanup.deleted.sort(),['child','copy','origin']);
  const calls=fs.readFileSync(log,'utf8').trim().split('\n');assert.ok(calls.indexOf('session/fork')<calls.indexOf('turn/start'));
});
