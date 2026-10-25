// Qualification-only observer, preloaded by the harness-owned native host.
// Product controller fencing and PTY writes run unchanged. Raw input stays
// inside the private cell and is wiped; only the filtered proof is published.
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inside } from './xcli-lab.mjs';

export function journalNativeInput(Host, file, now = Date.now) {
  for (const method of ['write', 'releaseController']) {
    const original = Host.prototype[method];
    Host.prototype[method] = function (lease, data) {
      const at = now();
      const result = original.call(this, lease, data);
      fs.appendFileSync(file, JSON.stringify({ event: method === 'write' ? 'input' : 'release',
        at, id: lease.id, incarnation: lease.incarnation, controllerId: lease.controllerId,
        epoch: lease.epoch, ...(method === 'write' ? { data } : {}) }) + '\n', { mode: 0o600 });
      return result;
    };
  }
}

export function correlateWakeInput(records, { target, barrierAt, releaseAt, send, receiver, probe, product, store }) {
  const inputs = records.filter(e => e.event === 'input' && e.id === target.id &&
    e.incarnation === target.incarnation && e.at >= barrierAt);
  const [line, submit] = inputs;
  let correlated = false;
  if (inputs.length === 2 && line.at >= releaseAt && line.data && submit.data === '\r' &&
      line.controllerId.startsWith('h2a-drive-') && line.controllerId === submit.controllerId &&
      line.epoch === submit.epoch && submit.at > line.at) {
    const parsed = product.parseSignedDriveInstruction(line.data);
    const verified = product.verifySignedDriveInstruction(line.data, {
      resolvePublicKeys: instance => store.listInstanceKeys(instance), guard: product.createReplayGuard(), now: submit.at,
    });
    // The product wakes itself: outer signer/target = receiver. The inner
    // tag names the witnessed sender and this exact probe's topic and time.
    const tagAt = /^\[h2a-wake reason=inbox from=\S+ topic=\S+ at=([^\]]+)\]/.exec(parsed?.payload.instruction ?? '')?.[1];
    correlated = verified.ok && parsed?.payload.from === receiver && parsed.payload.to === receiver &&
      probe?.id === send.envelopeId && probe.actor.instance === send.from && probe.target.instance === receiver &&
      parsed.payload.instruction === product.formatWakeLine([probe], tagAt) &&
      Date.parse(tagAt) >= Date.parse(probe.createdAt) && Date.parse(tagAt) <= Date.parse(parsed.payload.at) &&
      Date.parse(parsed.payload.at) <= line.at;
  }
  return { correlated: Boolean(correlated), onlyWakeInput: inputs.length === 2 && Boolean(correlated),
    writes: inputs.length, lineAt: line?.at ?? null, submitAt: submit?.at ?? null,
    ...(correlated ? { sender: send.from, receiver, envelopeId: send.envelopeId,
      lineSha256: createHash('sha256').update(line.data).digest('hex') } : {}) };
}

if (process.env.XCLI_INPUT_JOURNAL) {
  const { NativeTerminalHost } = await import(pathToFileURL(join(process.env.XCLI_BUILD,
    'packages/h2a-runtime/dist/native-terminal/host.js')));
  journalNativeInput(NativeTerminalHost, inside(process.env.XCLI_CELL, process.env.XCLI_INPUT_JOURNAL));
}
