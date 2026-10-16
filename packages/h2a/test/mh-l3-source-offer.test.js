import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { liveFixture } from './helpers/mh-l2-live.js';

test('source should refuse transfer without an exact handover acknowledgement even for an accepted catalogue proof', () => {
  const f = liveFixture();
  try {
    f.a.advertisement = { attachmentProtocol: 1 };
    f.freeze(); const publicationDigest = f.publication(); f.publish();
    assert.throws(() => f.step('retire', { publicationDigest }), /shim_acceptance_required/);
    f.a.shimAcceptance = { mode: 'catalogue', authorization: f.authorization.authorization };
    assert.throws(() => f.step('retire', { publicationDigest }), /shim_acceptance_required/);
    f.a.shimAcceptance = { mode: 'handover', authorization: { ...f.authorization.authorization, controllerEpoch: 3 } };
    assert.throws(() => f.step('retire', { publicationDigest }), /shim_acceptance_required/);
    f.a.shimAcceptance = { mode: 'handover', authorization: f.authorization.authorization };
    assert.equal(f.step('retire', { publicationDigest }).state, 'RETIRED');
  } finally { f.close(); }
});
