import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { ConnectionAuthentication } from '../src/runtime/handover/authentication.js';
import { marker } from './helpers/mh-l0-fixtures.js';

test('control should retain separate challenge and nonce capacity when the application pool is full', () => {
  const auth = new ConnectionAuthentication(marker(), Buffer.alloc(32), { capacity: 1 });
  const dataSocket = {}, controlSocket = {}, dataBody = { method: 'POST', body: JSON.stringify({ method: 'tools/call', id: 1 }) };
  const data = auth.challenge(dataSocket, 'data', 'data');
  auth.admit(dataSocket, auth.request(data, '/mcp', dataBody), '/mcp', dataBody);
  assert.throws(() => auth.challenge({}, 'excess', 'data'), /challenge_capacity/);
  let control;
  assert.doesNotThrow(() => { control = auth.challenge(controlSocket, 'control', 'control'); });
  const body = { method: 'GET', body: null };
  assert.doesNotThrow(() => auth.admit(controlSocket, auth.request(control, '/_h2a-central/lease/session', body), '/_h2a-central/lease/session', body));
  assert.equal(auth.nonces.size, 1); assert.equal(auth.controlNonces.size, 1);
  assert.throws(() => auth.admit(controlSocket, auth.request(control, '/mcp', dataBody), '/mcp', dataBody), /control_class_mismatch/);
});
