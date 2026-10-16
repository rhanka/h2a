import test from 'node:test';
import { runCampaign } from './helpers/mh-l5-campaign.js';

test('M17 focused oracle must detect a missing write in any of the seven domains', async () => {
  await runCampaign(2);
});
