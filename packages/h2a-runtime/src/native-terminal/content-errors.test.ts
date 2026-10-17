import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi, afterAll } from 'vitest';
// @ts-ignore Shared confinement helper.
import { setupNativeTestEnvironment, createPrivateTestDirectory } from '../../../h2a/test/helpers/native-isolation.js';
setupNativeTestEnvironment(afterAll);
import { NativeTerminalHost } from './host.js';
import { NativeTerminalClient } from './client.js';
import { startNativeTerminalHostServer } from './server.js';
import type { PtyHandle } from '../pty.js';
import type { SessionContentConsent } from '../session-content-consent.js';

const refusals = ['resource_busy','rate_limited','excluded','confirmation_expired','outcome_unknown','fence_storage_failed','unsupported_source','unsupported_format','content_unavailable','SECRET bearer-private'];

it('should preserve typed content refusals on IPC while hiding arbitrary error text',async()=>{
 const root=createPrivateTestDirectory('e-'),host=new NativeTerminalHost({generation:'test',replayBytesPerSession:1024,spawner:()=>{throw new Error('unexpected process launch');},registryPath:join(root,'r.json')});
 const server=await startNativeTerminalHostServer({host,socketPath:join(root,'s')});const client=await NativeTerminalClient.connect(join(root,'s'));
 try{for(const code of refusals){
   const spy=vi.spyOn(host,'contentPrepare').mockRejectedValueOnce(new Error(code));
   await expect(client.contentPrepare('session','proposal')).rejects.toThrow(code.startsWith('SECRET')?'content_refused':code);spy.mockRestore();
 }}finally{client.close();await server.close();rmSync(root,{recursive:true,force:true});}
});

it('should hide synchronous content errors on every IPC entry while preserving typed refusals',async()=>{
 const root=createPrivateTestDirectory('e-'),host=new NativeTerminalHost({generation:'test',replayBytesPerSession:1024,spawner:()=>{throw new Error('unexpected process launch');},registryPath:join(root,'r.json')});
 const server=await startNativeTerminalHostServer({host,socketPath:join(root,'s')});const client=await NativeTerminalClient.connect(join(root,'s'));
 const calls = {
   contentStatus:()=>client.contentStatus('session'),contentPrepare:()=>client.contentPrepare('session','proposal'),
   contentConfirm:()=>client.contentConfirm('session','proof'),contentRenew:()=>client.contentRenew('session','proposal'),
   contentFlush:()=>client.contentFlush('session','terminal.live'),contentExclude:()=>client.contentExclude('session'),
   contentClear:()=>client.contentClear('session'),
 };
 try{for(const method of Object.keys(calls) as (keyof typeof calls)[])for(const code of refusals){
   const spy=vi.spyOn(host,method).mockImplementation(()=>{throw new Error(code);});
   try{await expect(calls[method]()).rejects.toThrow(code.startsWith('SECRET')?'content_refused':code);}finally{spy.mockRestore();}
 }}finally{client.close();await server.close();rmSync(root,{recursive:true,force:true});}
});

it('should omit unavailable content capability and refuse every unwired IPC entry without legacy fallback',async()=>{
 for(const mode of ['no-factory','legacy-pty','failed-factory'] as const){
   const root=createPrivateTestDirectory('e-'),raw=vi.fn(()=>({dispose(){}}));
   const pty:PtyHandle={pid:41000,pgid:41000,cols:80,rows:24,write:vi.fn(),resize:vi.fn(),kill:vi.fn(),
     onData:()=>({dispose(){}}),onExit:()=>({dispose(){}}),...(mode==='legacy-pty'?{}:{onRawData:raw})};
   const factory=vi.fn(()=>{throw new Error('unavailable authority');});
   const host=new NativeTerminalHost({generation:'test',replayBytesPerSession:1024,registryPath:join(root,'r.json'),
     spawner:()=>pty,readLeaderStartTime:()=>1,...(mode==='no-factory'?{}:{contentFactory:factory})});
   host.create({id:'session',command:'synthetic',args:[],cwd:root,env:{},cols:80,rows:24});
   const server=await startNativeTerminalHostServer({host,socketPath:join(root,'s')});const client=await NativeTerminalClient.connect(join(root,'s'));
   const replay=vi.spyOn(host,'readOutput'),attach=vi.spyOn(host,'attachObserver');
   try{
     expect(host.contentCapability,mode).toBeUndefined();expect(await client.ping()).not.toHaveProperty('content');
     for(const id of ['session','missing'])for(const call of [()=>client.contentStatus(id),()=>client.contentPrepare(id,'proposal'),
       ()=>client.contentConfirm(id,'proof'),()=>client.contentRenew(id,'proposal'),()=>client.contentFlush(id,'terminal.live'),
       ()=>client.contentExclude(id),()=>client.contentClear(id)])await expect(call()).rejects.toThrow('unsupported_source');
     if(mode==='legacy-pty')expect(()=>host.rebindContent('session',{} as SessionContentConsent)).toThrow('unsupported_source');
     expect(factory).toHaveBeenCalledTimes(mode==='failed-factory'?1:0);
     expect(replay).not.toHaveBeenCalled();expect(attach).not.toHaveBeenCalled();expect(pty.write).not.toHaveBeenCalled();
     if(mode==='legacy-pty')expect(raw).not.toHaveBeenCalled();
   }finally{client.close();await server.close();rmSync(root,{recursive:true,force:true});}
 }
});
