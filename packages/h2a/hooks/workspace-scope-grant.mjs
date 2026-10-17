#!/usr/bin/env node
// OWNER terminal only. The signing key must be inaccessible to agent processes.
import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { appendRecord, canonical, options, validGrant } from './workspace-scope-state.mjs';
import { repoIdentity } from './workspace-scope-shell.mjs';

try {
  const args = options(process.argv.slice(2));
  if (!args.repo) throw new Error('An exact --repo is required');
  const grant = { schema: 1, owner: args.owner, workspace: canonical(args.workspace),
    session: args.session, repo: repoIdentity(args.repo, process.cwd()), action: args.action, ref: args.ref, expires: args.expires };
  if (!validGrant(grant, grant, grant)) throw new Error('Exact owner/workspace/session/repo/action/ref and future expiry required');
  const key = createPrivateKey(fs.readFileSync(args.key));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('An owner Ed25519 key is required');
  const signature = sign(null, Buffer.from(JSON.stringify(grant)), key).toString('base64');
  appendRecord(grant.workspace, 'grants.jsonl', { grant, signature });
  process.stdout.write(JSON.stringify({ recorded: true, grant }) + '\n');
} catch (error) {
  process.stderr.write(`Grant not recorded: ${error.message}\n`);
  process.exitCode = 2;
}
