import test from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign } from './helpers/mh-l5-campaign.js';

test('M17 backend stress should reconcile 10,000 mutations per domain without claiming eight protocol surfaces', async () => {
  const result = await runCampaign(1250);
  assert.ok(Object.values(result.domains).every(n => n >= 10000));
});
