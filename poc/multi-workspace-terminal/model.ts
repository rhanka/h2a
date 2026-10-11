import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export class InputDecoder {
  private readonly decoder = new StringDecoder('utf8');
  write(data: Buffer): string { return this.decoder.write(data); }
}

export type Status = 'running' | 'waiting-for-input-question' | 'idle' | 'exited';
export function classifyStatus(state: string, screen: string, lastOutput: number, now = Date.now()): Status {
  if (state === 'exited') return 'exited';
  const prompt = screen.trimEnd().split('\n').at(-1) ?? '';
  if (/(\[y\/n\]|\(y\/n\)|\[yes\/no\]|\(yes\/no\)|press enter|continue\?)\s*[:>]?$|\?\s*$/i.test(prompt.trim())) {
    return 'waiting-for-input-question';
  }
  return now - lastOutput >= 1500 ? 'idle' : 'running';
}
export function aggregateStatus(statuses: Status[]): Status {
  return (['waiting-for-input-question', 'running', 'idle', 'exited'] as Status[])
    .find(status => statuses.includes(status)) ?? 'exited';
}
export function sessionId(workspace: string, name: string): string {
  return `mwt-${createHash('sha256').update(JSON.stringify([workspace, name])).digest('hex').slice(0, 32)}`;
}
export type InputAction = { kind: 'input'; data: string } | { kind: 'workspace' | 'session'; delta: number } | { kind: 'detach' };
export function inputActions(data: string): InputAction[] {
  const result: InputAction[] = [];
  let pending = '';
  for (const char of data) {
    const action: InputAction | undefined = char === '\x17' ? { kind: 'workspace', delta: 1 }
      : char === '\x0e' ? { kind: 'session', delta: 1 }
      : char === '\x10' ? { kind: 'session', delta: -1 }
      : char === '\x1c' ? { kind: 'detach' } : undefined;
    if (!action) { pending += char; continue; }
    if (pending) result.push({ kind: 'input', data: pending });
    pending = '';
    result.push(action);
  }
  if (pending) result.push({ kind: 'input', data: pending });
  return result;
}
