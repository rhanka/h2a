import assert from 'node:assert/strict';
import test from 'node:test';
import { blockingScreen } from './qualify-cross-cli.mjs';

test('R32: passive native Codex rate-limit information does not declare the seat exhausted', () => {
  // Wording present in the installed native Codex executable. The old bare
  // rate.?limit match turned onboarding/account information into a quota stop.
  for (const screen of [
    "Your plan's rate limits and training data preferences apply. You're in control. Codex can make mistakes.",
    'Visit the account page for up-to-date information on rate limits and credits',
    'Approaching rate limits',
    'Tip: reasoning effort can quickly consume Plus plan rate limits',
    'Visit rate limits and credits. Errors can be reported separately.',
  ]) assert.equal(blockingScreen(screen), undefined, screen);
});

test('R32: actual provider quota refusals remain blocking', () => {
  for (const screen of [
    'quota exceeded', 'Usage limit reached', "You've hit your usage limit. Try again later.",
    'rate limit exceeded', 'You are rate limited', 'credits exhausted', 'insufficient credits',
    'Your workspace is out of credits.', 'Too many requests',
  ]) assert.equal(blockingScreen(screen), 'provider-quota', screen);
});
