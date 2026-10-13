import fs from 'node:fs';
import { withIdentityFence } from '../../dist/runtime/local-files/identity-fence.js';
const [lock,marker]=process.argv.slice(2);
const recovered=await withIdentityFence(lock,async lease=>{
 const fd=fs.openSync(marker+'.exclusive','wx');fs.closeSync(fd);
 fs.appendFileSync(marker,`enter ${process.pid}\n`);
 await new Promise(r=>setTimeout(r,100));fs.appendFileSync(marker,`exit ${process.pid}\n`);fs.unlinkSync(marker+'.exclusive');
 return lease.recovered;
},{timeoutMs:2000,pollMs:10});
process.stdout.write(JSON.stringify({recovered}));
