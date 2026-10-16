// Exact single-guard mutants, private qualified copy only, byte restoration in finally.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
if (!fs.realpathSync('.').startsWith('/tmp/mh-l3-qualification-')) throw new Error('private_qualification_copy_required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const group = process.argv[2] ?? 'selection', major = process.versions.node.split('.')[0];
const nominal = 'U05 should select once with canonical journal, history and pins across HOME changes';
const exclusion = 'U05 should exclude the actual legacy prefix lock and coalesce only the same request';
const invalid = 'U06 should refuse foreign layout, unknown controllers and changed payload before selection';
const cases = [
  ['launcher', 'runtime-profile', "if (process.platform !== 'linux' || ![22, 24].includes(Number(process.versions.node.split('.')[0])) || !process.report.getReport().header.glibcVersionRuntime) throw new Error('authority_profile_unqualified');", '', 'U10 should refuse a runtime outside the qualified glibc profile before importing any image'],
  ['launcher', 'same-process-import', 'await import(pathToFileURL(current.entrypoint).href);', "const { spawnSync } = await import('node:child_process'); const result = spawnSync(process.execPath, [current.entrypoint], { encoding: 'utf8' }); process.stdout.write(result.stdout);", 'U04 should import the verified absolute image in the launcher PID without npm imports'],
  ['launcher', 'neutralize-node-path', 'delete process.env.NODE_PATH;', '', 'U12 should remove NODE_PATH and refuse external loading flags from env or node argv'],
  ['launcher', 'environment-loading-flags', "const options = [process.env.NODE_OPTIONS ?? '', ...process.execArgv].join(' ').trim();", "const options = process.execArgv.join(' ').trim();", 'U12 should remove NODE_PATH and refuse external loading flags from env or node argv'],
  ['launcher', 'argv-loading-flags', "const options = [process.env.NODE_OPTIONS ?? '', ...process.execArgv].join(' ').trim();", "const options = (process.env.NODE_OPTIONS ?? '').trim();", 'U12 should remove NODE_PATH and refuse external loading flags from env or node argv'],
  ['launcher', 'history-payload', 'verifyImage(root, manifest, selection.manifestDigest);', '', 'U06 should reject a corrupt history payload as a diagnostic recovery candidate'],
  ['launcher', 'selected-image-verification', 'current = resolveSelectedEntry(installation);', "const selection = readState(join(installation.managedRoot, 'state/selected-build.json'), 'selection').value; current = { selection, entrypoint: join(installation.managedRoot, 'images', selection.manifestDigest.slice(7), selection.entrypoint) };", 'U06 should reject altered payload and foreign selection before importing code'],
  ['launcher', 'path-shadowing', "if (observation.pathShadowing) throw new Error('path_shadowing');", '', 'U09 should diagnose PATH shadowing and a changed command link without rewriting either'],
  ['launcher', 'external-command-link', "if (observation.externalInstallDetected) throw new Error('external_install_detected');", '', 'U09 should diagnose PATH shadowing and a changed command link without rewriting either'],
  ['launcher', 'diagnostic-status', 'if (status) {', 'if (false) {', 'U06 should keep status read-only and use verified history only for diagnostics when selection is corrupt'],
  ['launcher', 'selection-commit-guard', "if (transactions.some(tx => tx.phase === 'SELECTING')) throw new Error('selection_recovery_required');", '', 'U06 should keep an in-progress selection available only for diagnosis until reconciled'],
  ['launcher', 'no-fallback-execution', 'if (selectionError) throw selectionError;', "if (selectionError) { const selection = verifiedHistory(installation); current = { entrypoint: join(installation.managedRoot, 'images', selection.manifestDigest.slice(7), selection.entrypoint) }; }", 'U06 should never import an older fallback during an engaged selection transaction'],
  ['launcher', 'journal-format', "const tx = readState(join(directory, name), 'upgradeTransaction')?.value;", "const tx = JSON.parse(fs.readFileSync(join(directory, name), 'utf8'));", 'U06 should refuse to claim a reliable status for an unknown journal without repairing it'],
  ['delegation', 'recovery-revision', "if (tx.delegationState === 'DELEGATING' && ticket.expectedRevision !== tx.revision) throw new Error('delegation_revision_mismatch');", '', 'T5 should refuse acquisition against a different durable revocation revision'],
  ['delegation', 'live-delegate-fencing', "if (ownerLiveness({ processIdentity: ticket.delegatedControllerIdentity }, identity) !== 'dead') throw new Error('delegation_owner_not_dead');", '', 'T5 should replace a proven dead unacquired delegate with a new epoch and reject its old ticket'],
  ['delegation', 'unknown-delegate-fencing', "if (ownerLiveness({ processIdentity: ticket.delegatedControllerIdentity }, identity) !== 'dead') throw new Error('delegation_owner_not_dead');", '', 'T5 should refuse a delegate death inferred from an incomparable process frame'],
  ['delegation', 'source-revocation', "installationState: 'DELEGATING', controllerAuthorityState: 'REVOKED',", "installationState: 'DELEGATING', controllerAuthorityState: 'ACTIVE',", 'T5 should revoke the source before the exact future controller acquires and acknowledges once'],
  ['delegation', 'source-authority', "if (tx.controllerAuthorityState !== 'ACTIVE' || digest(tx.controllerIdentity) !== digest(currentIdentity()))", 'if (false)', 'T5 should revoke the source before the exact future controller acquires and acknowledges once'],
  ['delegation', 'private-ticket', "if (digest(suppliedTicket) !== digest(ticket)) throw new Error('delegation_ticket_mismatch');", '', 'T5 should refuse every altered ticket binding and a second controller before granting authority'],
  ['delegation', 'target-identity', "if (digest(ticket.delegatedControllerIdentity) !== digest(identity)) throw new Error('delegation_identity_mismatch');", '', 'T5 should refuse every altered ticket binding and a second controller before granting authority'],
  ['delegation', 'absolute-controller-entry', "if (!process.argv[1] || fs.realpathSync(process.argv[1]) !== fs.realpathSync(entry)) throw new Error('controller_entrypoint_mismatch');", '', 'T5 should refuse a correctly identified process loaded outside the selected absolute entry'],
  ['delegation', 'ticket-expiry', "if (ticket.expiresAt <= Date.now()) throw new Error('delegation_ticket_expired');", '', 'T5 should refuse an expired unacquired ticket and keep the source revoked'],
  ['delegation', 'revocation-revision', "if (tx.installationState !== 'DELEGATING' || tx.delegationState !== 'DELEGATING' || tx.controllerAuthorityState !== 'REVOKED' || ticket.expectedRevision !== tx.revision)", "if (tx.installationState !== 'DELEGATING' || tx.delegationState !== 'DELEGATING' || tx.controllerAuthorityState !== 'REVOKED')", 'T5 should refuse acquisition against a different durable revocation revision'],
  ['delegation', 'receipt-binding', 'this.#receipt(tx, this.#ticket(record));', 'this.#ticket(record);', 'T5 should refuse a corrupt delegation receipt before any further controller authority'],
  ['delegation', 'receipt-recovery-sync', 'if (prior) { held(); syncDirectory(dirname(path)); }', '', 'U05 should resynchronize a previously visible receipt before granting controller authority'],
  ['delegation', 'uncertain-authority-sync', "if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection'); held(); syncDirectory(this.transactions); syncDirectory(join(this.state, 'upgrade/receipts'));", "if (this.#selection()?.digest !== digest(tx.observations.selectionIntent)) throw new Error('RECOVERY_BLOCKED:selection');", 'U05 should resynchronize an uncertain acquisition before asserting mutation authority'],
  ['delegation', 'guardian-bypass', 'const lease = acquirePrefixLock(this.installation.canonicalPrefix, { readFirst: true });', 'const lease = { acquired: true, stillHeld: () => true, release() {} };', 'T5 should suspend behind the real compatible guardian and reacquire after its proven death'],
  ['delegation', 'ticket-persistence', "held(); publishState(path, ticket, 'delegationTicket');", '', 'T5 should revoke the source before the exact future controller acquires and acknowledges once'],
  ['delegation', 'receipt-persistence', "if (!prior) publishState(path, receipt, 'delegationReceipt');", '', 'T5 should revoke the source before the exact future controller acquires and acknowledges once'],
  ['selection', 'intent-installation-binding', "if (['prefixId', 'canonicalPrefix', 'uid', 'upgradeId', 'selectionEpoch', 'previousSelectionReference'] .some(key => intent[key] !== tx[key]) || intent.manifestDigest !== tx.targetManifestDigest || intent.packageVersion !== tx.resolvedTarget)", 'if (false)', 'U06 should reject a validly encoded intent from another installation without publication'],
  ['selection', 'compatible-lock', "if (!lease.acquired) throw new Error(`legacy_lock_unavailable:${lease.reason}`);", '', exclusion],
  ['selection', 'controller-protocol', "if (controller.schemaVersion !== 1 || controller.protocolVersion !== 1 || controller.entrypoint !== target.entrypoint)", 'if (false)', invalid],
  ['selection', 'payload-verification', 'verifyImage(root, manifest, target.manifestDigest);', '', invalid],
  ['selection', 'coalescence', "if (!terminal.has(existing.installationState)) throw new Error('upgrade_in_progress');", '', exclusion],
  ['selection', 'request-binding', "if (existing.observations.requestDigest !== requestDigest) throw new Error('upgrade_request_conflict');", '', exclusion],
  ['selection', 'irreversible-abort', "if (!['PREPARING', 'PREPARED'].includes(record.value.installationState)) throw new Error('selection_irreversible');", '', 'U05 should retain the previous selection and reject abort after selection intent'],
  ['selection', 'history-before-selection', "if (prior && prior.digest !== digest(intent)) throw new Error('RECOVERY_BLOCKED:history');", '', 'U06 should refuse a contradictory durable history before changing the selected build'],
  ['selection', 'last-valid-binding', 'if (last && last.digest !== digest(intent) && last.digest !== tx.observations.previousSelectionDigest)', 'if (false)', 'U06 should refuse a contradictory last-valid record before changing selection'],
  ['selection', 'selection-binding', "if ((selected?.digest ?? null) !== tx.observations.previousSelectionDigest || tx.installationState !== 'SELECTING')", 'if (false)', 'U06 should block contradictory selection and preserve all diagnostic bytes'],
  ['selection', 'history-persistence', "if (!prior) publishState(history, intent, 'selection');", '', nominal],
  ['selection', 'backup-persistence', "if (!last) publishState(backup, intent, 'selection');", 'if (!last) {}', nominal],
  ['selection', 'pin-persistence', "if (!prior) publishState(path, pin, 'imagePin');", '', nominal],
  ['selection', 'selection-directory-sync', 'syncDirectory(this.state);', '', 'U05 should reconcile every selection persistence cut forward without a second epoch'],
];
const files = group === 'launcher' ? ['packages/h2a/src/runtime/upgrade/managed-launcher.js'] :
  ['packages/h2a/src/runtime/upgrade/h4-store.js', 'packages/h2a/dist/runtime/upgrade/h4-store.js'];
const originals = files.map(path => ({ path, bytes: fs.readFileSync(path) }));
const selected = cases.filter(c => c[0] === group && (!process.env.MH_L6_MUTATION || c[1] === process.env.MH_L6_MUTATION));
if (!selected.length) throw new Error('unknown_mutation_group');
const file = `packages/h2a/test/mh-l6-${['delegation', 'launcher'].includes(group) ? group : 'selection'}.test.js`;
const results = [];
for (const [, name, from, to, scenario] of selected) {
  const run = color => {
    const label = `mutation-${name}-${color}`;
    const command = [process.execPath, 'scripts/mh-l6-test.mjs', file, label];
    const result = spawnSync(command[0], command.slice(1), { env: { ...process.env, MH_L6_CASE: scenario }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const log = `docs/plan/mh-l6/evidence/${file.split('/').at(-1)}-node${major}-${label}.log`;
    const output = fs.readFileSync(log, 'utf8'), receipt = JSON.parse(output.split('\nreceipt: ').at(-1));
    if (result.status !== (color === 'red' ? 1 : 0) || receipt.invalid || receipt.signal || receipt.tests !== 1 ||
      (color === 'red' && !output.includes('ERR_ASSERTION'))) throw new Error(`invalid_mutation:${name}:${color}:${log}`);
    return log;
  };
  let red;
  try {
    for (const { path, bytes } of originals) {
      const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
      if ([...bytes.toString().matchAll(pattern)].length !== 1) throw new Error('mutation_not_unique:' + name + ':' + path);
      fs.writeFileSync(path, bytes.toString().replace(pattern, () => to));
    }
    red = run('red');
  } finally { for (const { path, bytes } of originals) fs.writeFileSync(path, bytes); }
  const green = run('green');
  for (const { path, bytes } of originals) if (hash(fs.readFileSync(path)) !== hash(bytes)) throw new Error('restore_failed');
  results.push({ name, red, green, restored: true });
  fs.writeFileSync(`docs/plan/mh-l6/mutations-${group}-node${major}.json`, JSON.stringify({ node: process.version,
    files: originals.map(o => ({ path: o.path, sha256: hash(o.bytes) })), results }, null, 2) + '\n');
  process.stdout.write(`${name}: killed by assertion and restored\n`);
}
