import fs from 'node:fs';
import path from 'node:path';
const repo=path.resolve(import.meta.dirname,'../..'),root=repo+'/.qual-tmp/lab/results';
const plan=JSON.parse(fs.readFileSync(repo+'/.qual-tmp/evidence/g1-plan.json'));
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const p95=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.ceil(.95*a.length)-1]:null;};
const stat=values=>({n:values.length,p50:median(values),p95:p95(values)});
const groups=new Map();
for(const opts of plan.input.scenarios){
  const key=opts.label.replace(/^g1-/,'').replace(/-r\d+$/,'');
  const group=groups.get(key)||{key,sourceSha:opts.sourceSha,cohorts:[],samples:[],refusals:[],scopePeaks:[],pssKiB:[]};groups.set(key,group);
  const file=root+'/'+opts.label+'/result.json';
  if(!fs.existsSync(file)){group.refusals.push({label:opts.label,planned:opts.n,admission:root+'/'+opts.label+'/admission.json',raw:repo+'/.qual-tmp/evidence/'+opts.label+'.log'});continue;}
  const data=JSON.parse(fs.readFileSync(file));
  if(data.sourceSha!==opts.sourceSha)throw new Error('measurement SHA mismatch');
  group.cohorts.push({label:opts.label,raw:file,aborted:data.aborted,failure:data.failure,survivors:data.survivors.length});
  group.scopePeaks.push(data.memory.peakBytes);group.pssKiB.push((data.memory.pss||[]).reduce((sum,p)=>sum+p.pssKiB,0));
  for(const row of data.results){
    const ok=row.exitCode===0&&!row.error&&!data.aborted&&!data.failure&&data.survivors.length===0;
    const operations=row.nativeOperations||[];
    const timings=row.receipt?.result?.timings;
    const requests=data.stubRequests.flatMap(q=>{try{const d=JSON.parse(q.body);return[{...q,body:d,conversation:JSON.parse(d.metadata?.user_id||'{}').session_id}]}catch{return[]}}).filter(q=>q.conversation===row.receipt?.conversationId&&q.body.tools?.some(t=>t.name.startsWith('mcp__h2a__')));
    const first=requests[0];
    const tools=first?['h2a','playwright'].every(server=>first.body.tools.some(t=>t.name.startsWith('mcp__'+server+'__'))):null;
    const phase=timings?.composerReadyMs;
    const polls=operations.filter(o=>['capture','probe'].includes(o.operation)&&phase!==undefined&&o.at>=phase);
    const maxPolls=polls.reduce((max,o)=>Math.max(max,polls.filter(p=>p.at>=o.at&&p.at<o.at+1000).length),0);
    group.samples.push({label:opts.label,id:row.id,ok,returnMs:row.receiptMs,launchCompleteMs:ok?row.receiptMs:Infinity,
      usableMs:ok?Math.max(row.receiptMs,row.answerMs||0,row.mcpReadyMs||0):Infinity,
      lastProofToResultMs:row.lastProofToResultMs,dispatchToResultMs:row.dispatchToResultMs,firstResponseMs:row.answerMs,
      toolsAtFirstMainRequest:tools,enters:operations.filter(o=>o.operation==='enter').length,operations:operations.length,maxPolls,
      state:row.receipt?.result?.state??(ok?'started':'failed'),timings});
  }
}
const output=[...groups.values()].map(group=>({...group,summary:{requests:group.samples.length,successes:group.samples.filter(s=>s.ok).length,
  launchComplete:stat(group.samples.map(s=>s.launchCompleteMs)),returns:stat(group.samples.map(s=>s.returnMs)),usable:stat(group.samples.map(s=>s.usableMs)),
  lastProof:stat(group.samples.flatMap(s=>s.ok&&s.lastProofToResultMs!==null?[s.lastProofToResultMs]:[])),
  firstResponse:stat(group.samples.flatMap(s=>s.firstResponseMs!==undefined?[s.firstResponseMs]:[])),
  underBudget:group.samples.filter(s=>s.ok&&s.launchCompleteMs<=(group.key.includes('n9')?9000:8000)).length,
  errors:group.samples.filter(s=>!s.ok).length,unconfirmed:group.samples.filter(s=>s.state==='launch-unconfirmed').length,
  falseSuccesses:group.samples.filter(s=>s.ok&&(s.toolsAtFirstMainRequest===false||s.enters>1)).length,
  maxPolls:Math.max(0,...group.samples.map(s=>s.maxPolls))}}));
fs.writeFileSync(repo+'/.qual-tmp/evidence/g1-analysis.json',JSON.stringify({plan:repo+'/.qual-tmp/evidence/g1-plan.json',groups:output},(_key,value)=>value===Infinity?'EXCEEDANCE':value,2));
for(const row of output)console.log(JSON.stringify({key:row.key,sha:row.sourceSha,summary:row.summary,refusedCohorts:row.refusals.length}));
