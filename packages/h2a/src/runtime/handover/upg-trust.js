import { readFileSync, statSync } from 'node:fs';

function quoteShellPath(targetPath) {
  return /[^A-Za-z0-9_./:@=-]/.test(targetPath) ? `'${targetPath.replace(/'/g, "'\\''")}'` : targetPath;
}

/**
 * Return true iff `st` is owned by the current user and its group is proven to
 * be that user's exclusive User Private Group (UPG): `st.gid` equals the user's
 * primary GID, no other UID in `/etc/passwd` shares that primary GID, and
 * `/etc/group` lists no other member for that GID. Fails closed on any read or
 * parse error. Under a true UPG (standard Linux `umask 0002`), mode `0775` /
 * `0664` has identical owner-only write semantics to `0755` / `0644`.
 */
export function isExclusiveUserPrivateGroup(st, options = {}) {
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : -1);
  const gid = options.gid ?? (typeof process.getgid === 'function' ? process.getgid() : -1);
  if (uid < 0 || gid < 0 || typeof st?.gid !== 'number') return false;
  if (st.uid !== uid || st.gid !== gid) return false;
  let passwdRaw;
  let groupRaw;
  try {
    passwdRaw = options.passwdContent ?? readFileSync('/etc/passwd', 'utf8');
    groupRaw = options.groupContent ?? readFileSync('/etc/group', 'utf8');
  } catch {
    return false;
  }
  let username = null;
  let matchingUserCount = 0;
  for (const rawLine of passwdRaw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 4) return false;
    const [name, , uidStr, gidStr] = fields;
    if (!name || !/^\d+$/.test(uidStr ?? '') || !/^\d+$/.test(gidStr ?? '')) return false;
    const entryUid = Number(uidStr);
    const entryGid = Number(gidStr);
    if (entryUid === uid) {
      matchingUserCount++;
      if (entryGid !== gid) return false;
      username = name;
    } else if (entryGid === gid) {
      return false;
    }
  }
  if (matchingUserCount !== 1 || !username) return false;
  let matchingGroupCount = 0;
  for (const rawLine of groupRaw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length < 4) return false;
    const [, , gidStr, membersStr] = fields;
    if (!/^\d+$/.test(gidStr ?? '')) return false;
    if (Number(gidStr) !== gid) continue;
    matchingGroupCount++;
    const members = (membersStr ?? '').split(',').map(m => m.trim()).filter(Boolean);
    if (members.some(member => member !== username)) return false;
  }
  return matchingGroupCount === 1;
}

/**
 * Verify that `canonicalPrefix` is an owned directory without untrusted group
 * or world write permissions. Mode `0o020` (group write) is accepted only when
 * proven to be the owner's exclusive User Private Group (UPG). World write
 * (`0o002`), shared groups, or unreadable `/etc/passwd`/`/etc/group` fail closed
 * with `prefix_owner_mismatch`.
 */
export function assertTrustedPrefixDirectory(canonicalPrefix, expectedUid = process.getuid(), upgOptions = {}) {
  const info = statSync(canonicalPrefix);
  const currentUid = upgOptions.uid ?? (typeof process.getuid === 'function' ? process.getuid() : expectedUid);
  const ownerMismatch = expectedUid !== currentUid || info.uid !== expectedUid || info.uid !== currentUid;
  const worldWritable = (info.mode & 0o002) !== 0;
  const groupWritable = (info.mode & 0o020) !== 0;
  const groupTrusted = !groupWritable || (!ownerMismatch && isExclusiveUserPrivateGroup(info, { ...upgOptions, uid: currentUid }));
  const modeMismatch = worldWritable || !groupTrusted;
  if (!info.isDirectory() || ownerMismatch || modeMismatch) {
    const octalMode = (info.mode & 0o777).toString(8).padStart(4, '0');
    const quotedPrefix = quoteShellPath(canonicalPrefix);
    const remedy = ownerMismatch && modeMismatch
      ? `chown ${currentUid} ${quotedPrefix} && chmod go-w ${quotedPrefix}`
      : ownerMismatch
        ? `chown ${currentUid} ${quotedPrefix}`
        : `chmod go-w ${quotedPrefix}`;
    throw new Error(
      `prefix_owner_mismatch: ${canonicalPrefix} has mode ${octalMode} uid=${info.uid} (expected uid=${currentUid} without group/other write); run: ${remedy}`
    );
  }
  return info;
}
