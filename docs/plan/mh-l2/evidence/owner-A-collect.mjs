import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const worktree = '/home/antoinefa/src/h2a/tmp/worktrees/mh-l0';
const archive = '/tmp/mh-l2-owner-A-final-Tcelt2/source';
const ev = 'docs/plan/mh-l2/evidence';
const copied = [], excludedDuplicateEvidence = [];
for (const leaf of fs.readdirSync(`${archive}/${ev}`)) {
  if (!(leaf.startsWith('owner-A-') || leaf.includes('owner-A-node') || leaf.startsWith('mh-l2-live-node'))) continue;
  // The executed driver also recopies previous profile copies by suffix. They
  // are duplicate bytes, not additional runs: retain only each canonical copy.
  if (/^owner-A-node(?:22|24)-cold-owner-A-/.test(leaf)) { excludedDuplicateEvidence.push(leaf); continue; }
  const source = `${archive}/${ev}/${leaf}`;
  if (!fs.statSync(source).isFile()) continue;
  fs.copyFileSync(source, `${worktree}/${ev}/${leaf}`); copied.push(leaf);
}
for (const leaf of fs.readdirSync(`${archive}/docs/plan/mh-l2`)) {
  if (leaf.startsWith('owner-A-') && leaf.endsWith('.json')) {
    fs.copyFileSync(`${archive}/docs/plan/mh-l2/${leaf}`, `${worktree}/docs/plan/mh-l2/${leaf}`);
  }
}
const git = args => {
  const r = spawnSync('git', args, { cwd: worktree, encoding: 'utf8' });
  if (r.status !== 0) throw Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout;
};
const hash = b => createHash('sha256').update(b).digest('hex');
const paths = git(['diff', '--name-only', '642a82f9', '--', 'packages', 'scripts', 'docs/plan/mh-l0/schemas.json', 'docs/plan/mh-l2/CONTRACT.md']).trim().split('\n').filter(Boolean);
const files = paths.map(path => {
  const current = fs.readFileSync(`${worktree}/${path}`), qualified = fs.readFileSync(`${archive}/${path}`);
  return { path, worktreeSha256: hash(current), archiveSha256: hash(qualified), equal: current.equals(qualified) };
});
if (files.some(f => !f.equal)) throw Error('qualified_bytes_differ_from_worktree');
const old = JSON.parse(git(['show', '642a82f9:docs/plan/mh-l0/schemas.json']));
const current = JSON.parse(fs.readFileSync(`${worktree}/docs/plan/mh-l0/schemas.json`, 'utf8'));
const names = Object.keys(old.$defs ?? old.definitions ?? old);
const oldDefs = old.$defs ?? old.definitions ?? old, defs = current.$defs ?? current.definitions ?? current;
if (names.some(k => JSON.stringify(oldDefs[k]) !== JSON.stringify(defs[k]))) throw Error('frozen_schema_changed');
const receipt = { codeTarget: '9f34f124593f43c9025ed73f8b6be8b4a10aba0e', archive,
  worktreeHead: git(['rev-parse', 'HEAD']).trim(), runnerAmendments: ['scripts/mh-l2-test.mjs', 'scripts/mh-l2-live-regressions.mjs'],
  copiedEvidenceFiles: copied.length, excludedDuplicateEvidence, frozenSchemaCount: names.length,
  addedSchemas: Object.keys(defs).filter(k => !names.includes(k)), files };
fs.writeFileSync(`${worktree}/${ev}/owner-A-qualified-source-integrity.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ copiedEvidenceFiles: copied.length, equalQualifiedFiles: files.length, frozenSchemas: names.length, addedSchemas: receipt.addedSchemas }));
