// Private umask-022 source copy; never tests the installed package or mutates
// the owner's prefix to relax a guard. The caller runs explicit test files.
import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
process.umask(0o022);
// MH_L3_QUALIFICATION_ROOT overrides the private root (owner rule: never the
// real /tmp); unset keeps the historical /tmp prefix.
const directory = process.env.MH_L3_QUALIFICATION_ROOT
  ? fs.mkdtempSync(join(fs.realpathSync(process.env.MH_L3_QUALIFICATION_ROOT), 'mh-l3-qualification-'))
  : fs.mkdtempSync('/tmp/mh-l3-qualification-'), source = join(directory, 'source');
fs.mkdirSync(source, { mode: 0o755 });
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const path of files) {
  if (!fs.existsSync(path) || fs.lstatSync(path).isDirectory()) continue;
  fs.mkdirSync(dirname(join(source, path)), { recursive: true, mode: 0o755 });
  if (fs.lstatSync(path).isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(path), join(source, path));
  else { fs.copyFileSync(path, join(source, path)); fs.chmodSync(join(source, path), fs.statSync(path).mode & 0o111 ? 0o755 : 0o644); }
}
for (const [command, args] of [['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['npm', ['run', 'build']]]) {
  const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  fs.appendFileSync(join(directory, 'build.log'), `${command} ${args.join(' ')}\n${result.stdout}${result.stderr}\nexit=${result.status}\n`);
  if (result.status !== 0) throw new Error('qualification_copy_build_failed:' + directory);
}
fs.writeFileSync(join(directory, 'receipt.json'), JSON.stringify({ source, files: files.length, node: process.version }) + '\n');
process.stdout.write(source + '\n');
