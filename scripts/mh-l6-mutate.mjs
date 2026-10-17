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
  ['exclusion', 'workers-closure', "'workersTerminated', 'relaunchSourcesClosed'", "'relaunchSourcesClosed'", 'B2 should report unfenced when legacy workers may still terminate late'],
  ['exclusion', 'relaunch-closure', "'relaunchSourcesClosed', 'futureStartsRouted'", "'futureStartsRouted'", 'B2 should report unfenced when relaunch sources stay open'],
  ['exclusion', 'routing-closure', "'futureStartsRouted', 'installerReintroductionBarred'", "'installerReintroductionBarred'", 'B2 should report unfenced when future starts are not routed'],
  ['exclusion', 'installer-closure', "'futureStartsRouted', 'installerReintroductionBarred'", "'futureStartsRouted'", 'B2 should report unfenced when retained processes may reintroduce the installer'],
  ['exclusion', 'stated-basis', "typeof entry.detail !== 'string' || !entry.detail", 'false', 'B2 should report unfenced when a closure lacks its stated basis'],
  ['exclusion', 'strict-established', 'entry.established !== true', '!entry.established', 'B2 should report unfenced when a closure lacks its stated basis'],
  ['exclusion', 'envelope-rejection', "throw new Error('legacy_exclusion_evidence_invalid');", "return Object.freeze({ fenced: true, reason: 'legacy_exclusion_verified', missing: Object.freeze([]) });", 'B2 should refuse an invalid exclusion envelope instead of verdicting'],
  ['exclusion', 'default-unfenced', "fenced: false, reason: 'legacy_installer_unfenced'", "fenced: true, reason: 'legacy_exclusion_verified'", 'B2 should report unfenced when legacy workers may still terminate late'],
  ['deferral', 'selection-deferral', 'if (exclusion && !exclusion.fenced) throw new Error(`selection_deferred:${exclusion.reason}`);', '', 'B2 should defer qualified selection while legacy exclusion is unfenced'],
  ['deferral', 'verdict-persistence', 'legacyExclusion: assessLegacyExclusion(exclusionEvidence)', 'legacyExclusion: { fenced: true, reason: \'legacy_exclusion_verified\', missing: [] }', 'B2 should defer qualified selection while legacy exclusion is unfenced'],
  ['deferral', 'exclusion-ignored', 'if (exclusionEvidence !== undefined) {', 'if (false) {', 'B2 should defer qualified selection while legacy exclusion is unfenced'],
  ['deferral', 'fenced-flag-ignored', '!exclusion.fenced', 'false', 'B2 should defer qualified selection while legacy exclusion is unfenced'],
  ['bootstrap', 'session-lock', 'const lease = acquirePrefixLock(evidence.canonicalPrefix);', 'const lease = { acquired: true, stillHeld: () => true, release() {} };', 'C2b should hold compatible exclusion while the session is open'],
  ['bootstrap', 'drift-revalidation', 'return assertLegacyInstallationUnchanged(session.evidence);', 'return session.evidence;', 'C2b should refuse drift observed after the session opened'],
  ['bootstrap', 'target-eligibility', 'const eligible = checkTarget(target);', 'const eligible = target;', 'C2b should refuse an ineligible bootstrap target before holding anything'],
  ['bootstrap', 'lock-release', 'release() { if (!released) { released = true; lease.release(); } }', 'release() { released = true; }', 'C2b should hold compatible exclusion while the session is open'],
  ['adoption', 'default-needed', 'needed: true', 'needed: false', 'C2b should require adoption when no managed selection exists'],
  ['adoption', 'absent-installation', "need('managed_installation_absent')", "need('already_adopted')", 'C2b should require adoption when the managed layout is unrecognized'],
  ['adoption', 'absent-selection', "need('managed_selection_absent')", "need('already_adopted')", 'C2b should require adoption when no managed selection exists'],
  ['adoption', 'prefix-foreign', "need('managed_prefix_foreign')", "need('already_adopted')", 'C2b should require adoption when the managed layout is unrecognized'],
  ['adoption', 'selection-malformed', "need('managed_selection_malformed')", "need('already_adopted')", 'C2b should require adoption when the managed layout is unrecognized'],
  ['adoption', 'target-mismatch', "need('target_mismatch')", "need('already_adopted')", 'C2b should require adoption when the selection targets another build'],
  ['adoption', 'physical-unreadable', "need('physical_installation_unreadable')", "need('already_adopted')", 'C2b should require adoption when the physical installation is unreadable'],
  ['adoption', 'target-shape', 'checkTargetShape(target);', '', 'C2b should refuse an invalid adoption assessment envelope'],
  ['adoption', 'opt-out-check', 'if (management.optedOut === true) return need(\'management_opted_out\');', '', 'D should require no automatic adoption while management opted out'],
  ['adoption', 'opt-out-reason', "need('management_opted_out')", "need('already_adopted')", 'D should report opt-out even when nothing is managed yet'],
  ['launcher-install', 'drift-check', 'assertBootstrapSessionUnchanged(session);', '', 'C2b should write nothing when the installation drifted since the session opened'],
  ['launcher-install', 'digest-record', "const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');", "const digest = 'sha256:' + '0'.repeat(64);", 'C2b should record the exact digest of the installed launcher bytes'],
  ['launcher-install', 'launcher-mode', 'fs.writeFileSync(launcherPath, bytes, { mode: 0o755 });', 'fs.writeFileSync(launcherPath, bytes);', 'C2b should install the managed launcher and link the command atomically'],
  ['launcher-install', 'launcher-dir-mode', "fs.mkdirSync(launcherDir, { recursive: true, mode: 0o700 });", 'fs.mkdirSync(launcherDir, { recursive: true });', 'C2b should install the managed launcher and link the command atomically'],
  ['launcher-install', 'launcher-filename', "join(launcherDir, 'h2a.mjs')", "join(launcherDir, 'h2a.cjs')", 'C2b should install the managed launcher and link the command atomically'],
  ['adoption-execute', 'need-shortcut', 'if (!need.needed) return Object.freeze({ completed: false, reason: need.reason });', 'if (!need.needed) return Object.freeze({ completed: true, reason: need.reason });', 'C2b should return already adopted without mutating when selection matches'],
  ['adoption-execute', 'exclusion-wiring', 'store.select(upgradeId, { exclusion })', 'store.select(upgradeId)', 'C2b should install the launcher but defer selection while exclusion is unfenced'],
  ['adoption-execute', 'session-revalidate', 'assertBootstrapSessionUnchanged(session);', '', 'C2b should write nothing when the session drifted before adoption'],
  ['adoption-execute', 'install-call', 'const installation = installManagedLauncher({ session, launcherSource, managedDir, commandPath });', 'const installation = null;', 'C2b should execute adoption from session to selected build'],
  ['unmanage', 'engaged-check', 'if (!QUIESCENT.has(tx.installationState)) throw new Error(`unmanage_transaction_engaged:${tx.installationState}`);', '', 'D should refuse while a prepared transaction is still engaged'],
  ['unmanage', 'unrestorable-check', "try { fs.statSync(originalTarget); } catch { throw new Error('unmanage_link_unrestorable'); }", '', 'D should refuse an unrestorable original link without touching the command'],
  ['unmanage', 'marker-write', "fs.renameSync(markerTmp, join(managedDir, 'unmanaged.json'));", '', 'D should restore the original command link and mark the installation unmanaged'],
  ['unmanage', 'marker-reason', "reason: 'operator_unmanage'", "reason: 'automatic'", 'D should restore the original command link and mark the installation unmanaged'],
  ['unmanage', 'opt-out-absent', 'return Object.freeze({ optedOut: false });', 'return Object.freeze({ optedOut: true, reason: \'marker_unreadable\' });', 'D should report opt-out from the unmanaged marker'],
  ['unmanage', 'opt-out-unreadable', "return Object.freeze({ optedOut: true, reason: 'marker_unreadable' });", 'return Object.freeze({ optedOut: false });', 'D should fail closed on an unreadable opt-out marker'],
  ['adoption-image', 'drift-check', 'assertBootstrapSessionUnchanged(session);', '', 'C2b should prepare nothing when the installation drifted since the session opened'],
  ['adoption-image', 'digest-check', "if (digest(manifest) !== expectedDigest) throw new Error('adoption_image_digest_mismatch');", '', 'C2b should refuse a stage whose digest differs from the expected image'],
  ['adoption-image', 'runtime-check', 'assertImageRuntime(manifest);', '', 'C2b should refuse an image outside the qualified runtime profile'],
  ['adoption-image', 'conflict-check', `if (clash) {
    verifyImage(dest, manifest, expectedDigest);
    return Object.freeze({ manifestDigest: expectedDigest, imageDir: dest });
  }`, '', 'C2b should refuse a conflicting image already occupying the digest address'],
  ['status', 'deferred-wiring', 'const deferred = !terminal && exclusion && exclusion.fenced === false;', 'const deferred = false;', 'F should report deferred while legacy exclusion stays unfenced'],
  ['status', 'aborted-mapping', "ABORTED: 'failed'", "ABORTED: 'completed'", 'F should report completion and failure terminally'],
  ['status', 'unknown-default', "? 'unchanged' : 'unknown'", "? 'unchanged' : 'unchanged'", 'F should report the durable selection once selected'],
  ['status', 'selection-provenance', "if (durableRecord.value[key] !== store.installation[key]) throw new Error('foreign_installation_authority');", '', 'F should refuse a durable selection from another installation'],
  ['status', 'reason-wiring', '`selection_deferred:${exclusion.reason}`', "'selection_deferred'", 'F should report deferred while legacy exclusion stays unfenced'],
  ['upgrade-run', 'opt-out-skip', `if (optOut.optedOut === true && explicit !== true) {
    return Object.freeze({ completed: false, reason: 'management_opted_out' });
  }`, '', 'F should skip without mutating while management opted out'],
  ['upgrade-run', 'need-report', "if (!need.needed) return Object.freeze({ completed: false, reason: need.reason });", "if (!need.needed) return Object.freeze({ completed: true, reason: need.reason });", 'F should report already adopted without a second transaction'],
  ['upgrade-run', 'execute-skip', 'return executeAdoption({ session, store, upgradeId, target, launcherSource, managedDir, commandPath, exclusion });', 'return Object.freeze({ completed: true, upgradeId });', 'F should execute the needed upgrade once end to end'],
  ['upgrade-run', 'exclusion-forward', 'managedDir, commandPath, exclusion });', 'managedDir, commandPath });', 'F should propagate the exclusion deferral instead of selecting'],
  ['npm-command', 'managed-path', "if (actual === managedLauncher) return Object.freeze({ state: 'managed', action: 'none' });", '', 'D should report a managed command link'],
  ['npm-command', 'legacy-path', "if (actual === legacyEntry) return Object.freeze({ state: 'legacy', action: 'adopt' });", '', 'D should report a legacy command link awaiting adoption'],
  ['npm-command', 'missing-report', "return Object.freeze({ state: 'missing', action: 'install' });", "return Object.freeze({ state: 'managed', action: 'none' });", 'D should report a missing command link after uninstall'],
  ['npm-command', 'occupied-report', "return Object.freeze({ state: 'occupied', action: 'force-required', kind: 'file' });", "return Object.freeze({ state: 'managed', action: 'none' });", 'D should require force where a plain file occupies the command path'],
  ['npm-command', 'dangling-report', "return Object.freeze({ state: 'dangling', action: 'diagnose', actual });", "return Object.freeze({ state: 'legacy', action: 'adopt' });", 'D should report a dangling command link for diagnosis'],
  ['authority', 'mismatch-check', "if (digest(tx.controllerIdentity) !== digest(controller ?? currentIdentity())) {", 'if (false) {', 'F should refuse a foreign controller with a CLI-level reason'],
  ['authority', 'revoked-check', "if (tx.controllerAuthorityState !== 'ACTIVE') throw new Error('upgrade_authority_revoked');", '', 'F should refuse a controller revoked by delegation'],
  ['authority', 'epoch-report', 'epoch: tx.controllerEpoch', 'epoch: tx.controllerEpoch + 1', 'F should authorize the bound controller on its transaction'],
  ['authority', 'foreign-reason', "throw new Error('upgrade_authority_foreign');", "throw new Error('upgrade_authority_revoked');", 'F should refuse a foreign controller with a CLI-level reason'],
  ['cli', 'unknown-flag', "if (token.startsWith('-')) usage('unknown_flag');", "if (token.startsWith('-')) continue;", 'F should refuse unknown flags and misplaced options instead of guessing'],
  ['cli', 'misplaced-flag', "status: ['json'],", "status: ['json', 'strict'],", 'F should refuse unknown flags and misplaced options instead of guessing'],
  ['cli', 'missing-id', "usage('upgrade_id_required');", '', 'F should require the transaction identity for resume abort and compensate'],
  ['cli', 'unknown-component', "if (!COMPONENTS.includes(intent.component)) usage('unknown_component');", '', 'F should require a known component for compensation'],
  ['cli', 'failed-code', 'if (failed === true) return 1;', 'if (failed === true) return 0;', 'F should map success failure and deferral to exit codes'],
  ['cli', 'completed-code', 'if (completed === true) return 0;', 'if (completed === true) return 2;', 'F should map success failure and deferral to exit codes'],
  ['cli', 'strict-code', 'if (deferred === true) return strict === true ? 2 : 0;', 'if (deferred === true) return strict === true ? 0 : 2;', 'F should make deferral blocking under strict'],
  ['dispatch', 'resume-authority', `const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.reconcile(upgradeId);`, `const grant = { epoch: 0 };
  const tx = store.reconcile(upgradeId);`, 'F should check CLI authority before the engine on resume'],
  ['dispatch', 'abort-authority', `const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.abort(upgradeId);`, `const grant = { epoch: 0 };
  const tx = store.abort(upgradeId);`, 'F should check CLI authority before the engine on abort'],
  ['dispatch', 'resume-call', 'const tx = store.reconcile(upgradeId);', 'const tx = store.abort(upgradeId);', 'F should resume a prepared transaction without changing its phase'],
  ['dispatch', 'abort-call', 'const tx = store.abort(upgradeId);', 'const tx = store.reconcile(upgradeId);', 'F should abort a prepared transaction once'],
  ['dispatch', 'controller-shape', "(controller !== undefined && (!controller || typeof controller !== 'object' || Array.isArray(controller)))", '(false)', 'F should refuse an invalid dispatch envelope instead of guessing'],
  ['dispatch', 'resume-frozen', `const tx = store.reconcile(upgradeId);
  return Object.freeze({ upgradeId, installationState: tx.installationState, controllerEpoch: grant.epoch });`, `const tx = store.reconcile(upgradeId);
  return Object.freeze({ upgradeId, installationState: 'SELECTED', controllerEpoch: grant.epoch });`, 'F should resume a prepared transaction without changing its phase'],
  ['command-gate', 'gate-call', 'const verdict = assessNpmCommand({ commandPath, managedLauncher: launcherPath, legacyEntry });', "const verdict = { state: 'missing' };", 'F should refuse a plain-file occupant instead of replacing it'],
  ['command-gate', 'occupied-gate', "if (verdict.state === 'occupied') throw new Error('bootstrap_launcher_command_occupied');", '', 'F should refuse a plain-file occupant instead of replacing it'],
  ['command-gate', 'foreign-gate', "if (verdict.state === 'foreign') throw new Error('bootstrap_launcher_command_foreign');", '', 'F should refuse a foreign command link instead of replacing it'],
  ['command-gate', 'dangling-gate', "if (verdict.state === 'dangling') throw new Error('bootstrap_launcher_command_dangling');", '', 'F should refuse a dangling command link for diagnosis'],
];
const files = group === 'launcher' ? ['packages/h2a/src/runtime/upgrade/managed-launcher.js'] :
  group === 'exclusion' ? ['packages/h2a/src/runtime/upgrade/legacy-exclusion.js', 'packages/h2a/dist/runtime/upgrade/legacy-exclusion.js'] :
  group === 'bootstrap' ? ['packages/h2a/src/runtime/upgrade/bootstrap-session.js', 'packages/h2a/dist/runtime/upgrade/bootstrap-session.js'] :
  group === 'adoption' ? ['packages/h2a/src/runtime/upgrade/adoption-need.js', 'packages/h2a/dist/runtime/upgrade/adoption-need.js'] :
  group === 'launcher-install' ? ['packages/h2a/src/runtime/upgrade/launcher-install.js', 'packages/h2a/dist/runtime/upgrade/launcher-install.js'] :
  group === 'adoption-execute' ? ['packages/h2a/src/runtime/upgrade/adoption-execute.js', 'packages/h2a/dist/runtime/upgrade/adoption-execute.js'] :
  group === 'unmanage' ? ['packages/h2a/src/runtime/upgrade/unmanage.js', 'packages/h2a/dist/runtime/upgrade/unmanage.js'] :
  group === 'adoption-image' ? ['packages/h2a/src/runtime/upgrade/adoption-image.js', 'packages/h2a/dist/runtime/upgrade/adoption-image.js'] :
  group === 'status' ? ['packages/h2a/src/runtime/upgrade/status-report.js', 'packages/h2a/dist/runtime/upgrade/status-report.js'] :
  group === 'upgrade-run' ? ['packages/h2a/src/runtime/upgrade/upgrade-run.js', 'packages/h2a/dist/runtime/upgrade/upgrade-run.js'] :
  group === 'npm-command' ? ['packages/h2a/src/runtime/upgrade/npm-command.js', 'packages/h2a/dist/runtime/upgrade/npm-command.js'] :
  group === 'authority' ? ['packages/h2a/src/runtime/upgrade/upgrade-authority.js', 'packages/h2a/dist/runtime/upgrade/upgrade-authority.js'] :
  group === 'cli' ? ['packages/h2a/src/runtime/upgrade/upgrade-cli.js', 'packages/h2a/dist/runtime/upgrade/upgrade-cli.js'] :
  group === 'dispatch' ? ['packages/h2a/src/runtime/upgrade/upgrade-dispatch.js', 'packages/h2a/dist/runtime/upgrade/upgrade-dispatch.js'] :
  group === 'command-gate' ? ['packages/h2a/src/runtime/upgrade/launcher-install.js', 'packages/h2a/dist/runtime/upgrade/launcher-install.js'] :
  ['packages/h2a/src/runtime/upgrade/h4-store.js', 'packages/h2a/dist/runtime/upgrade/h4-store.js'];
const originals = files.map(path => ({ path, bytes: fs.readFileSync(path) }));
const selected = cases.filter(c => c[0] === group && (!process.env.MH_L6_MUTATION || c[1] === process.env.MH_L6_MUTATION));
if (!selected.length) throw new Error('unknown_mutation_group');
const testFile = { delegation: 'delegation', launcher: 'launcher', exclusion: 'exclusion', deferral: 'exclusion', bootstrap: 'bootstrap', adoption: 'adoption', 'launcher-install': 'launcher-install', 'adoption-execute': 'adoption', unmanage: 'unmanage', 'adoption-image': 'image-prepare', status: 'status', 'upgrade-run': 'upgrade-run', 'npm-command': 'npm', authority: 'authority', cli: 'cli', dispatch: 'dispatch', 'command-gate': 'command-gate' }[group] ?? 'selection';
const file = `packages/h2a/test/mh-l6-${testFile}.test.js`;
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
