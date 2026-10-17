// Build/test prerequisite; no compiler or installation script is invoked.
import fs from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { copyReleaseNative } from './build-release-native.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
export async function prepareWorkspaceNative() {
  const target = fs.realpathSync(join(repo, 'node_modules/node-pty'));
  if (!target.startsWith(repo + sep)) throw Error('workspace_native_target_external');
  const temporary = fs.mkdtempSync(join(tmpdir(), 'h2a-workspace-native-'));
  try {
    const payload = join(temporary, 'payload'); fs.mkdirSync(payload, { mode: 0o700 });
    const native = await copyReleaseNative(payload), packaged = join(payload, 'node_modules/node-pty');
    const metadata = JSON.parse(fs.readFileSync(join(target, 'package.json')));
    if (metadata.name !== 'node-pty' || metadata.version !== native.packageVersion) throw Error('workspace_native_version_mismatch');
    const compare = (directory, relative = '') => {
      for (const name of fs.readdirSync(directory)) {
        const path = join(directory, name), next = join(relative, name);
        if (fs.lstatSync(path).isDirectory()) compare(path, next);
        else if (!fs.readFileSync(path).equals(fs.readFileSync(join(target, 'lib', next)))) throw Error('workspace_native_source_mismatch');
      }
    };
    compare(join(packaged, 'lib'));
    for (const directory of [join(target, 'build'), join(target, 'build/Release')]) {
      try { fs.mkdirSync(directory, { mode: 0o755 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!fs.lstatSync(directory).isDirectory()) throw Error('workspace_native_destination_unsafe');
    }
    const binary = join(target, 'build/Release/pty.node');
    let same = false;
    try { const info = fs.lstatSync(binary); same = info.isFile() && info.nlink === 1 && hash(fs.readFileSync(binary)) === native.binaryDigest; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!same) {
      const temporaryBinary = join(dirname(binary), '.' + randomUUID() + '.node');
      try {
        fs.writeFileSync(temporaryBinary, fs.readFileSync(native.binary), { mode: 0o755, flag: 'wx' });
        const fd = fs.openSync(temporaryBinary, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporaryBinary, binary);
        const directoryFd = fs.openSync(dirname(binary), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } finally { fs.rmSync(temporaryBinary, { force: true }); }
    }
    return { binary, binaryDigest: native.binaryDigest, recipeDigest: native.toolchainDigest, changed: !same };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await prepareWorkspaceNative()) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
