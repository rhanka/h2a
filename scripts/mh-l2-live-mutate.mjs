// Source-only bounded mutation proofs. Each named oracle is registered alone;
// zero tests, skips, syntax/loader errors and abnormal exits are failures.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (![22, 24].includes(Number(process.versions.node.split('.')[0]))) throw new Error('Node 22/24 required');
const cases = [];
const add = (name, leaf, before, after, oracle) => cases.push({ name, leaf, before, after, oracle });
const refusal = name => `passive source should refuse signed authorization with ${name}`;
const durable = name => `passive source should refuse durable ${name}`;
add('acceptance', 'administration.js', "const state = step.mode === 'live-transfer' ? 'RESERVED' : 'PRECHECKED';", "throw new Error('live_coordinator_unavailable');\n      const state = 'PRECHECKED';", 'owner A should accept passive live reservation without enabling a product live coordinator');
add('retirement-acceptance', 'administration.js', "if (operation === 'retire' && tx.mode === 'live-transfer') {", "if (operation === 'retire' && tx.mode === 'live-transfer') { throw new Error('live_publication_required');", 'passive source should retire after valid publication and zero drain');
for (const name of ['old generation', 'old publication epoch', 'old process', 'old build']) add(name.replaceAll(' ', '-'), 'live-source.js', 'digest(value.source) !== digest(m) || ', '', refusal(name));
for (const [name, before] of [
  ['new generation', 'next.generation === m.generation || '], ['new predecessor', 'next.predecessorGeneration !== m.generation ||'],
  ['new epoch', 'next.publicationEpoch.counter <= m.publicationEpoch.counter ||'], ['new endpoint', 'next.endpoint === m.endpoint || '],
  ['new build', 'next.buildId !== target.buildId || '], ['new manifest', 'next.manifestDigest !== target.manifestDigest ||'],
  ['same process', 'digest(next.processIdentity) === digest(m.processIdentity) || '],
  ['wrong transaction epoch', 'a.transactionEpoch !== step.transactionEpoch ||']
]) add(name.replaceAll(' ', '-'), 'live-source.js', before, name === 'wrong controller' ? 'false' : '', refusal(name));
add('wrong-controller', 'live-source.js', ['digest(a.delegatedControllerIdentity) !== digest(coordinator)', '    this.delegation(value);'], ['false', ''], refusal('wrong controller'));
add('wrong-handover', 'live-source.js', ['a.handoverId !== step.handoverId || ', '    this.delegation(value);'], ['', ''], refusal('wrong handover'));
add('wrong-selection', 'live-source.js', ['value.selectionEpoch !== selectionEpoch', 'upgrade.selectionEpoch !== value.selectionEpoch'], ['false', 'false'], refusal('wrong selection epoch'));
for (const [name, field] of [['new root', 'root'], ['new UID', 'uid'], ['new namespace', 'namespaceId']]) {
  const before = "['namespaceId', 'prefixId', 'uid', 'root', 'stateDirectory', 'authKeyReference']";
  const fields = ['namespaceId','prefixId','uid','root','stateDirectory','authKeyReference'].filter(k => k !== field);
  add(name.replaceAll(' ', '-'), 'live-source.js', before, JSON.stringify(fields), refusal(name));
}
add('new-process-frame', 'live-source.js', 'if (next.processIdentity[key] !== m.processIdentity[key])', 'if (false)', refusal('new process frame'));
add('inventory', 'live-source.js', 'if (value.inventoryRevision !== step.inventoryRevision)', 'if (false)', refusal('stale session inventory'));
for (const name of ['expired', 'not yet valid']) add(name.replaceAll(' ', '-'), 'live-source.js', 'if (this.now() < value.issuedAt || this.now() >= value.expiresAt || value.expiresAt <= value.issuedAt)', 'if (false)', refusal(name));
for (const name of ['revoked authority','missing delegation','wrong controller epoch','wrong controller process','wrong controller build','wrong target manifest','wrong component journal','wrong receipt','missing ticket','unselected installation']) {
  add('delegation-' + name.replaceAll(' ', '-'), 'live-source.js', '    this.delegation(value);', '', durable(name));
}
add('ticket-and-receipt', 'live-source.js', '    this.delegation(value);', '', 'passive source should refuse missing, changed or expired private ticket and receipt');
add('ticket-possession', 'live-source.js', "if (!verify(createHash('sha256').update(ticket.ticketNonce).digest(), 'requests', context(this.marker),\n      { purpose: 'live-source-ticket', authorization }, ticketMac))", 'if (false)', refusal('ticket MAC'));
add('revalidation', 'administration.js', '      this.options.liveSource.revalidate(tx);', '', 'passive source should revalidate source, coordinator, inventory and delegation before new mutations');
add('digest', 'live-source.js', 'digest(value) !== hash ||', '', 'passive source should refuse content changed under its immutable authorization digest');
add('mac-authorization', 'live-source.js', "!verify(this.rootKey, 'compatibility', context(this.marker), unsigned(value), value.mac)", 'false', refusal('MAC'));
add('mac-publication', 'live-source.js', "!verify(this.rootKey, 'compatibility', context(this.marker), unsigned(value), value.mac)", 'false', 'passive source should refuse publication with wrong MAC before fencing or closing');
for (const [name, before] of [
  ['authorization', 'publication.authorizationDigest !== hash || '],
  ['checkpoint', 'digest(publication.checkpointReferences) !== digest(tx.checkpointReferences)']
]) add('publication-' + name, 'live-source.js', before, name === 'checkpoint' ? 'false' : '', `passive source should refuse publication with wrong ${name} before fencing or closing`);
add('publication-target', 'live-source.js', ['publication.markerDigest !== digest(value.targetPublication) ||', 'digest(current) !== publication.markerDigest || '], ['', ''], 'passive source should refuse publication with wrong target before fencing or closing');
const active = 'passive retirement should preserve admitted G0 work and fence owners only after authenticated concordant publication';
add('publication-marker', 'live-source.js', '!current || digest(current) !== publication.markerDigest || ', '', active);
add('checkpoint-before-publication', 'live-source.js', "    if (checkParticipants && tx.state !== 'RETIRED') this.participants.checkTransfer(tx, value.targetPublication);", '', 'passive source should require a frozen checkpoint, unchanged inventory and current delegation at publication');
add('fencing', 'administration.js', '      this.options.liveSource.fence(observed.value);', '', active);
add('drain', 'administration.js', "      if (!this.drain().complete) throw new Error('drain_blocked');", '', active);
add('close-order', 'administration.js', '      this.options.liveSource.fence(observed.value);', '      this.requestClose();\n      this.options.liveSource.fence(observed.value);', active);
add('expiry-reopen', 'administration.js', "if (observed.value.mode === 'live-transfer' && !this.options.liveSource.sourcePublished(observed.value))", 'if (false)', 'uncommitted publication should prevent expiration before any administrative reconciliation');
add('operator-reopen', 'administration.js', "!(tx.value.mode === 'live-transfer' && (tx.value.state === 'RECOVERY_BLOCKED' || !this.options.liveSource.sourcePublished(tx.value)))", 'true', 'uncommitted publication should prevent operator stop from aborting before reconciliation');
add('step-id-recovery', 'administration.js', "        this.update(observed, { state: 'PUBLISHED' }, step, result);", "        this.update(observed, { state: 'PUBLISHED' }, { stepId: 'live-publication', payloadDigest: digest(result) }, result);", 'passive retirement should accept every valid stepId and resume its own durable publication after a lost ACK');
add('step-conflict', 'administration.js', "        if (prior.payloadDigest !== step.payloadDigest) throw new Error('step_conflict');", '', 'passive retirement should accept every valid stepId and resume its own durable publication after a lost ACK');
add('owner-process', 'participants.js', "digest(owner.ownerProcessIdentity) !== digest(target.processIdentity) || ", '', 'passive source should preserve exact acquired G1 ownership and reject foreign generation, epoch or process');
add('acquired-writer-gate', 'participants.js', "const targetOpen = target &&", "const targetOpen = false && target &&", 'passive source should retire after the authenticated acquired G1 opens its writer gate');
add('acquired-writer-authority', 'participants.js', "if (!(gate.handoverId === tx.handoverId && gate.gate === 'BARRIER') && !targetOpen)", 'if (false)', 'passive source should refuse an opened gate without the exact acquired target authority');
add('source-drain-scope', 'ownership.js', '        if (scope && (op.ownerGeneration !== scope.generation || digest(op.executionOwner) !== digest(scope.processIdentity))) continue;', '', 'passive source should drain only G0 while independently admitted G1 calls remain pending');
add('source-unknown-work', 'ownership.js', "        if (op.state === 'completed') continue;", "        if (op.state === 'completed' || op.state === 'unknown') continue;", 'passive source should drain only G0 while independently admitted G1 calls remain pending');
add('source-memo-scope', 'participants.js', '        if (scope && digest(memo.executionOwner) !== digest(scope.processIdentity)) continue;', '', 'passive source should neither reconcile nor count new G1 launch memos');
add('source-reconcile-scope', 'launch-memo.js', '      if (scope && digest(memo.executionOwner) !== digest(scope.processIdentity)) continue;', '', 'passive source should neither reconcile nor count new G1 launch memos');
add('reconcile-uncertain-fence', 'live-source.js', '    if (publication) this.publication(tx, publication.publicationDigest, false, false);', '    if (publication) this.publication(tx, publication.publicationDigest, false);', 'passive source should reconcile an uncertain ownership fence before checking participants again');

