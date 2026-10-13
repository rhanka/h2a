// Run only on an isolated umask-022 git-archive copy. Mutants never persist.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const cases={
  "epoch": [
    "handover/ownership.js",
    "token.ownershipEpoch !== observed.value.ownershipEpoch ||",
    "",
    "ownership",
    false
  ],
  "readonly": [
    "local-files/store.ts",
    "if (readOnly) throw new StorageReadonlyError(operation);",
    "if (false) throw new StorageReadonlyError(operation);",
    "writers",
    true
  ],
  "gate": [
    "handover/mutation.js",
    "else if (control.gate !== 'OPEN')",
    "else if (false)",
    "writers",
    true
  ],
  "janitor": [
    "local-files/presence.ts",
    "if (JSON.stringify(current) !== JSON.stringify(expected)) return false;",
    "",
    "writers",
    true
  ],
  "checkpoint": [
    "handover/ownership.js",
    "snapshot.ownershipEpoch !== token.ownershipEpoch ||",
    "",
    "checkpoint",
    false
  ],
  "delivery": [
    "mcp/notifications.ts",
    "if (receipt && receipt.delivered === true) this.markDelivered(produced.sequence);",
    "this.markDelivered(produced.sequence);",
    "checkpoint",
    true
  ],
  "wake-intent": [
    "handover/wake.js",
    "state: 'unknown', result: null }, 'wakeIntent', old)",
    "state: 'intent', result: null }, 'wakeIntent', old)",
    "wake",
    false
  ],
  "wake-replay": [
    "handover/wake.js",
    "['unknown', 'delivered'].includes(v.state)",
    "['delivered'].includes(v.state)",
    "wake",
    false
  ],
  "reservation": [
    "handover/launch-memo.js",
    "replaceState(path, { ...memo, state: 'launching' }, 'launchMemo', observed)",
    "replaceState(path, { ...memo, state: 'reserved' }, 'launchMemo', observed)",
    "launch",
    false
  ],
  "token": [
    "mcp/agent-launch.ts",
    "const launchToken = request.launchAuthority?.token ?? randomUUID();",
    "const launchToken = randomUUID();",
    "cuts",
    true,
    2
  ],
  "arguments": [
    "mcp/agent-launch.ts",
    "if (argumentsByName.get(request.name) !== digest) throw new Error('launch_arguments_conflict');",
    "",
    "cuts",
    true
  ],
  "final-receipt": [
    "handover/launch-memo.js",
    "this.settleCompleted(old.value);",
    "",
    "cuts",
    true
  ],
  "barrier-admission": [
    "handover/ownership.js",
    "if (gate && gate !== 'OPEN')",
    "if (false)",
    "cuts",
    true
  ],
  "presence-target": [
    "handover/mutation.js",
    "else if (owner.presenceSessionId !== sessionId || (instance && owner.expectedInstance !== instance))",
    "else if (false)",
    "cuts",
    true
  ],
  "http-control": [
    "mcp-central.ts",
    "frames.every(frame => frame?.method === 'notifications/cancelled' && !('id' in frame))",
    "true",
    "central",
    true
  ],
  "downstream-version": [
    "mcp-central.ts",
    "attachment.participant.downstreamProtocol = initialized.result.protocolVersion;",
    "",
    "central",
    true
  ]
};
cases['fsync-uncertainty']=['handover/ownership.js',"this.indeterminate = true; this.onIndeterminate?.();","this.onIndeterminate?.();",'ownership',false];
cases['delegation-effect']=['handover/launch-memo.js',"return this.ledger.publishEffect(operation, { type: 'launch-delegation', launchId: memo.launchId,\n      delegation: location.delegation, terminalResult: result });","return digest(result);",'cuts',true];
cases['delegation-recovery']=['handover/launch-memo.js',"this.publishDelegation(memo, memo.terminalResult);","",'cuts',true];
cases['presence-reread']=['local-files/presence.ts',"() => readPresence(args[0], args[1])?.instance","readPresence(args[0], args[1])?.instance",'cuts',true,2];
cases['wake-freshness']=['handover/wake.js',"...old.value, instructionLine, revision:","...old.value, revision:",'wake',false];
cases['reply-lifetime']=['mcp-central.ts',"async (request): Promise<CallToolResult> => participant.call(async () => {\n      for (const session of mcp.sessions.list()) mcp.sessions.markActivity(session.sessionId);\n      return centralToolResult(mcp, request.params.name, request.params.arguments ?? {});\n    })","async (request): Promise<CallToolResult> => {\n      for (const session of mcp.sessions.list()) mcp.sessions.markActivity(session.sessionId);\n      return centralToolResult(mcp, request.params.name, request.params.arguments ?? {});\n    }",'central',true];
const name=process.argv[2],vector=cases[name];if(!vector)throw Error('unknown mutation');
const [leaf,before,after,file,build,count=1]=vector,path='packages/h2a/src/runtime/'+leaf,source=fs.readFileSync(path,'utf8');
if(source.split(before).length!==count+1)throw Error('mutation anchor count');
const compile=()=>{const r=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-b','packages/h2a','--pretty','false'],{stdio:'inherit'});if(r.status!==0)throw Error('mutation compile failed');};
const major=process.versions.node.split('.')[0];
let code;
try{fs.writeFileSync(path,source.replaceAll(before,after));if(build)compile();const r=spawnSync(process.execPath,['scripts/mh-l4-test.mjs','packages/h2a/test/mh-l4-'+file+'.test.js','node'+major+'-mutation-'+name+'-red'],{stdio:'inherit'});code=r.status;}
finally{fs.writeFileSync(path,source);if(build)compile();}
if(code!==1)throw Error('mutation survived or failed abnormally '+code);
const r=spawnSync(process.execPath,['scripts/mh-l4-test.mjs','packages/h2a/test/mh-l4-'+file+'.test.js','node'+major+'-mutation-'+name+'-green'],{stdio:'inherit'});process.exitCode=r.status??1;
