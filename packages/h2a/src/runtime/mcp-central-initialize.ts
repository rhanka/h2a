import type { Readable } from 'node:stream';

/** Peek without consuming: the selected transport receives the original bytes. */
export function inspectFirstInitialize(input: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      input.removeListener('readable', read);
      input.removeListener('end', end);
      input.removeListener('error', error);
    };
    const finish = (message: unknown) => {
      if (settled) return; settled = true; cleanup();
      // Includes blank lines, initialize and any pipelined tail in the chunk.
      if (bytes) input.unshift(Buffer.concat(chunks, bytes));
      resolve(message);
    };
    const error = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const end = () => finish(undefined);
    const read = () => {
      let chunk: Buffer | null;
      while ((chunk = input.read() as Buffer | null) !== null) {
        chunks.push(Buffer.from(chunk)); bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { error(new Error('initialize_frame_budget_exceeded')); return; }
        const complete = Buffer.concat(chunks, bytes).toString('utf8');
        const line = complete.split('\n').slice(0, -1).find(line => line.trim());
        if (line !== undefined) {
          try { finish(JSON.parse(line)); } catch { finish(undefined); }
          return;
        }
      }
    };
    input.on('readable', read);
    input.once('end', end);
    input.once('error', error);
    if (input.readableEnded) end();
    else read();
  });
}