const selected = process.argv.slice(2), chosen = selected.length ? cases.filter(c => selected.includes(c.name)) : cases;
if (!chosen.length || selected.some(name => !cases.some(c => c.name === name))) throw new Error('unknown_mutation');
const major = process.versions.node.split('.')[0], evidence = 'docs/plan/mh-l2/evidence'; fs.mkdirSync(evidence, { recursive: true });
const execute = (oracle, label) => {
  const root = fs.mkdtempSync('/tmp/mh-l2-live-mutation-');
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_OPTIONS: '--max-old-space-size=768', MH_L2_LIVE_CASE: oracle };
  for (const [key, leaf] of Object.entries({ HOME:'home', XDG_RUNTIME_DIR:'run', XDG_CONFIG_HOME:'config', XDG_STATE_HOME:'state',
    XDG_DATA_HOME:'data', XDG_CACHE_HOME:'cache', REMOTE_CLI_CONFIG_HOME:'cli', CODEX_HOME:'codex', CLAUDE_CONFIG_DIR:'claude', TMPDIR:'tmp', H2A_ROOT:'store' })) {
    env[key] = join(root, leaf); fs.mkdirSync(env[key], { mode: 0o700 });
  }
  const args = ['--test', '--test-reporter=tap', 'packages/h2a/test/mh-l2-live.test.js'];
  try {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const output = `command: ${process.execPath} ${args.join(' ')}\nnode: ${process.version}\nexplicit oracle: ${oracle}\nprivate root: ${root}\n${result.stdout}${result.stderr}\nreceipt: ${JSON.stringify({ code: result.status, signal: result.signal })}\n`;
    fs.writeFileSync(join(evidence, `mh-l2-live-node${major}-${label}.log`), output);
    if (!/# tests 1\b/.test(output) || !/# skipped 0\b/.test(output)) throw new Error('mutation_oracle_missing_or_skipped');
    return { code: result.status, output };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
for (const c of chosen) {
  const path = `packages/h2a/src/runtime/handover/${c.leaf}`, source = fs.readFileSync(path, 'utf8');
  const before = Array.isArray(c.before) ? c.before : [c.before], after = Array.isArray(c.after) ? c.after : [c.after];
  let mutant = source;
  for (let i = 0; i < before.length; i++) {
    if (mutant.split(before[i]).length !== 2) throw new Error('mutation_anchor_not_unique:' + c.name);
    mutant = mutant.replace(before[i], after[i]);
  }
  let red;
  try { fs.writeFileSync(path, mutant); red = execute(c.oracle, c.name + '-red'); }
  finally { fs.writeFileSync(path, source); }
  if (red.code !== 1 || !red.output.includes('ERR_ASSERTION')) throw new Error('mutation_survived_or_failed_abnormally:' + c.name + ':' + red.code);
  const green = execute(c.oracle, c.name + '-green');
  if (green.code !== 0) throw new Error('restored_source_failed:' + c.name);
  process.stdout.write(`node${major} ${c.name}: mutant=1 (assertion), restored=0; oracle=${c.oracle}\n`);
}
process.stdout.write(`node${major}: ${chosen.length}/${chosen.length} mutations killed and restored; no skipped/zero-test oracle\n`);
