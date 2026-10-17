// Serial, explicitly enumerated qualification files. Run only in the private copy.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw Error('private_qualification_copy_required');
const profiles = [
  { major: 22, node: '/usr/bin/node', path: '/usr/local/bin:/usr/bin:/bin' },
  { major: 24, node: '/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin/node', path: '/tmp/mh-l5-artifacts-shD7Sf/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin' },
];
const selected = process.argv[2];
if (selected !== undefined && !['22', '24'].includes(selected)) throw Error('invalid_profile');
for (const profile of profiles.filter(profile => selected === undefined || profile.major === Number(selected))) {
  const env = { ...process.env, PATH: profile.path, MH_L5_ARTIFACTS: '/tmp/mh-l5-artifacts-shD7Sf' };
  const run = args => {
    const result = spawnSync(profile.node, args, { env, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
    if (result.status !== 0 || result.signal) {
      process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
      throw Error(`qualification_failed:${profile.major}:${args.join(' ')}:${result.status}:${result.signal}`);
    }
    const tail = (result.stdout ?? '').trim().split('\n').slice(-1).join('\n');
    console.log(`Node ${profile.major}: ${args.join(' ')}: exit 0: ${tail}`);
  };
  const temporary = fs.mkdtempSync('/tmp/mh-l6-build-');
  try {
    const buildEnv = { PATH: profile.path, LANG: 'C.UTF-8' };
    for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
      buildEnv[name] = join(temporary, name); fs.mkdirSync(buildEnv[name], { mode: 0o700 });
    }
    const command = [profile.node, 'node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'];
    const result = spawnSync(command[0], command.slice(1), { env: buildEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
    const receipt = { command, code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
    fs.writeFileSync(`docs/plan/mh-l6/evidence/build-E3b2a-node${profile.major}.json`, JSON.stringify(receipt, null, 2) + '\n');
    if (receipt.code !== 0 || receipt.signal || receipt.stdout || receipt.stderr) throw Error('build_failed:' + JSON.stringify(receipt));
    console.log(`Node ${profile.major}: explicit TypeScript build: exit 0, empty output`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  run(['scripts/mh-l6-test.mjs', 'packages/h2a/test/mh-l6-package.test.js', 'final-E3b2a']);
  run(['packages/h2a/test/helpers/mh-l6-package-mutate.mjs']);
  run(['scripts/mh-l6-image-mutate.mjs', 'E3b2a']);
  run(['scripts/mh-l6-payload-mutate.mjs', 'E3b2a']);
  for (const name of ['mh-l6-published', 'succession-lock-seam-guard', 'mh-l6-image-policy', 'mh-l6-launcher', 'mh-l6-entry', 'mh-l6-components', 'package-plugin-manifest',
    'mh-l6-native-copy', 'mh-l6-publish-gate', 'release-script', 'release-workflow-publish-order']) {
    run(['scripts/mh-l6-test.mjs', `packages/h2a/test/${name}.test.js`, 'final-E3b2a']);
  }
}
