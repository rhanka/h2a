// Test executable only. Credentials arrive by IPC, never argv/environment/output.
import fs from 'node:fs';
import { UpgradeStore } from '../../dist/runtime/upgrade/h4-store.js';
import { currentIdentity } from '../../src/runtime/handover/admission.js';
import { acquirePrefixLock } from '../../dist/runtime/local-files/succession-lock.js';
process.send({ identity: currentIdentity() });
let lease;
process.on('message', message => {
  let response;
  const sync = fs.fsyncSync;
  try {
    if (message.action === 'hold') {
      lease = acquirePrefixLock(message.prefix);
      response = { acquired: lease.acquired };
    } else if (message.action === 'release') { lease?.release(); response = { released: true }; }
    else {
      const store = new UpgradeStore(message.layout);
      let count = 0;
      if (message.faultAt || message.faultDirectory) fs.fsyncSync = fd => {
        if (++count === message.faultAt || (message.faultDirectory && fs.fstatSync(fd).isDirectory() &&
          fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('/' + message.faultDirectory))) throw new Error('injected_acquisition_sync');
        sync(fd);
      };
      let transaction;
      if (message.action === 'recover') {
        const handoff = store.recoverDelegation(message.upgradeId, currentIdentity());
        transaction = store.acquireDelegation(message.upgradeId, handoff.ticket);
      } else transaction = message.action === 'assert' ? store.assertMutationAuthority(message.upgradeId) : store.acquireDelegation(message.upgradeId, message.ticket);
      response = { transaction };
    }
  } catch (error) { response = { error: error.message }; }
  finally { fs.fsyncSync = sync; }
  process.send(response);
});
process.on('disconnect', () => { lease?.release(); process.exit(0); });
