// Network-enabled maintenance job only. Tests consume its pinned, offline output.
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const repo = resolve(import.meta.dirname, '..');
const ts = createRequire(join(repo, 'package.json'))('typescript');
const dir = join(repo, 'packages/h2a/fixtures');
const pinsFile = join(dir, 'native-host-history.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cmp = (a, b) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]; return 0; };
const through = '0.98.6';
const metadata = async name => {
  const response = await fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'));
  if (!response.ok) throw new Error(`registry ${name}: ${response.status}`);
  return response.json();
};
if (process.argv.includes('--refresh-pins')) {
  const root = await metadata('@sentropic/h2a'), track = await metadata('@sentropic/track');
  const packages = {}, releases = [];
  const pin = m => {
    if (!m?.dist?.integrity) throw new Error('missing npm integrity');
    const id = m.name + '@' + m.version;
    packages[id] = { name: m.name, version: m.version, integrity: m.dist.integrity, tarball: m.dist.tarball };
    return id;
  };
  for (const version of Object.keys(root.versions).filter(v => /^\d+\.\d+\.\d+$/.test(v) && cmp(v, '0.78.0') >= 0 && cmp(v, through) <= 0).sort(cmp)) {
    const m = root.versions[version], dependency = m.dependencies?.['@sentropic/track'];
    // Only this exact, verified tuple is admitted; other resolutions remain unknown.
    const trackVersion = dependency?.replace(/^[~^]/, '');
    releases.push({ version, package: pin(m), track: trackVersion ? pin(track.versions[trackVersion]) : null });
  }
  fs.writeFileSync(pinsFile, JSON.stringify({ schema: 1, through, unavailable: ['0.76.0'], releases, packages }, null, 2) + '\n');
}
const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
const lane = fs.mkdtempSync(join(tmpdir(), 'native-catalog-'));
const loaded = new Map();
async function load(id) {
  if (loaded.has(id)) return loaded.get(id);
  const pin = pins.packages[id], response = await fetch(pin.tarball);
  if (!response.ok) throw new Error(`tarball ${id}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = pin.integrity.split('-');
  if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error(`integrity mismatch: ${id}`);
  const archive = join(lane, sha(id) + '.tgz'), target = join(lane, sha(id));
  fs.writeFileSync(archive, bytes); fs.mkdirSync(target);
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (listing.status !== 0 || listing.stdout.split('\n').some(p => p && (!p.startsWith('package/') || p.split('/').includes('..')))) throw new Error(`unsafe tarball: ${id}`);
  const extraction = spawnSync('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', target]);
  if (extraction.status !== 0) throw new Error(`extract failed: ${id}`);
  const result = { pin, root: join(target, 'package') }; loaded.set(id, result); return result;
}
const entries = [], coverage = { vibe: [], muse: [], agy: [], gemini: [] }, vendors = [];
try {
  for (const release of pins.releases) {
    const pkg = await load(release.package);
    const cli = fs.readFileSync(join(pkg.root, 'dist/cli.js'), 'utf8');
    const ast = ts.createSourceFile('cli.js', cli, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const functions = ['parseSkill', 'renderSkillAsGeminiToml'].map(name => {
      const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
      if (!node) throw new Error(`${release.version}: missing published renderer ${name}`);
      return node.getText(ast);
    }).join('\n');
    const context = vm.createContext({});
    new vm.Script(functions).runInContext(context, { timeout: 1000 });
    const hosts = ['agy', 'gemini', ...(cmp(release.version, '0.97.5') >= 0 ? ['muse'] : []), ...(cmp(release.version, '0.98.3') >= 0 ? ['vibe'] : [])];
    for (const host of hosts) coverage[host].push(release.version);
    const sources = [{ ...pkg, source: 'h2a' }];
    if (release.track) sources.push({ ...await load(release.track), source: 'track' });
    const harness = join(pkg.root, 'skills/harness');
    if (fs.existsSync(harness)) sources.push({ ...pkg, root: pkg.root, skills: harness, source: 'harness' });
    for (const source of sources) {
      const skills = source.skills || join(source.root, 'skills');
      if (!fs.existsSync(skills)) continue;
      for (const name of fs.readdirSync(skills)) {
        const file = join(skills, name, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        let raw = fs.readFileSync(file, 'utf8');
        const parsed = context.parseSkill(raw), installName = source.source === 'harness' ? `harness-${name}` : parsed.name;
        if (installName !== parsed.name) { raw = raw.replace(/^(name:[ \t]*).*$/m, `$1${installName}`); parsed.name = installName; }
        for (const host of hosts) {
          const rendered = ['agy', 'gemini'].includes(host) ? context.renderSkillAsGeminiToml(parsed) : raw;
          entries.push({ host, name: installName, sha256: sha(rendered), package: source.pin.name, version: source.pin.version, integrity: source.pin.integrity, renderer: sha(functions) });
          if (['0.78.0', '0.97.5', '0.98.3'].includes(release.version) && (name === 'h2a' || name === 'using-harness')) vendors.push({ release: release.version, host, name: installName, source: raw, rendered, functions, sha256: sha(rendered) });
        }
      }
    }
    process.stdout.write(`verified ${release.version}\n`);
  }
  // Deduplicate equal verified tuples; coverage separately records every root release.
  const unique = [...new Map(entries.map(e => [JSON.stringify(e), e])).values()];
  fs.writeFileSync(join(dir, 'native-host-catalog.json'), JSON.stringify({ schema: 1, through, unavailable: pins.unavailable, coverage, entries: unique }) + '\n');
  fs.writeFileSync(join(dir, 'native-host-renderers.json'), JSON.stringify(vendors) + '\n');
  process.stdout.write(`${pins.releases.length} releases; ${unique.length} verified rendered tuples\n`);
} finally { fs.rmSync(lane, { recursive: true, force: true }); }
