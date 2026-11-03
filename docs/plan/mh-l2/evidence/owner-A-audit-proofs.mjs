import fs from 'node:fs';
const ev = 'docs/plan/mh-l2/evidence/';
function read(leaf) {
  const text = fs.readFileSync(ev + leaf, 'utf8');
  const receipts = [...text.matchAll(/receipt: (\{[^\n]+\})/g)];
  const receipt = JSON.parse(receipts.at(-1)?.[1] ?? '{}');
  const tests = Number(/(?:#|ℹ) tests (\d+)/.exec(text)?.[1]);
  const skipped = Number(/(?:#|ℹ) skipped (\d+)/.exec(text)?.[1]);
  return { file: leaf, code: receipt.code, signal: receipt.signal, tests, skipped, assertion: text.includes('ERR_ASSERTION') };
}
const proofs = [];
function pair(node, kind, name, redLeaf, greenLeaf, exactOne = false) {
  const red = read(redLeaf), green = read(greenLeaf);
  const valid = red.code === 1 && red.assertion && green.code === 0 && red.tests > 0 && green.tests > 0 &&
    red.skipped === 0 && green.skipped === 0 && (!exactOne || (red.tests === 1 && green.tests === 1));
  proofs.push({ node, kind, name, valid, red, green });
}
const cold = { unicode:'auth', durable:'image', 'owner-record':'image', compensation:'compensation', pause:'starters',
  mac:'auth', socket:'auth', owner:'authority', inode:'authority', precheck:'image', stop:'cold', budget:'cold' };
for (const node of [22, 24]) {
  const prefix = `mh-l2-live-node${node}-`;
  const names = fs.readdirSync(ev).filter(f => f.startsWith(prefix) && f.endsWith('-red.log')).map(f => f.slice(prefix.length, -8));
  if (names.length !== 63) throw Error(`live_oracle_count:${node}:${names.length}`);
  for (const name of names) pair(node, 'live', name, `${prefix}${name}-red.log`, `${prefix}${name}-green.log`, true);
  for (const name of ['successor-control', 'published-source-authority']) {
    const prefix = `mh-l2-live-central.test.js-owner-A-node${node}-${name}`;
    pair(node, 'real-source', name, `${prefix}-red.log`, `${prefix}-green.log`, true);
  }
  for (const [name, file] of Object.entries(cold)) {
    const retry = (node === 22 && name === 'precheck') || (node === 24 && name === 'owner-record');
    const prefix = `owner-A-node${node}-${retry ? 'retry-cold' : 'cold'}-mh-l2-${file}.test.js-mutation-${name}`;
    pair(node, 'cold', name, `${prefix}-red.log`, `${prefix}-green.log`);
  }
}
const invalid = proofs.filter(p => !p.valid);
const result = { qualificationOverall: 'NOT_GREEN: unresolved attachment failures; initial cold restoration failures retained',
  expectedProofs: 154, verifiedProofs: proofs.filter(p => p.valid).length, invalid, proofs };
fs.writeFileSync(ev + 'owner-A-final-proof-audit.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ expected: 154, verified: result.verifiedProofs, invalid: invalid.map(p => ({ node:p.node,kind:p.kind,name:p.name,red:p.red,green:p.green })) }, null, 2));
if (invalid.length || proofs.length !== 154) process.exitCode = 1;
