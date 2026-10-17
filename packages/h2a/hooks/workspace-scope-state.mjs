import fs from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';

export const stateDir = workspace => join(workspace, '.h2a', 'workspace-scope');
export function canonical(path) {
  const absolute = resolve(path);
  try { return fs.realpathSync(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonical(parent), absolute.slice(parent.length));
  }
}
export const inside = (root, path) => path === root || path.startsWith(root + sep);
export function readRecords(workspace, file) {
  const path = join(stateDir(workspace), file);
  if (canonical(path) !== path) throw new Error('scope state is a symlink');
  try { return fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export function appendRecord(workspace, file, record) {
  const directory = stateDir(workspace);
  // Never follow a workspace-state symlink, including one in .h2a.
  for (const path of [join(workspace, '.h2a'), directory]) {
    try { if (fs.lstatSync(path).isSymbolicLink()) throw new Error('scope state is a symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const fd = fs.openSync(join(directory, file), fs.constants.O_WRONLY | fs.constants.O_APPEND |
    fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
export function validGrant(grant, context, request) {
  return grant?.schema === 1 && typeof grant.owner === 'string' && grant.owner.trim().length > 0 &&
    grant.workspace === context.workspace && grant.session === context.session &&
    grant.repo === request.repo && grant.action === request.action && grant.ref === request.ref &&
    Number.isFinite(Date.parse(grant.expires)) && Date.parse(grant.expires) > Date.now() &&
    [grant.repo, grant.action, grant.ref, grant.session].every(x => typeof x === 'string' && x.length > 0 && !x.includes('*'));
}
export function findGrant(context, request) {
  if (!context.ownerKey || !context.session || !request.ref) return;
  try {
    const key = createPublicKey(fs.readFileSync(context.ownerKey));
    if (key.asymmetricKeyType !== 'ed25519') return;
    const path = join(stateDir(context.workspace), 'grants.jsonl');
    if (canonical(path) !== path) return;
    const lines = fs.readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (validGrant(row.grant, context, request) && typeof row.signature === 'string' &&
        verify(null, Buffer.from(JSON.stringify(row.grant)), key, Buffer.from(row.signature, 'base64'))) return row;
    }
  } catch { /* Missing/untrusted state never authorizes an exception. */ }
}
export function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('Expected --name value pairs');
    const equal = argv[i].indexOf('=');
    const name = argv[i].slice(2, equal < 0 ? undefined : equal);
    const value = equal < 0 ? argv[++i] : argv[i].slice(equal + 1);
    if (!name || !value) throw new Error('Expected --name value pairs');
    result[name] = value;
  }
  return result;
}
