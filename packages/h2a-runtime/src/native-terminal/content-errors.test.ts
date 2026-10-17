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
it('should preserve typed content refusals on IPC while hiding arbitrary error text',async()=>{
 const root=createPrivateTestDirectory('e-'),host=new NativeTerminalHost({generation:'test',replayBytesPerSession:1024,spawner:()=>{throw new Error('unexpected process launch');},registryPath:join(root,'r.json')});
 const server=await startNativeTerminalHostServer({host,socketPath:join(root,'s')});const client=await NativeTerminalClient.connect(join(root,'s'));
 try{for(const code of ['resource_busy','rate_limited','excluded','confirmation_expired','outcome_unknown','fence_storage_failed','SECRET bearer-private']){
   const spy=vi.spyOn(host,'contentPrepare').mockRejectedValueOnce(new Error(code));
   await expect(client.contentPrepare('session','proposal')).rejects.toThrow(code.startsWith('SECRET')?'content_refused':code);spy.mockRestore();
 }}finally{client.close();await server.close();rmSync(root,{recursive:true,force:true});}
});
