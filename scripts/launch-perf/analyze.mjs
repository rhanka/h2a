import fs from 'node:fs';
import path from 'node:path';
const repo=path.resolve(import.meta.dirname,'../..'),root=repo+'/.qual-tmp/lab/results';
const prefix=process.argv[2]||'g1';
const plan=JSON.parse(fs.readFileSync(repo+'/.qual-tmp/evidence/'+prefix+'-plan.json'));
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const p95=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.ceil(.95*a.length)-1]:null;};
const stat=values=>({n:values.length,p50:median(values),p95:p95(values)});
const groups=new Map();
for(const opts of plan.input.scenarios){
  const key=opts.label.slice(prefix.length+1).replace(/-r\d+$/,'');
  const group=groups.get(key)||{key,sourceSha:opts.sourceSha,cohorts:[],samples:[],refusals:[],scopePeaks:[],pssKiB:[]};groups.set(key,group);
  const file=root+'/'+opts.label+'/result.json';
  if(!fs.existsSync(file)){group.refusals.push({label:opts.label,planned:opts.n,admission:root+'/'+opts.label+'/admission.json',raw:repo+'/.qual-tmp/evidence/'+opts.label+'.log'});continue;}
  const data=JSON.parse(fs.readFileSync(file));
  if(data.sourceSha!==opts.sourceSha)throw new Error('measurement SHA mismatch');
  const events=fs.readFileSync(root+'/'+opts.label+'/events.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));
  const begin=events.find(e=>e.name==='launch_begin')?.at;
  const cohortCompleteMs=Math.max(...events.filter(e=>e.name==='launcher_exit').map(e=>e.at))-begin;
  group.cohorts.push({label:opts.label,raw:file,aborted:data.aborted,failure:data.failure,survivors:data.survivors.length,cohortCompleteMs});
  group.scopePeaks.push(data.memory.peakBytes);group.pssKiB.push((data.memory.pss||[]).reduce((sum,p)=>sum+p.pssKiB,0));
  for(const row of data.results){
    const ok=row.exitCode===0&&!row.error&&!data.aborted&&!data.failure&&data.survivors.length===0;
    const operations=row.nativeOperations||[];
    const timings=row.receipt?.result?.timings;
    // The probe selects the FIRST exact user turn, even if its tools are empty.
    // Selecting a request by tool presence would hide the very failure tested.
    const tools=row.toolsAtFirstMainRequest??null;
    const polls=operations.filter(o=>['capture','probe'].includes(o.operation));
    const maxPolls=polls.reduce((max,o)=>Math.max(max,polls.filter(p=>p.at>=o.at&&p.at<o.at+1000).length),0);
    group.samples.push({label:opts.label,id:row.id,ok,returnMs:row.receiptMs,launchCompleteMs:ok?row.receiptMs:Infinity,
      usableMs:ok&&row.correlatedResponseMs!==null&&row.correlatedResponseMs!==undefined&&row.requiredToolsReadyMs!==null&&row.requiredToolsReadyMs!==undefined?
        Math.max(row.receiptMs,row.correlatedResponseMs,row.requiredToolsReadyMs):null,
      legacyUsableMs:row.usableMs??null,
      lastProofToResultMs:row.lastProofToResultMs,dispatchToResultMs:row.dispatchToResultMs,firstResponseMs:row.correlatedResponseMs,
      visibleResponseMs:row.answerMs,
      toolsAtFirstMainRequest:tools,completePublications:row.publications?.filter(p=>p.state==='started').every(p=>p.completeResult)??null,
      enters:operations.filter(o=>o.operation==='enter').length,operations:operations.length,maxPolls,
      state:row.receipt?.result?.state??row.cliResult?.state??(ok?'started':'failed'),
      admissionRefused:row.cliResult?.state==='not-started'&&/memory|capacity|reservation/i.test(row.cliResult.error??''),timings});
  }
}
const output=[...groups.values()].map(group=>({...group,summary:{requests:group.samples.length,
  plannedRequests:group.samples.length+group.refusals.reduce((sum,r)=>sum+r.planned,0),
  refusedBeforeProbe:group.refusals.reduce((sum,r)=>sum+r.planned,0),successes:group.samples.filter(s=>s.ok).length,
  launchComplete:stat(group.samples.map(s=>s.launchCompleteMs)),returns:stat(group.samples.map(s=>s.returnMs)),
  usable:stat(group.samples.flatMap(s=>s.usableMs!==null?[s.usableMs]:[])),
  legacyUsable:stat(group.samples.flatMap(s=>s.legacyUsableMs!==null?[s.legacyUsableMs]:[])),
  lastProof:stat(group.samples.flatMap(s=>s.ok&&s.lastProofToResultMs!==null?[s.lastProofToResultMs]:[])),
  firstResponse:stat(group.samples.flatMap(s=>s.firstResponseMs!==null&&s.firstResponseMs!==undefined?[s.firstResponseMs]:[])),
  underBudget:group.samples.filter(s=>s.ok&&s.launchCompleteMs<=(group.key.includes('n9')?9000:8000)).length,
  errors:group.samples.filter(s=>!s.ok).length,cliAdmissionRefusals:group.samples.filter(s=>s.admissionRefused).length,
  unconfirmed:group.samples.filter(s=>s.state==='launch-unconfirmed').length,
  falseSuccesses:group.samples.filter(s=>s.ok&&(s.toolsAtFirstMainRequest===false||s.completePublications===false||s.enters>1)).length,
  maxPolls:Math.max(0,...group.samples.map(s=>s.maxPolls))}}));
fs.writeFileSync(repo+'/.qual-tmp/evidence/'+prefix+'-analysis.json',JSON.stringify({plan:repo+'/.qual-tmp/evidence/'+prefix+'-plan.json',groups:output},(_key,value)=>value===Infinity?'EXCEEDANCE':value,2));
for(const row of output)console.log(JSON.stringify({key:row.key,sha:row.sourceSha,summary:row.summary,refusedCohorts:row.refusals.length}));
