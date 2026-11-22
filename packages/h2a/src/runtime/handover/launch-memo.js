import fs from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './wire.js';
import { readState, publishState, replaceState } from './state.js';

export class LaunchJournal {
  constructor({ registry, token, ledger, root }) { Object.assign(this, { registry, token, ledger, root }); }
  path(name) { return join(this.registry.directory, `launch-${digest({ attachmentId: this.token.attachmentId, launchName: name }).slice(7)}.json`); }
  memos() {
    this.registry.syncIfExternalChange();
    const map = this.registry.launchesByAttachment.get(this.token.attachmentId);
    return map ? [...map.values()] : [];
  }
  argumentsDigest(request) { const { launchAuthority: _authority, ...args } = request; return digest(args); }
  result(memo) { return memo.terminalResult ?? { state: memo.state === 'unknown' || memo.state === 'reserved' ? 'unknown' : 'launching', launchId: memo.launchId, retrySafe: false }; }
  operation(memo, kind) {
    return this.ledger.getOperation(`${memo.launchId}:${kind}`);
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
      const locPath = join(this.registry.directory, `launch-location-${launchId}.json`);
      const location = { schemaVersion: 1, launchId,
        attachmentId: this.token.attachmentId, workspaceRoot: resolve(this.root), delegation: request.delegation ?? null };
      publishState(locPath, location, 'launchLocation');
      this.registry.recordLaunchLocation(locPath, location);
      publishState(path, memo, 'launchMemo');
      this.registry.recordLaunchMemo(path, memo);
      this.registry.bump();
      const child = this.ledger.begin(this.token, `${launchId}:child`, 'child');
      const brief = this.ledger.begin(this.token, `${launchId}:brief`, 'brief');
      const observed = readState(path, 'launchMemo');
      const launchingMemo = { ...memo, state: 'launching' };
      replaceState(path, launchingMemo, 'launchMemo', observed);
      this.registry.recordLaunchMemo(path, launchingMemo);
      this.registry.bump();
      return { path, memo, secret, child, brief };
    });
    if (reserved.existing) return this.result(reserved.existing);
    const onSpawn = childProcessIdentity => this.registry.withLock(() => {
      const old = readState(reserved.path, 'launchMemo');
      const updated = { ...old.value, childProcessIdentity };
      replaceState(reserved.path, updated, 'launchMemo', old);
      this.registry.recordLaunchMemo(reserved.path, updated);
      this.registry.bump();
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
      replaceState(reserved.path, memo, 'launchMemo', old);
      this.registry.recordLaunchMemo(reserved.path, memo);
      this.registry.bump();
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
  async launchAsync(request, execute) {
    const reserved = await this.registry.withLockAsync(() => {
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
      if (launchReceiptReference.startsWith('../') || !launchReceiptReference) throw new Error('launch_workspace_outside_root');
      const memo = { schemaVersion: 1, attachmentId: this.token.attachmentId, launchName: request.name, launchId,
        initialArgumentsDigest, state: 'reserved', executionOwner: this.token.ownerProcessIdentity,
        childProcessIdentity: null, launchReceiptReference, launchTokenBinding: digest(secret), briefReceipt: null, terminalResult: null, retrySafe: false };
      const locPath = join(this.registry.directory, `launch-location-${launchId}.json`);
      const location = { schemaVersion: 1, launchId,
        attachmentId: this.token.attachmentId, workspaceRoot: resolve(this.root), delegation: request.delegation ?? null };
      publishState(locPath, location, 'launchLocation');
      this.registry.recordLaunchLocation(locPath, location);
      publishState(path, memo, 'launchMemo');
      this.registry.recordLaunchMemo(path, memo);
      this.registry.bump();
      const child = this.ledger.begin(this.token, `${launchId}:child`, 'child');
      const brief = this.ledger.begin(this.token, `${launchId}:brief`, 'brief');
      const observed = readState(path, 'launchMemo');
      const launchingMemo = { ...memo, state: 'launching' };
      replaceState(path, launchingMemo, 'launchMemo', observed);
      this.registry.recordLaunchMemo(path, launchingMemo);
      this.registry.bump();
      return { path, memo, secret, child, brief };
    });
    if (reserved.existing) return this.result(reserved.existing);
    let spawnWrite = Promise.resolve();
    const onSpawn = childProcessIdentity => {
      const p = this.registry.withLockAsync(() => {
        const old = readState(reserved.path, 'launchMemo');
        if (!old || old.value.state === 'completed') return;
        const updated = { ...old.value, childProcessIdentity };
        replaceState(reserved.path, updated, 'launchMemo', old);
        this.registry.recordLaunchMemo(reserved.path, updated);
        this.registry.bump();
      }).catch(() => { /* best effort; terminal memo write or reconciliation settles state */ });
      spawnWrite = spawnWrite.then(() => p);
      return p;
    };
    const finish = async result => {
      await spawnWrite;
      const terminal = result && typeof result === 'object' ? result : { state: 'unknown', retrySafe: false };
      let persistedTerminal = false;
      try {
        return await this.registry.withLockAsync(() => {
          const old = readState(reserved.path, 'launchMemo');
          const complete = ['started', 'stopped', 'not-started'].includes(terminal.state);
          const briefKnown = terminal.state !== 'started' || terminal.prompt?.delivered === true;
          const memo = { ...old.value, state: complete && briefKnown ? 'completed' : 'unknown',
            terminalResult: terminal, briefReceipt: terminal.prompt?.delivered === true ? { delivered: true, launchId: old.value.launchId } : null,
            retrySafe: terminal.state === 'not-started' && terminal.retrySafe === true };
          replaceState(reserved.path, memo, 'launchMemo', old);
          this.registry.recordLaunchMemo(reserved.path, memo);
          this.registry.bump();
          persistedTerminal = true;
          try {
            this.publishDelegation(memo, terminal);
            this.ledger.finish(reserved.child, terminal, !complete);
            this.ledger.finish(reserved.brief, memo.briefReceipt ?? terminal, !complete || !briefKnown);
          } catch {
            // Terminal memo is already durable; reconciliation closes remaining ledger entries.
          }
          return terminal;
        });
      } catch (error) {
        if (persistedTerminal) return terminal;
        throw error;
      }
    };
    const fail = error => finish({ state: 'unknown', launchId: reserved.memo.launchId, retrySafe: false, error: String(error) });
    let result;
    try { result = await execute({ ...request, launchAuthority: { token: reserved.secret, launchId: reserved.memo.launchId, onSpawn } }); }
    catch (error) { return fail(error); }
    return finish(result);
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
      const completed = { ...old.value, state: 'completed', terminalResult: result, retrySafe: false };
      replaceState(path, completed, 'launchMemo', old);
      this.registry.recordLaunchMemo(path, completed);
      this.registry.bump();
      this.publishDelegation(completed, result);
      if (child && child.state !== 'completed') this.ledger.finish(child, result);
      const brief = this.operation(completed, 'brief');
      if (brief && brief.state !== 'completed') this.ledger.finish(brief, result);
      return completed;
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
    const location = this.registry.launchLocationsById.get(memo.launchId)
      ?? readState(join(this.registry.directory, `launch-location-${memo.launchId}.json`), 'launchLocation')?.value;
    if (!location || location.attachmentId !== memo.attachmentId) throw new Error('launch_location_missing');
    if (location.delegation === null) return undefined;
    const operation = this.operation(memo, 'child');
    if (!operation) throw new Error('operation_fenced');
    return this.ledger.publishEffect(operation, { type: 'launch-delegation', launchId: memo.launchId,
      delegation: location.delegation, terminalResult: result });
  }
  /** @param {{generation: string, processIdentity: object} | undefined} [scope] */
  static reconcileAll(registry, ledger, scope = undefined) {
    registry.syncIfExternalChange();
    for (const memo of registry.allLaunchMemos()) {
      if (scope && digest(memo.executionOwner) !== digest(scope.processIdentity)) continue;
      const location = registry.launchLocationsById.get(memo.launchId)
        ?? readState(join(registry.directory, `launch-location-${memo.launchId}.json`), 'launchLocation')?.value;
      if (!location || location.attachmentId !== memo.attachmentId) continue;
      const journal = new LaunchJournal({ registry, ledger, token: { attachmentId: memo.attachmentId }, root: location.workspaceRoot });
      if (memo.state === 'completed') {
        journal.settleCompleted(memo);
      } else {
        const observed = readState(journal.path(memo.launchName), 'launchMemo');
        if (observed) journal.reconcileMemo(observed);
      }
    }
  }
}
