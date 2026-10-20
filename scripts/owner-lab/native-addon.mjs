// Linux node-pty's one C++ translation unit, built without lifecycle scripts or node-gyp.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
export function compileAddons(root) {
  function visit(dir) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.isSymbolicLink() || e.name === '.cache') continue;
      const path = join(dir, e.name);
      if (e.name === 'node-pty' && existsSync(join(path, 'src/unix/pty.cc'))) {
        const out = join(path, 'build/Release/pty.node');
        if (existsSync(out)) continue;
        mkdirSync(join(path, 'build/Release'), { recursive: true });
        const require = createRequire(join(path, 'package.json'));
        const include = dirname(require.resolve('node-addon-api/package.json'));
        const args = ['-std=c++17', '-shared', '-fPIC', '-O2', '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=pty',
          '-I/usr/include/node', `-I${include}`, join(path, 'src/unix/pty.cc'), '-o', out, '-lutil'];
        const r = spawnSync('/usr/bin/g++', args, { encoding: 'utf8', env: process.env });
        if (r.status !== 0) throw new Error(`node-pty C++ build: ${r.stderr}`);
      } else visit(path);
    }
  }
  visit(root);
}
