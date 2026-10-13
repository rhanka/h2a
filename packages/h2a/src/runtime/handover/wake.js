import fs from 'node:fs';
import { join } from 'node:path';
import { digest } from './wire.js';
import { readState, publishState, replaceState } from './state.js';

export class WakeJournal {
  constructor({ registry, token, ledger }) { this.registry = registry; this.token = token; this.ledger = ledger; this.pending = undefined; }
  intents() {
    return fs.readdirSync(this.registry.directory).filter(p => p.startsWith('wake-'))
      .map(p => readState(join(this.registry.directory, p), 'wakeIntent').value).filter(v => v.attachmentId === this.token.attachmentId);
  }
  snapshot() { return { intents: this.intents() }; }
  eligibleEnvelopeIds(ids) {
    const blocked = new Set(this.intents().filter(v => ['unknown', 'delivered'].includes(v.state)).flatMap(v => v.envelopeIds));
    return ids.filter(id => !blocked.has(id));
  }
  perform(ids, instructionLine, inject) {
    if (this.pending) return this.pending;
    this.pending = this.execute(ids, instructionLine, inject).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async execute(ids, instructionLine, inject) {
    const ticket = this.registry.withLock(() => {
      this.registry.assertOwner(this.token);
      const eligible = this.eligibleEnvelopeIds([...new Set(ids)].sort());
      if (!eligible.length) return null;
      const key = digest({ attachmentId: this.token.attachmentId, envelopeIds: eligible });
      const path = join(this.registry.directory, `wake-${key.slice(7)}.json`);
      let old = readState(path, 'wakeIntent');
      if (!old) old = publishState(path, { schemaVersion: 1, revision: 1, attachmentId: this.token.attachmentId,
        key, envelopeIds: eligible, instructionLine, state: 'intent', result: null }, 'wakeIntent');
      // Commit the possible effect before invoking the driver. A lost receipt
      // remains UNKNOWN even when a restart sees that no outcome was written.
      const operation = this.ledger.begin(this.token, `wake:${key}:${old.value.revision}`, 'wake');
      const started = replaceState(path, { ...old.value, revision: old.value.revision + 1, state: 'unknown', result: null }, 'wakeIntent', old);
      this.registry.bump();
      return { path, started, operation, instructionLine: old.value.instructionLine };
    });
    if (!ticket) return false;
    let result;
    try { result = await inject(ticket.instructionLine); }
    catch (error) {
      this.ledger.finish(ticket.operation, { state: 'unknown', error: String(error) }, true);
      return false;
    }
    if (result !== true && result !== false) {
      this.ledger.finish(ticket.operation, { state: 'unknown' }, true); return false;
    }
    this.registry.withLock(() => {
      replaceState(ticket.path, { ...ticket.started.value, revision: ticket.started.value.revision + 1,
        state: result ? 'delivered' : 'deferred', result }, 'wakeIntent', ticket.started);
      this.registry.bump();
      this.ledger.finish(ticket.operation, { delivered: result });
    });
    return result;
  }
}
