// Synthetic launch corpus: no existing workspace is consulted or copied.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function generateCorpus(root, large = false) {
  root = resolve(root);
  if (existsSync(root)) throw new Error('Corpus destination must not already exist');
  for (const dir of ['', 'registry', 'identity', 'keys', 'presence'])
    mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  const counts = large
    ? { instances: 29497, bindings: 28855, aliases: 29560, keypairs: 29564, presence: 307 }
    : { instances: 100, bindings: 100, aliases: 100, keypairs: 100, presence: 10 };
  // Valid synthetic PEMs, shared only by inert historical fixture identities.
  // Live identities are minted by the production code with distinct keys.
  const pair = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const at = '2026-01-01T00:00:00.000Z';
  const uuid = i => `00000000-${i.toString(16).padStart(4, '0')}-4000-8000-000000000000`;
  const instance = i => `claude:s-${i}:${uuid(i).replaceAll('-', '').slice(0, 12)}`;
  const workspace = { id: 'ws:00000000-0000-5000-8000-000000000000', host: 'claude', label: 'synthetic', path: '/synthetic' };
  const instances = Array.from({ length: counts.instances }, (_, i) => ({
    id: instance(i), instance: instance(i), roles: ['AGENTS'], scopes: ['scope:default'],
    capabilities: [], endpoints: [{ kind: 'local-files', uri: 'file:///synthetic' }],
    publicKeys: [pair.publicKey], acceptedPolicies: [], agentUuid: uuid(i), workspace,
    name: `synthetic-${i}`, createdAt: at
  }));
  const bindings = Array.from({ length: counts.bindings }, (_, i) => ({
    host: 'claude', providerSessionId: `synthetic-conversation-${i}`, workspaceId: workspace.id,
    instance: instance(i), agentUuid: uuid(i), at
  }));
  const aliases = Array.from({ length: counts.aliases }, (_, i) => ({
    instance: instance(i), legacyInstance: `claude:s-${i}`, adoptedKeyring: false, at
  }));
  const sizes = {};
  for (const [file, rows, target] of [
    ['registry/instances.jsonl', instances, 19400000],
    ['identity/bindings.jsonl', bindings, 8200000],
    ['identity/aliases.jsonl', aliases, 3800000]
  ]) {
    // Pad an existing descriptive field, keeping real record shapes and counts.
    const field = file.includes('instances') ? 'name' : file.includes('bindings') ? 'providerSessionId' : 'legacyInstance';
    let text = rows.map(row => JSON.stringify(row) + '\n').join('');
    if (large && text.length < target) {
      const padding = Math.floor((target - Buffer.byteLength(text)) / rows.length);
      if (padding > 0) for (const row of rows) row[field] += 's'.repeat(padding);
      text = rows.map(row => JSON.stringify(row) + '\n').join('');
    }
    writeFileSync(join(root, file), text, { mode: 0o600 });
    sizes[file] = statSync(join(root, file)).size;
  }
  writeFileSync(join(root, 'registry/keys.jsonl'), '', { mode: 0o600 });
  for (let i = 0; i < counts.keypairs; i++) {
    const name = instance(i).replace(/[:/]/g, '-');
    writeFileSync(join(root, 'keys', `${name}.key.pem`), pair.privateKey, { mode: 0o600 });
    writeFileSync(join(root, 'keys', `${name}.pub.pem`), pair.publicKey, { mode: 0o600 });
  }
  for (let i = 0; i < counts.presence; i++) {
    const sessionId = `synthetic-presence-${i}`;
    writeFileSync(join(root, 'presence', `${sessionId}.json`), JSON.stringify({
      sessionId, instance: instance(i), host: 'claude', state: 'live',
      interests: { scopes: ['scope:default'], negotiations: [] }, subscribedTopics: [],
      startedAt: at, heartbeatAt: new Date().toISOString()
    }), { mode: 0o600 });
  }
  // Exercise the actual auto-upgrade cache-hit path without installing anything.
  writeFileSync(join(root, 'upgrade-check.json'), JSON.stringify({ checkedAt: Date.now(), latest: '0.98.1' }), { mode: 0o600 });
  writeFileSync(join(root, '.launch-perf-synthetic.json'), JSON.stringify({ counts, sizes }), { mode: 0o600 });
  return { root, counts, sizes };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(generateCorpus(process.argv[2], process.argv.includes('--large'))));
