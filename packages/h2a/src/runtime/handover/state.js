import fs from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalBytes, digest } from './wire.js';
import { validate } from './formats.js';

export function privateDirectory(path, uid = process.getuid()) {
  const absolute = resolve(path);
  let part = parse(absolute).root;
  for (const segment of absolute.slice(part.length).split('/').filter(Boolean)) {
    part = join(part, segment);
    if (!fs.lstatSync(part).isDirectory()) throw new Error('private_directory_required');
  }
  const info = fs.lstatSync(absolute);
  if (info.uid !== uid || (info.mode & 0o777) !== 0o700) throw new Error('private_directory_required');
  return info;
}
function privateFile(info, uid) {
  if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600) {
    throw new Error('private_state_required');
  }
}
export function readState(path, schema, uid = process.getuid()) {
  privateDirectory(dirname(path), uid);
  let info;
  try { info = fs.lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
  privateFile(info, uid);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd); privateFile(opened, uid);
    if (opened.dev !== info.dev || opened.ino !== info.ino) throw new Error('state_compare_failed');
    const bytes = fs.readFileSync(fd, 'utf8');
    const value = validate(schema, JSON.parse(bytes));
    if (`${canonicalBytes(value)}\n` !== bytes) throw new Error('noncanonical_state');
    return { value, dev: opened.dev, ino: opened.ino, digest: digest(value) };
  } finally { fs.closeSync(fd); }
}
function write(path, value, schema, expected) {
  const directory = dirname(path); privateDirectory(directory);
  validate(schema, value);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  const dirFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let fd; let published = false;
  try {
    fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, Buffer.concat([canonicalBytes(value), Buffer.from('\n')]));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    if (expected) {
      // Caller MUST hold the compatible publication/mutation exclusion.
      const now = readState(path, schema);
      if (!now || now.dev !== expected.dev || now.ino !== expected.ino || now.digest !== expected.digest) {
        throw new Error('state_compare_failed');
      }
      if (Object.hasOwn(now.value, 'revision') && value.revision !== now.value.revision + 1) {
        throw new Error('state_revision_invalid');
      }
      for (const key of ['selectionEpoch', 'controllerEpoch', 'transactionEpoch', 'ownershipEpoch']) {
        if (Object.hasOwn(now.value, key) && value[key] < now.value[key]) throw new Error('state_epoch_regression');
      }
      if (now.value.publicationEpoch?.bootId === value.publicationEpoch?.bootId &&
          now.value.publicationEpoch && value.publicationEpoch.counter <= now.value.publicationEpoch.counter) {
        throw new Error('state_epoch_regression');
      }
      fs.renameSync(temp, path);
    } else {
      // Also interoperates with v1's exclusive link(2) publication.
      fs.linkSync(temp, path);
      published = true;
      fs.unlinkSync(temp);
    }
    published = true;
    fs.fsyncSync(dirFd);
    return readState(path, schema);
  } catch (cause) {
    if (published) throw new Error('persistence_indeterminate:reconcile_before_mutation', { cause });
    throw cause;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.closeSync(dirFd);
  }
}
export function publishState(path, value, schema) { return write(path, value, schema); }
export function replaceState(path, value, schema, expected) {
  if (!expected) throw new Error('state_compare_required');
  return write(path, value, schema, expected);
}
