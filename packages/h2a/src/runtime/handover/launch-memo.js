import fs from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './wire.js';
import { readState, publishState, replaceState } from './state.js';

export class LaunchJournal {
  constructor({ registry, token, ledger, root }) { Object.assign(this, { registry, token, ledger, root }); }
  path(name) { return join(this.registry.directory, `launch-${digest({ attachmentId: this.token.attachmentId, launchName: name }).slice(7)}.json`); }
  memos() { return fs.readdirSync(this.registry.directory).filter(p => /^launch-[a-f0-9]+\.json$/.test(p)).map(p => readState(join(this.registry.directory, p), 'launchMemo').value).filter(v => v.attachmentId === this.token.attachmentId); }
  argumentsDigest(request) { const { launchAuthority: _authority, ...args } = request; return digest(args); }
  result(memo) { return memo.terminalResult ?? { state: memo.state === 'unknown' || memo.state === 'reserved' ? 'unknown' : 'launching', launchId: memo.launchId, retrySafe: false }; }
  operation(memo, kind) {
    return this.ledger.operations().find(v => v.operationId === `${memo.launchId}:${kind}`);
  }
  launch(request, execute) {
    const reserved = this.registry.withLock(() => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(request.name)) throw new Error('launch_name_invalid');
      const path = this.path(request.name), old = readState(path, 'launchMemo');
      const initialArgumentsDigest = this.argumentsDigest(request);
      if (old) {
        if (old.value.initialArgumentsDigest !== initialArgumentsDigest) throw new Error('launch_arguments_conflict');
        return { existing: this.reconcileMemo(old) };
      }
      this.registry.assertOwner(this.token);
      const launchId = randomUUID(), secret = randomUUID();
      const launchReceiptReference = relative(resolve(this.root), join(resolve(request.workspace), '.h2a', 'runs', request.name, 'launch.json'));
      // Receipt access cannot escape the namespace/workspace captured by this authority.
      if (launchReceiptReference.startsWith('../') || !launchReceiptReference) throw new Error('launch_workspace_outside_root');
      const memo = { schemaVersion: 1, attachmentId: this.token.attachmentId, launchName: request.name, launchId,
        initialArgumentsDigest, state: 'reserved', executionOwner: this.token.ownerProcessIdentity,
        childProcessIdentity: null, launchReceiptReference, launchTokenBinding: digest(secret), briefReceipt: null, terminalResult: null, retrySafe: false };
      publishState(join(this.registry.directory, `launch-location-${launchId}.json`), { schemaVersion: 1, launchId,
        attachmentId: this.token.attachmentId, workspaceRoot: resolve(this.root), delegation: request.delegation ?? null }, 'launchLocation');
      publishState(path, memo, 'launchMemo'); this.registry.bump();
      const child = this.ledger.begin(this.token, `${launchId}:child`, 'child');
      const brief = this.ledger.begin(this.token, `${launchId}:brief`, 'brief');
      const observed = readState(path, 'launchMemo');
      replaceState(path, { ...memo, state: 'launching' }, 'launchMemo', observed); this.registry.bump();
      return { path, memo, secret, child, brief };
    });
    if (reserved.existing) return this.result(reserved.existing);
    const onSpawn = childProcessIdentity => this.registry.withLock(() => {
      const old = readState(reserved.path, 'launchMemo');
      replaceState(reserved.path, { ...old.value, childProcessIdentity }, 'launchMemo', old); this.registry.bump();
    });
    const finish = result => this.registry.withLock(() => {
      const old = readState(reserved.path, 'launchMemo');
      const terminal = result && typeof result === 'object' ? result : { state: 'unknown', retrySafe: false };
      const complete = ['started', 'stopped', 'not-started'].includes(terminal.state);
      const briefKnown = terminal.state !== 'started' || terminal.prompt?.delivered === true;
      const memo = { ...old.value, state: complete && briefKnown ? 'completed' : 'unknown',
        terminalResult: terminal, briefReceipt: terminal.prompt?.delivered === true ? { delivered: true, launchId: old.value.launchId } : null,
        retrySafe: terminal.state === 'not-started' && terminal.retrySafe === true };
      // Persist the final reply before the HTTP/MCP response can be lost.
      replaceState(reserved.path, memo, 'launchMemo', old); this.registry.bump();
      this.publishDelegation(memo, terminal);
      this.ledger.finish(reserved.child, terminal, !complete);
      this.ledger.finish(reserved.brief, memo.briefReceipt ?? terminal, !complete || !briefKnown);
      return terminal;
    });
    const fail = error => finish({ state: 'unknown', launchId: reserved.memo.launchId, retrySafe: false, error: String(error) });
    let result;
    try { result = execute({ ...request, launchAuthority: { token: reserved.secret, launchId: reserved.memo.launchId, onSpawn } }); }
    catch (error) { return fail(error); }
    // A failure AFTER the final memo is persisted must never replace its
    // proven result with UNKNOWN. Reconciliation closes the remaining ledger.
    return result?.then ? result.then(finish, fail) : finish(result);
  }
  reconcile(request) {
    return this.registry.withLock(() => {
      const path = this.path(request.name), old = readState(path, 'launchMemo');
      if (!old || old.value.initialArgumentsDigest !== this.argumentsDigest(request)) throw new Error('launch_arguments_conflict');
      return this.result(this.reconcileMemo(old));
    });
  }
  reconcileMemo(old) {
      const path = this.path(old.value.launchName);
      if (old.value.state === 'completed') {
        // Completion is persisted before ledger closure. Lost ACK/crash in that
        // window is resolved from this exact terminal receipt, never by replay.
        this.settleCompleted(old.value);
        return old.value;
      }
      const receiptPath = join(this.root, old.value.launchReceiptReference);
      let receipt;
      try {
        if (!fs.lstatSync(receiptPath).isFile()) return old.value;
        receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      } catch { return old.value; }
      if (typeof receipt.token !== 'string' || digest(receipt.token) !== old.value.launchTokenBinding) return old.value;
      if (!['started', 'stopped'].includes(receipt.state)) return old.value;
      const child = this.operation(old.value, 'child');
      if (receipt.state === 'started') {
        if (child && child.state !== 'completed') this.ledger.finish(child, { state: receipt.state, receipt: old.value.launchReceiptReference });
        return old.value; // Existing guard does not attest brief delivery.
      }
      const result = { state: 'stopped', launchId: old.value.launchId, retrySafe: false };
      replaceState(path, { ...old.value, state: 'completed', terminalResult: result, retrySafe: false }, 'launchMemo', old); this.registry.bump();
      this.publishDelegation(old.value, result);
      if (child && child.state !== 'completed') this.ledger.finish(child, result);
      const brief = this.operation(old.value, 'brief');
      if (brief && brief.state !== 'completed') this.ledger.finish(brief, result);
      return { ...old.value, state: 'completed', terminalResult: result, retrySafe: false };
  }
  settleCompleted(memo) {
    this.publishDelegation(memo, memo.terminalResult);
    for (const kind of ['child', 'brief']) {
      const operation = this.operation(memo, kind);
      if (operation && operation.state !== 'completed') this.ledger.finish(operation,
        kind === 'brief' ? memo.briefReceipt ?? memo.terminalResult : memo.terminalResult);
    }
  }
  publishDelegation(memo, result) {
    const location = readState(join(this.registry.directory, `launch-location-${memo.launchId}.json`), 'launchLocation')?.value;
    if (!location || location.attachmentId !== memo.attachmentId) throw new Error('launch_location_missing');
    if (location.delegation === null) return undefined;
    const operation = this.operation(memo, 'child');
    if (!operation) throw new Error('operation_fenced');
    return this.ledger.publishEffect(operation, { type: 'launch-delegation', launchId: memo.launchId,
      delegation: location.delegation, terminalResult: result });
  }
  static reconcileAll(registry, ledger) {
    for (const name of fs.readdirSync(registry.directory).filter(p => /^launch-[a-f0-9]+\.json$/.test(p))) {
      const observed = readState(join(registry.directory, name), 'launchMemo');
      const memo = observed.value;
      const location = readState(join(registry.directory, `launch-location-${memo.launchId}.json`), 'launchLocation')?.value;
      if (!location || location.attachmentId !== memo.attachmentId) continue;
      const journal = new LaunchJournal({ registry, ledger, token: { attachmentId: memo.attachmentId }, root: location.workspaceRoot });
      journal.reconcileMemo(observed);
    }
  }
}
