import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-node-matrix-'));
const paths = {};
for (const version of ['22.15.0', '22.14.0']) {
  const name = `node-v${version}-linux-x64.tar.xz`;
  const url = `https://nodejs.org/dist/v${version}/`;
  try {
    const get = async file => {
      const response = await fetch(url + file, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    };
    const sums = (await get('SHASUMS256.txt')).toString();
    const bytes = await get(name);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (!sums.includes(`${sha}  ${name}`)) throw new Error('checksum mismatch');
    const archive = path.join(destination, name); fs.writeFileSync(archive, bytes);
    const dir = path.join(destination, version); fs.mkdirSync(dir, { mode: 0o700 });
    const extracted = spawnSync('/usr/bin/tar', ['-xJf', archive, '--strip-components=1', '-C', dir]);
    if (extracted.status !== 0) throw new Error(extracted.stderr.toString());
    paths[version] = { path: path.join(dir, 'bin/node'), sha256: sha, source: url + name };
  } catch (error) { paths[version] = { unavailable: error.message }; }
}
fs.writeFileSync(process.argv[2], JSON.stringify(paths, null, 2));
console.log(JSON.stringify(paths));
if (Object.values(paths).some(p => p.unavailable)) process.exitCode = 1;
