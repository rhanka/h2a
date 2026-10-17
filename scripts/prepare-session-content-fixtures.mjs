/** Synthetic, preparatory contract capsule. Never a deployed fixture-lock or provider qualification.
 * Run deliberately when changing the contract; ordinary builds only verify/copy pinned bytes.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../packages/h2a-runtime/src/fixtures/session-content/v2/', import.meta.url));
mkdirSync(root, {recursive:true});
const str = {type:'string',minLength:1,maxLength:256};
const hash = {type:'string',pattern:'^[a-f0-9]{64}$'};
const num = {type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const bool = {type:'boolean'}, nul = {type:'null'};
const literal = value => ({const:value});
const union = (...oneOf) => ({oneOf});
const nullable = x => union(x,nul);
const arr = (items,maxItems=256,minItems=0) => ({type:'array',items,minItems,maxItems,uniqueItems:true});
const obj = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const ref = name => ({$ref:'#/$defs/'+name});
const enumOf = (...values) => ({enum:values});
const defs = {
 Owner:obj({issuer:str,subject:str}),
 Project:obj({tenantId:str,workspaceId:str,workspaceIncarnation:str,projectId:nullable(str)}),
 Source:obj({workstationId:str,bindingId:str,bindingVersion:num,sourceId:str,sourceGeneration:str,sourceBootId:str}),
 Runtime:obj({packageVersion:str,gitSha:{type:'string',pattern:'^[a-f0-9]{40}$'},packageIntegrity:str,hostBuildHash:hash,exporterBuildHash:hash}),
 Provider:obj({provider:literal('claude'),cliVersion:str,formatVersion:str,exporterVersion:str,importerVersion:str}),
 Retention:union(obj({mode:literal('unbounded')}),obj({mode:literal('duration'),durationSeconds:{...num,minimum:1}})),
 HistorySelector:obj({lineageId:str,checkpointId:nullable(str),fromRecord:nullable(num),toRecord:nullable(num)}),
 Range:obj({lineageId:str,checkpointId:str,fromRecord:num,toRecord:num,inventoryHash:hash}),
 Lease:obj({id:str,requestNonce:str,issuedAt:num,expiresAt:num}),
 Retained:obj({retainedId:str,originScopeDigest:hash,acceptedAt:num,expiresAt:nullable(num)}),
 Cursor:obj({scopeDigest:hash,connectionId:str,channel:enumOf('terminal.live','terminal.cache'),rawSeq:num,byteOffset:num}),
};
defs.Scope=obj({authorityEpoch:str,owner:ref('Owner'),project:ref('Project'),source:ref('Source'),sessionId:str,sessionIncarnation:str,policyId:str,policyRevision:num,consentRevision:num,exclusionRevision:num,grantId:str,grantVersion:num});
defs.Boundary=obj({startAfterSeq:num,native:nullable(obj({provider:ref('Provider'),selections:arr(ref('HistorySelector')),boundaryId:str}))});
defs.ArchiveAdmission=obj({archive:literal('h2a.session-archive/1'),snapshotId:str,manifestHash:hash,policyDigest:hash,channel:literal('nativeHistory'),retention:ref('Retention'),retained:ref('Retained'),descriptorHash:hash});
defs.ConfirmationTarget=union(obj({kind:literal('policy'),policyDigest:hash}),obj({kind:literal('action'),scopeDigest:hash,operation:str,operationId:str,connectionId:str,controllerEpoch:num,byteLength:num,payloadHash:hash}));
defs.ConfirmationChallenge=obj({id:str,owner:ref('Owner'),project:ref('Project'),source:ref('Source'),clientId:str,purpose:enumOf('share','amend','remote-action'),target:ref('ConfirmationTarget'),random:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'},issuedAt:num,expiresAt:num});
defs.Policy=obj({id:str,revision:num,owner:ref('Owner'),project:ref('Project'),destination:str,sources:arr(ref('Source'),256,1),sessions:obj({selected:arr(str),future:bool}),channels:obj({terminalLive:bool,terminalCache:bool,nativeHistory:bool}),history:obj({mode:enumOf('none','existing-at-activation','selected'),selected:arr(ref('HistorySelector'))}),retentionByChannel:obj({terminalCache:ref('Retention'),nativeHistory:ref('Retention')}),exclusionRevision:num});
const limits={segmentDecodedBytes:262144,segmentEncodedBytes:1048576,queueBytes:1048576,fileCount:10000,fileBytes:67108864,archiveBytes:268435456,hostQueueBytes:4194304,pendingConfirmationsPerOwnerSource:4,pendingConfirmationsPerHost:16,ownerChallengeStartsPerMinute:6,ownerChallengeBurst:4,hostChallengeStartsPerMinute:24,hostChallengeBurst:16,concurrentImportsPerWorkstation:1,concurrentExportsPerWorkstation:2,archiveStartsPer10MinutesPerHost:4,archiveStartBurst:3,archiveWorkerBufferBytesPerHost:8388608,queuedArchiveJobs:0};
defs.Limits=obj(Object.fromEntries(Object.entries(limits).map(([k,v])=>[k,literal(v)])));
const envelope=(kind,properties)=>obj({protocol:literal('h2a.session-content'),protocolVersion:literal(2),kind:literal(kind),...properties});
const schemas={};
const add=(kind,properties)=>{schemas[kind]=envelope(kind,properties);};
add('capabilities',{content:literal('h2a.session-content/2'),archive:literal('h2a.session-archive/1'),runtime:ref('Runtime'),terminal:literal(true),native:arr(ref('Provider')),importMode:literal('isolated-data'),resumable:literal(false),limits:ref('Limits')});
add('oidc-context',{owner:ref('Owner'),tenantId:str,clientId:str,audience:str,authSessionRef:str,authSessionVersion:num,authSessionExpiresAt:num,tokenExpiresAt:num,acr:str,amr:arr(str,16,1),authTime:num,expiresAt:num,clientPolicyRevision:num,mfaEnrolled:literal(true)});
add('oidc-session',{authSessionRef:str,owner:ref('Owner'),tenantId:str,authenticatedAt:num,sessionExpiresAt:num,sessionVersion:num,status:enumOf('active','revoked','expired'),credentialRefs:arr(str),revokedAt:nullable(num),revocationReason:nullable(str),tokenRefs:arr(str)});
add('oidc-policy',{issuer:str,sourceClientId:str,sourceAudience:str,confirmationClientId:str,confirmationAudience:str,requiredAcr:literal('urn:sentropic:loa:passkey-fresh'),requiredAmr:literal(['hwk','user','mfa']),forceReauthEveryAuthorization:literal(true),bindUvEventToAuthorization:literal(true),singleUseUvEvent:literal(true),sourceSessionBinding:literal('idp-login-record'),requireUserVerification:literal(true),denyWeakFallback:literal(true),policyRevision:num,allowedSubject:str,tenantId:str,maxConfirmationSeconds:literal(60),maxClockErrorMs:literal(5000)});
add('confirmation-challenge',{challenge:ref('ConfirmationChallenge'),challengeDigest:hash});
add('confirmation-proof',{challengeId:str,challengeDigest:hash,idToken:{type:'string',minLength:1,maxLength:24576}});
add('project-policy',{policy:ref('Policy'),policyDigest:hash,confirmation:obj({id:str,challengeId:str,proofDigest:hash,authSessionRef:str,purpose:enumOf('share','amend'),confirmedAt:num})});
add('source-open',{requestId:str,requestNonce:str,bindingId:str,sourceGeneration:str,sourceBootId:str,runtime:ref('Runtime'),capabilitiesDigest:hash});
add('source-session',{requestId:str,requestNonce:str,sourceSessionId:str,sourceToken:str,owner:ref('Owner'),authSessionRef:str,authSessionVersion:num,authSessionExpiresAt:num,source:ref('Source'),connectionId:str,issuedAt:num,expiresAt:num,operations:literal(['source-control','content-upload','source-ack'])});
add('grant-activate',{requestId:str,requestNonce:str,connectionId:str,scope:ref('Scope'),policyDigest:hash,lease:ref('Lease')});
add('grant-refresh',{requestId:str,requestNonce:str,connectionId:str,previousScope:ref('Scope'),nextScope:ref('Scope'),policyDigest:hash,lease:ref('Lease'),operation:enumOf('renew','amend')});
add('source-ack',{requestId:str,requestDigest:hash,connectionId:str,operation:enumOf('activate','renew','amend','revoke'),status:enumOf('staged','applied','refused'),scope:ref('Scope'),boundary:nullable(ref('Boundary')),lease:nullable(ref('Lease')),reason:nullable(str)});
add('control-result',{requestId:str,requestDigest:hash,sourceAckDigest:hash,connectionId:str,status:enumOf('committed','refused'),reason:nullable(str)});
add('content-revoke',{requestId:str,connectionId:str,target:union(obj({kind:literal('project'),project:ref('Project'),policyId:str}),obj({kind:literal('session'),scope:ref('Scope')}),obj({kind:literal('retained'),retainedId:str,originScopeDigest:hash})),effect:enumOf('capture','read','both'),denyRevision:num,reason:enumOf('excluded','revoked','authority_invalidated')});
const part={byteOffset:num,byteLength:{...num,maximum:262144},totalBytes:num,payloadB64:{type:'string',pattern:'^[A-Za-z0-9_-]*$',maxLength:1048576},payloadHash:hash,final:bool};
add('terminal-fragment',{scope:ref('Scope'),connectionId:str,leaseId:str,channel:enumOf('terminal.live','terminal.cache'),rawSeq:num,...part});
add('terminal-gap',{scope:ref('Scope'),connectionId:str,channel:enumOf('terminal.live','terminal.cache'),fromSeq:num,toSeq:num,reason:enumOf('excluded','not-collected','partition','source-restarted','evicted','expired','incomplete-chunk'),contiguousThroughSeq:num});
add('native-manifest',{scope:ref('Scope'),connectionId:str,leaseId:str,archive:literal('h2a.session-archive/1'),snapshotId:str,policyDigest:hash,provider:ref('Provider'),ranges:arr(ref('Range'),10000,1),files:arr(obj({path:str,role:enumOf('records','artifact'),bytes:{...num,maximum:67108864},sha256:hash}),10000,1),complete:bool,resumable:literal(false),manifestHash:hash});
add('archive-admission',{admission:ref('ArchiveAdmission')});
add('native-part',{scope:ref('Scope'),connectionId:str,leaseId:str,snapshotId:str,fileSha256:hash,...part});
const coverage=union(obj({kind:literal('terminal'),cursor:ref('Cursor')}),obj({kind:literal('native'),snapshotId:str,fileSha256:hash,acceptedThroughByteOffset:num}));
add('ingest-ack',{requestId:str,scopeDigest:hash,connectionId:str,status:enumOf('accepted','duplicate','refused'),coverage,retained:nullable(ref('Retained')),archiveAdmission:nullable(ref('ArchiveAdmission')),reason:nullable(str)});
add('history-read',{authorizationId:str,owner:ref('Owner'),authSessionRef:str,retained:ref('Retained'),coverage:union(obj({kind:literal('terminal'),fromSeq:num,toSeq:num,objects:arr(obj({id:str,sha256:hash}),10000)}),obj({kind:literal('native'),snapshotId:str,manifestHash:hash,descriptorHash:hash})),readExpiresAt:num});
add('import-request',{requestId:str,authorizationId:str,retained:ref('Retained'),snapshotId:str,manifestHash:hash,descriptorHash:hash,provider:ref('Provider'),mode:literal('isolated-data')});
add('import-result',{requestId:str,snapshotId:str,manifestHash:hash,descriptorHash:hash,status:enumOf('imported','refused'),reason:nullable(str),localImportId:nullable(str),expiresAt:nullable(num),resumable:literal(false),processStarted:literal(false),keyboardAcquired:literal(false)});
add('source-admission',{method:literal('POST'),path:{type:'string',minLength:1,maxLength:1024,pattern:'^/[^?#]*$'},sourceSessionId:str,connectionId:str,requestId:str,scopeDigest:hash,leaseId:str,bodyBytes:{...num,maximum:1048576},bodyHash:hash});
const counters={sourceContentReads:0,contentSubscriptions:0,serializedContentBytes:0,exportBytes:0,ingressBodyReads:0,storedBytes:0,importCommits:0,nativeWrites:0,processStarts:0,keyboardAcquires:0};
add('refusals',{cases:arr(obj({name:str,fixture:str,mutation:obj({pointer:str,value:union(str,num,bool,nul)}),expected:obj({code:str,...Object.fromEntries(Object.keys(counters).map(k=>[k,num]))})}),256,1)});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://h2a.invalid/session-content/2/schema.json',$defs:defs,oneOf:Object.values(schemas)};
const jcs=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(jcs).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+jcs(x[k])).join(',')+'}';
const sha=x=>createHash('sha256').update(x).digest('hex');
const digest=(p,x)=>sha('h2a.session-content/2/'+p+'\n'+jcs(x));
const write=(name,value)=>writeFileSync(root+name,JSON.stringify(value,null,2)+'\n');
write('schema.json',schema);
const owner={issuer:'https://synthetic-idp.invalid',subject:'synthetic-owner'},project={tenantId:'tenant',workspaceId:'workspace',workspaceIncarnation:'workspace-incarnation',projectId:'project'};
const source={workstationId:'workstation',bindingId:'binding',bindingVersion:1,sourceId:'source',sourceGeneration:'generation',sourceBootId:'boot'};
const runtime={packageVersion:'0.0.0-synthetic',gitSha:'0'.repeat(40),packageIntegrity:'sha512-synthetic-not-a-package',hostBuildHash:'0'.repeat(64),exporterBuildHash:'0'.repeat(64)};
const provider={provider:'claude',cliVersion:'synthetic-unqualified',formatVersion:'synthetic-jsonl/1',exporterVersion:'synthetic/1',importerVersion:'synthetic/1'};
const policy={id:'policy',revision:1,owner,project,destination:'https://synthetic-sentropic.invalid',sources:[source],sessions:{selected:['session'],future:false},channels:{terminalLive:true,terminalCache:true,nativeHistory:true},history:{mode:'selected',selected:[{lineageId:'lineage',checkpointId:null,fromRecord:null,toRecord:null}]},retentionByChannel:{terminalCache:{mode:'duration',durationSeconds:604800},nativeHistory:{mode:'unbounded'}},exclusionRevision:0};
const policyDigest=digest('policy',policy),scope={authorityEpoch:'epoch',owner,project,source,sessionId:'session',sessionIncarnation:'incarnation',policyId:'policy',policyRevision:1,consentRevision:1,exclusionRevision:0,grantId:'grant',grantVersion:1},scopeDigest=digest('scope',scope);
const now=1800000000000,lease={id:'lease',requestNonce:'lease-nonce',issuedAt:now,expiresAt:now+60000},boundary={startAfterSeq:7,native:{provider,selections:policy.history.selected,boundaryId:'opaque-metadata-boundary'}};
const challenge={id:'challenge',owner,project,source,clientId:'confirmation-client',purpose:'share',target:{kind:'policy',policyDigest},random:Buffer.alloc(32,1).toString('base64url'),issuedAt:now,expiresAt:now+60000};
const challengeDigest=digest('confirmation',challenge);
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-fixture-only',alg:'RS256',use:'sig'};
const header=Buffer.from(jcs({alg:'RS256',kid:jwk.kid,typ:'JWT'})).toString('base64url');
const claims={iss:owner.issuer,sub:owner.subject,tenantId:project.tenantId,aud:challenge.clientId,nonce:Buffer.from(challengeDigest,'hex').toString('base64url'),acr:'urn:sentropic:loa:passkey-fresh',amr:['hwk','user','mfa'],iat:now/1000,auth_time:now/1000,exp:now/1000+60};
const payload=Buffer.from(jcs(claims)).toString('base64url'),signed=header+'.'+payload,idToken=signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
const confirmation={id:'confirmation',challengeId:challenge.id,proofDigest:sha(idToken),authSessionRef:'login',purpose:'share',confirmedAt:now};
const messages={};
const msg=(kind,body)=>messages[kind]={protocol:'h2a.session-content',protocolVersion:2,kind,...body};
msg('capabilities',{content:'h2a.session-content/2',archive:'h2a.session-archive/1',runtime,terminal:true,native:[],importMode:'isolated-data',resumable:false,limits});
msg('oidc-context',{owner,tenantId:project.tenantId,clientId:'source-client',audience:'source-audience',authSessionRef:'login',authSessionVersion:1,authSessionExpiresAt:now+300000,tokenExpiresAt:now+120000,acr:claims.acr,amr:claims.amr,authTime:now,expiresAt:now+120000,clientPolicyRevision:1,mfaEnrolled:true});
msg('oidc-session',{authSessionRef:'login',owner,tenantId:project.tenantId,authenticatedAt:now,sessionExpiresAt:now+300000,sessionVersion:1,status:'active',credentialRefs:['synthetic-credential'],revokedAt:null,revocationReason:null,tokenRefs:['synthetic-token-reference']});
msg('oidc-policy',{issuer:owner.issuer,sourceClientId:'source-client',sourceAudience:'source-audience',confirmationClientId:challenge.clientId,confirmationAudience:challenge.clientId,requiredAcr:claims.acr,requiredAmr:claims.amr,forceReauthEveryAuthorization:true,bindUvEventToAuthorization:true,singleUseUvEvent:true,sourceSessionBinding:'idp-login-record',requireUserVerification:true,denyWeakFallback:true,policyRevision:1,allowedSubject:owner.subject,tenantId:project.tenantId,maxConfirmationSeconds:60,maxClockErrorMs:5000});
msg('confirmation-challenge',{challenge,challengeDigest});msg('confirmation-proof',{challengeId:challenge.id,challengeDigest,idToken});
msg('project-policy',{policy,policyDigest,confirmation});
msg('source-open',{requestId:'open',requestNonce:'open-nonce',bindingId:source.bindingId,sourceGeneration:source.sourceGeneration,sourceBootId:source.sourceBootId,runtime,capabilitiesDigest:digest('capabilities',messages.capabilities)});
msg('source-session',{requestId:'open',requestNonce:'open-nonce',sourceSessionId:'source-session',sourceToken:'synthetic-secret-not-authority',owner,authSessionRef:'login',authSessionVersion:1,authSessionExpiresAt:now+300000,source,connectionId:'connection',issuedAt:now,expiresAt:now+60000,operations:['source-control','content-upload','source-ack']});
msg('grant-activate',{requestId:'activate',requestNonce:'activate-nonce',connectionId:'connection',scope,policyDigest,lease});
msg('grant-refresh',{requestId:'renew',requestNonce:'renew-nonce',connectionId:'connection',previousScope:scope,nextScope:scope,policyDigest,lease:{...lease,id:'lease-renew',requestNonce:'renew-nonce'},operation:'renew'});
msg('source-ack',{requestId:'activate',requestDigest:digest('control',messages['grant-activate']),connectionId:'connection',operation:'activate',status:'staged',scope,boundary,lease,reason:null});
msg('control-result',{requestId:'activate',requestDigest:digest('control',messages['grant-activate']),sourceAckDigest:digest('ack',messages['source-ack']),connectionId:'connection',status:'committed',reason:null});
msg('content-revoke',{requestId:'revoke',connectionId:'connection',target:{kind:'session',scope},effect:'capture',denyRevision:1,reason:'excluded'});
const bytes=Buffer.from('{"type":"user","text":"synthetic inert history"}\n');
const partValue={byteOffset:0,byteLength:bytes.length,totalBytes:bytes.length,payloadB64:bytes.toString('base64url'),payloadHash:sha(bytes),final:true};
msg('terminal-fragment',{scope,connectionId:'connection',leaseId:lease.id,channel:'terminal.live',rawSeq:8,...partValue});
msg('terminal-gap',{scope,connectionId:'connection',channel:'terminal.live',fromSeq:1,toSeq:7,reason:'not-collected',contiguousThroughSeq:0});
const manifestBody={protocol:'h2a.session-content',protocolVersion:2,kind:'native-manifest',scope,connectionId:'connection',leaseId:lease.id,archive:'h2a.session-archive/1',snapshotId:'snapshot',policyDigest,provider,ranges:[{lineageId:'lineage',checkpointId:'checkpoint',fromRecord:0,toRecord:0,inventoryHash:sha(bytes)}],files:[{path:'records/history.jsonl',role:'records',bytes:bytes.length,sha256:sha(bytes)}],complete:true,resumable:false};
messages['native-manifest']={...manifestBody,manifestHash:digest('manifest',manifestBody)};
const retained={retainedId:'retained',originScopeDigest:scopeDigest,acceptedAt:now,expiresAt:null};
const admissionBody={archive:'h2a.session-archive/1',snapshotId:'snapshot',manifestHash:messages['native-manifest'].manifestHash,policyDigest,channel:'nativeHistory',retention:policy.retentionByChannel.nativeHistory,retained};
const admission={...admissionBody,descriptorHash:digest('archive-admission',admissionBody)};
msg('archive-admission',{admission});msg('native-part',{scope,connectionId:'connection',leaseId:lease.id,snapshotId:'snapshot',fileSha256:sha(bytes),...partValue});
msg('ingest-ack',{requestId:'part',scopeDigest,connectionId:'connection',status:'accepted',coverage:{kind:'native',snapshotId:'snapshot',fileSha256:sha(bytes),acceptedThroughByteOffset:bytes.length},retained,archiveAdmission:admission,reason:null});
msg('history-read',{authorizationId:'read',owner,authSessionRef:'login',retained,coverage:{kind:'native',snapshotId:'snapshot',manifestHash:admission.manifestHash,descriptorHash:admission.descriptorHash},readExpiresAt:now+60000});
msg('import-request',{requestId:'import',authorizationId:'read',retained,snapshotId:'snapshot',manifestHash:admission.manifestHash,descriptorHash:admission.descriptorHash,provider,mode:'isolated-data'});
msg('import-result',{requestId:'import',snapshotId:'snapshot',manifestHash:admission.manifestHash,descriptorHash:admission.descriptorHash,status:'imported',reason:null,localImportId:'isolated-import',expiresAt:null,resumable:false,processStarted:false,keyboardAcquired:false});
const body=jcs(messages['terminal-fragment']);
msg('source-admission',{method:'POST',path:'/api/v1/auth/session/content/binding/fragments',sourceSessionId:'source-session',connectionId:'connection',requestId:'fragment',scopeDigest,leaseId:lease.id,bodyBytes:Buffer.byteLength(body),bodyHash:sha(body)});
const mutations=[['old-version','capabilities','/protocolVersion',1],['unknown-field','project-policy','/unexpected',true],['wrong-owner','project-policy','/policy/owner/subject','other'],['wrong-policy','grant-activate','/policyDigest','f'.repeat(64)],['unsupported-import','import-request','/mode','resume'],['changed-snapshot','archive-admission','/admission/snapshotId','other']];
msg('refusals',{cases:mutations.map(([name,fixture,pointer,value])=>({name,fixture:fixture+'.v2.json',mutation:{pointer,value},expected:{code:'contract_refused',...counters}}))});
for(const [kind,value] of Object.entries(messages)) write(kind+'.v2.json',value);
write('vectors.v2.json',{synthetic:true,canonical:[{purpose:'policy',input:policy,canonicalUtf8:jcs(policy),digest:policyDigest},{purpose:'scope',input:scope,canonicalUtf8:jcs(scope),digest:scopeDigest}],transitions:[{from:'off',event:'authenticate',to:'off',expected:counters},{from:'pending',event:'exclude',to:'denied',expected:counters},{from:'staged',event:'wrong-ack',to:'paused',expected:counters}]});
write('confirmation-vectors.v2.json',{synthetic:true,jwks:{keys:[jwk]},challenge,wallNow:now,monotonicNow:1000,measuredClockErrorMs:0,valid:idToken,forged:idToken.slice(0,-10)+'AAAAAAAAAA',claims,expected:{validConsumption:1,replayConsumption:0,forgedConsumption:0},issuerRace:{attempts:['A','B'],preparedUnder:'S0',uvEvent:'uv-A',boundAttempt:'A',resumedUnder:'S1',concurrentCallbacks:['A','B','A'],expectedCodes:1,secondAttemptRequires:'uv-B',qualification:'requires-real-idp'}});
write('source-session-vectors.v2.json',{synthetic:true,session:messages['oidc-session'],tokenMapping:{access:'synthetic-access',refresh:'synthetic-refresh',authSessionRef:'login',sessionVersion:1},transitions:[{event:'renew',expected:'allowed'},{event:'rotate-refresh',expected:'same-login-only'},{event:'other-login',expected:'refused'},{event:'revoke-before-renew-commit',expected:'refused'},{event:'logout',expected:'refused'},{event:'legacy-unmapped-token',expected:'refused'},{event:'credential-revocation',expected:'refused'}],nativePauseNoLaterThan:now+60000,qualification:'requires-real-session-aware-service'});
write('manifest.json',{capsule:'h2a.session-content',version:2,files:readdirSync(root).filter(n=>n.endsWith('.json')&&n!=='manifest.json').sort().map(path=>{const b=readFileSync(root+path);return {path,sha256:sha(b),bytes:b.length};})});
console.log('Synthetic preparatory capsule written; no provider or deployment qualified.');
