import fs from 'node:fs';
import { withIdentityFence } from '../../dist/runtime/local-files/identity-fence.js';
const [lock,marker,timeoutArg,holdArg]=process.argv.slice(2);
const timeoutMs = timeoutArg === undefined ? 2000 : Number(timeoutArg);
const holdMs = holdArg === undefined ? 100 : Number(holdArg);
const recovered=await withIdentityFence(lock,async lease=>{
 const fd=fs.openSync(marker+'.exclusive','wx');fs.closeSync(fd);
 fs.appendFileSync(marker,`enter ${process.pid}\n`);
 await new Promise(r=>setTimeout(r,holdMs));fs.appendFileSync(marker,`exit ${process.pid}\n`);fs.unlinkSync(marker+'.exclusive');
 return lease.recovered;
},{timeoutMs,pollMs:10});
process.stdout.write(JSON.stringify({recovered}));
