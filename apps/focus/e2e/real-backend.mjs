// Throwaway h2a world for the real-backend acceptance: an h2a root, HOME and XDG dirs
// under TMPDIR, and one registered recipient session with a live presence (the
// Playwright runner pid). Nothing of the developer's real h2a state is read or written.
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RECIPIENT = 'claude:review-e2e:0123456789ab';
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** h2a library of this checkout (npm run build at the repo root). */
export async function h2aLib() {
  return import(pathToFileURL(join(REPO_ROOT, 'packages', 'h2a', 'dist', 'index.js')).href);
}

export function createWorld() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'focus-review-real-')));
  const dirs = {
    base,
    root: join(base, 'h2a-root'),
    home: join(base, 'home'),
    run: join(base, 'run'),
    config: join(base, 'config'),
    state: join(base, 'state'),
    workspace: join(base, 'workspace')
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  mkdirSync(join(dirs.workspace, '.track'), { recursive: true });
  writeFileSync(join(dirs.workspace, '.track', 'events.jsonl'), '', 'utf8');
  return dirs;
}

/**
 * @param {ReturnType<typeof createWorld>} world
 * @param {number} pid
 */
export async function registerRecipient(world, pid) {
  const { createLocalStore, writePresence } = await h2aLib();
  const store = createLocalStore({ root: world.root });
  const { publicKey } = generateKeyPairSync('ed25519');
  const workspace = { id: 'ws:review-e2e', path: world.workspace, host: 'claude', label: 'review-e2e' };
  store.registerInstance({
    id: RECIPIENT,
    instance: RECIPIENT,
    roles: ['AGENTS'],
    scopes: ['scope:default'],
    capabilities: [],
    endpoints: [{ kind: 'local-files', uri: 'file:///review-e2e' }],
    publicKeys: [publicKey.export({ format: 'pem', type: 'spki' }).toString()],
    acceptedPolicies: [],
    createdAt: new Date().toISOString(),
    name: 'review-e2e',
    workspace
  });
  const now = new Date().toISOString();
  writePresence(world.root, {
    sessionId: `session:${RECIPIENT}`,
    pid,
    instance: RECIPIENT,
    name: 'review-e2e',
    startedAt: now,
    heartbeatAt: now,
    state: 'live',
    workspace,
    interests: { scopes: ['scope:default'], negotiations: [] },
    subscribedTopics: []
  });
}

/**
 * Comment requests deposited for the recipient, parsed like an agent session would.
 * @param {string} root
 * @returns {Promise<any[]>}
 */
export async function readCommentRequests(root) {
  const { createLocalStore } = await h2aLib();
  return createLocalStore({ root })
    .readInbox(RECIPIENT)
    .map((/** @type {{ body: { text: string } }} */ envelope) => {
      const text = envelope.body.text;
      return JSON.parse(text.slice(text.indexOf('{'), text.indexOf('\n}\n') + 2));
    });
}
