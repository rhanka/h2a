import fs from 'node:fs';
import path from 'node:path';
import { read, identity, json } from './lab.mjs';

const root = process.env.SPIKE_ROOT;
const expected = read(path.join(root, 'owner-birth.json'));
let attempts = 0, refusals = 0;
setInterval(() => {
  const birth = identity(expected.pid); // Only the owner our activation fixture spawned.
  if (birth.start !== expected.start) throw new Error('unexpected owner birth');
  attempts++;
  try {
    const fd = fs.openSync(path.join(root, 'owner.lock'), 'wx', 0o600);
    fs.closeSync(fd); throw new Error('second publisher acquired lock');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    refusals++;
  }
  json(path.join(root, 'ensure-probe.json'), { expected, attempts, refusals,
    creationAttempted: false, retrySafe: true, secondPublications: 0 });
}, 5);
