import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecretsText } from '../src/vuln-fix/redact.mjs';

// Sol 6.1 xhigh review, finding 1 (P1): quoted JSON keys leaked in clear.
const keys = ['token', 'password', 'api_key', 'secret', 'access_token',
  'refresh_token', 'client_secret', 'authorization'];

for (const key of keys) {
  test(`should mask double-quoted JSON key "${key}"`, () => {
    const raw = `{"${key}":"FAKE-TOKEN-0000"}`;
    const redacted = redactSecretsText(raw);
    assert.ok(!redacted.includes('FAKE-TOKEN-0000'), redacted);
    assert.match(redacted, /\[REDACTED\]/);
  });
}

test('should mask single-quoted keys with arbitrary whitespace', () => {
  for (const raw of [`{'password' : 'FAKE-TOKEN-0000'}`, `{"api_key"  :  "FAKE-TOKEN-0000"}`, `{ "secret": "FAKE-TOKEN-0000" }`]) {
    const redacted = redactSecretsText(raw);
    assert.ok(!redacted.includes('FAKE-TOKEN-0000'), redacted);
  }
});

test('should keep masking key=value and key: value forms', () => {
  for (const raw of ['token=FAKE-TOKEN-0000', 'password: FAKE-TOKEN-0000', 'api_key=FAKE-TOKEN-0000']) {
    const redacted = redactSecretsText(raw);
    assert.ok(!redacted.includes('FAKE-TOKEN-0000'), redacted);
  }
});
