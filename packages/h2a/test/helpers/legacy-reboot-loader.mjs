// Private test preload for real worker/stdio processes. Not in src/dist or exports.
import { simulatedReboot } from './legacy-proc-fixture.mjs';
const root=process.env.IDLOCK_SIM_ROOT;
if(root) {
  if(!root.startsWith(process.env.IDLOCK_LANE+'/'))throw new Error('simulation root outside isolated lane');
  simulatedReboot(root);
}
