import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';
import { basename, join } from 'node:path';
import { NativeTerminalClient } from '../../packages/h2a-runtime/src/native-terminal/client.ts';
import type { NativeTerminalControllerLease, NativeTerminalSessionState } from '../../packages/h2a-runtime/src/native-terminal/host.ts';
import { aggregateStatus, classifyStatus, InputDecoder, inputActions, sessionId, type Status } from './model.ts';
import { connectHost, isolatedEnv, readSandbox, type Sandbox } from './sandbox.ts';
import { Screen, safeLabel } from './screen.ts';

export type OpenRequest = { workspace: string; name: string; command: string[] };
type Meta = OpenRequest & { id: string; cols: number; rows: number };
type Session = { meta: Meta; screen: Screen; state: NativeTerminalSessionState; seq: number; lastOutput: number;
  status: Status; warning: string; responses: string[] };
type Request = { token: string; op: 'run'; request: OpenRequest } | { token: string; op: 'focus'; id: string } | { token: string; op: 'snapshot' };
type ControlRequest = { op: 'run'; request: OpenRequest } | { op: 'focus'; id: string } | { op: 'snapshot' };

export class WorkspaceTerminal {
  readonly sessions = new Map<string, Session>();
  focused = '';
  readonly selected = new Map<string, string>();
  lease: NativeTerminalControllerLease | undefined;
  cols: number;
  rows: number;
  private readonly controller = `mwt-ui-${randomUUID()}`;
  constructor(readonly sandbox: Sandbox, readonly host: NativeTerminalClient, cols = 160, rows = 46) {
    this.cols = cols; this.rows = rows;
  }
  async load(): Promise<void> {
    let metas: Meta[];
    try { metas = JSON.parse(await readFile(join(this.sandbox.root, 'sessions.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const states = await this.host.list();
    for (const meta of metas) {
      const state = states.find(state => state.id === meta.id);
      if (state) await this.add(meta, state);
    }
  }
  private async add(meta: Meta, state: NativeTerminalSessionState): Promise<Session> {
    this.sessions.get(meta.id)?.screen.dispose();
    await this.host.attachObserver(meta.id);
    const session: Session = { meta, state, seq: 0, screen: new Screen(meta.cols, meta.rows),
      lastOutput: Date.now(), status: 'running', warning: '', responses: [] };
    session.screen.terminal.onData(data => session.responses.push(data));
    this.sessions.set(meta.id, session);
    await this.update(session);
    return session;
  }
  private async persist(): Promise<void> {
    await writeFile(join(this.sandbox.root, 'sessions.json'), JSON.stringify([...this.sessions.values()].map(s => s.meta), null, 2), { mode: 0o600 });
  }
  async open(request: OpenRequest): Promise<{ id: string; created: boolean; pid: number; incarnation: string }> {
    if (!request.name?.trim() || !Array.isArray(request.command) || !request.command.length ||
        request.command.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('run requires --name and -- command args');
    const workspace = await realpath(request.workspace);
    if (!(await stat(workspace)).isDirectory()) throw new Error('workspace must be a directory');
    const id = sessionId(workspace, request.name);
    const states = await this.host.list(); // Probe reachable state, never infer absence from errors.
    let state = states.find(state => state.id === id);
    let created = false;
    if (!state || state.status === 'exited') {
      if (this.lease?.id === id) await this.releaseFocus();
      try {
        state = await this.host.create({ id, command: request.command[0]!, args: request.command.slice(1), cwd: workspace,
          env: isolatedEnv(this.sandbox.root), cols: this.cols, rows: this.rows });
        created = true;
      } catch (error) {
        // A timed-out create can have succeeded: reconcile the stable identity first.
        state = (await this.host.list()).find(state => state.id === id && state.status === 'running');
        if (!state) throw error;
      }
    }
    const old = this.sessions.get(id);
    if (!old || old.state.incarnation !== state.incarnation) {
      await this.add({ ...request, workspace, id, cols: this.cols, rows: this.rows }, state);
      await this.persist();
    }
    await this.focus(id);
    return { id, created, pid: state.pid, incarnation: state.incarnation };
  }
  async focus(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`unknown POC session: ${id}`);
    await this.releaseFocus();
    this.focused = id;
    this.selected.set(session.meta.workspace, id);
    session.state = await this.host.state(id);
    await this.update(session);
    if (session.state.status !== 'exited') {
      this.lease = await this.host.acquireController(id, this.controller);
      await this.resize(this.cols, this.rows);
    }
  }
  async resize(cols: number, rows: number): Promise<void> {
    this.cols = Math.max(20, cols); this.rows = Math.max(2, rows);
    const session = this.sessions.get(this.focused);
    if (!session) return;
    if (this.lease) await this.host.resize(this.lease, this.cols, this.rows);
    session.screen.terminal.resize(this.cols, this.rows);
    session.meta.cols = this.cols; session.meta.rows = this.rows;
    await this.persist();
  }
  async write(data: string): Promise<void> {
    if (this.lease) await this.host.write(this.lease, data);
  }
  private async releaseFocus(): Promise<void> {
    const lease = this.lease;
    if (!lease) return;
    const state = await this.host.state(lease.id);
    if (state.status === 'running' && state.incarnation === lease.incarnation) {
      try { await this.host.releaseController(lease); }
      catch (error) {
        const current = await this.host.state(lease.id);
        if (current.status === 'running' && current.incarnation === lease.incarnation) throw error;
      }
    }
    this.lease = undefined; // Exit already revokes the native lease.
  }
  async cycleWorkspace(delta: number): Promise<void> {
    const workspaces = this.workspaces();
    const current = this.sessions.get(this.focused)?.meta.workspace;
    const index = workspaces.indexOf(current ?? '');
    const workspace = workspaces[(index + delta + workspaces.length) % workspaces.length];
    if (workspace) await this.focus(this.selected.get(workspace) ?? this.inWorkspace(workspace)[0]!.meta.id);
  }
  async cycleSession(delta: number): Promise<void> {
    const current = this.sessions.get(this.focused);
    if (!current) return;
    const sessions = this.inWorkspace(current.meta.workspace);
    const index = sessions.indexOf(current);
    await this.focus(sessions[(index + delta + sessions.length) % sessions.length]!.meta.id);
  }
  private workspaces(): string[] { return [...new Set([...this.sessions.values()].map(s => s.meta.workspace))]; }
  private inWorkspace(workspace: string): Session[] { return [...this.sessions.values()].filter(s => s.meta.workspace === workspace); }
  private async update(session: Session): Promise<void> {
    const replay = await this.host.readOutput(session.meta.id, session.seq);
    if (replay.incarnation !== session.state.incarnation) throw new Error('session incarnation changed; detach and reopen client');
    if (replay.gap) session.warning = 'REPLAY GAP: retained output cannot restore missing cells';
    await session.screen.write((replay.terminalModePrefix ?? '') + replay.chunks.map(chunk => chunk.data).join(''));
    if (replay.latestSeq !== session.seq) session.lastOutput = Date.now();
    session.seq = replay.latestSeq;
    session.status = classifyStatus(session.state.status, session.screen.text(), session.lastOutput);
    const responses = session.responses.splice(0).join('');
    if (responses && this.lease?.id === session.meta.id) await this.host.write(this.lease, responses);
  }
  async poll(): Promise<void> {
    const states = await this.host.list();
    for (const session of this.sessions.values()) {
      const state = states.find(state => state.id === session.meta.id);
      if (!state) throw new Error('native host lost a known POC session');
      session.state = state;
      if (state.status === 'exited' && this.lease?.id === state.id) this.lease = undefined;
      await this.update(session);
    }
  }
  snapshot() {
    const workspace = this.sessions.get(this.focused)?.meta.workspace;
    const tabs = this.workspaces().map(w => `${w === workspace ? '*' : ''}${safeLabel(basename(w))}[${aggregateStatus(this.inWorkspace(w).map(s => s.status))}]`);
    const sessions = workspace ? this.inWorkspace(workspace).map(s => `${s.meta.id === this.focused ? '*' : ''}${safeLabel(s.meta.name)}[${s.status}]`) : [];
    return { focused: this.focused, workspace, headers: [tabs.join(' | '), sessions.join(' | ')],
      sessions: [...this.sessions.values()].map(s => ({ id: s.meta.id, name: s.meta.name, workspace: s.meta.workspace, status: s.status, pid: s.state.pid })) };
  }
  paint(): string {
    const session = this.sessions.get(this.focused);
    if (!session) return '\x1b[H\x1b[2JNo sessions. Use run to open a session.\r\nCtrl-W workspace; Ctrl-N/P session; Ctrl-\\ detach';
    return session.screen.paint(this.snapshot().headers, session.warning ||
      (session.state.status === 'exited' ? `EXITED (${session.state.exit?.exitCode ?? '?'}) — run to reopen` : ''));
  }
  async close(): Promise<void> {
    if (this.lease) await this.host.releaseController(this.lease).catch(() => {});
    this.lease = undefined;
    for (const session of this.sessions.values()) session.screen.dispose();
    this.host.close();
  }
}

export async function control(sandbox: Sandbox, request: ControlRequest): Promise<any> {
  await readSandbox(join(sandbox.root, 'sandbox.json'));
  return new Promise((resolve, reject) => {
    const socket = createConnection(sandbox.focusSocket);
    let buffer = '';
    const timer = setTimeout(() => socket.destroy(new Error('POC focus request timed out')), 5000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ ...request, token: sandbox.token })}\n`));
    socket.on('data', data => {
      buffer += data;
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.split('\n')[0]!);
        if (response.error) reject(new Error(response.error)); else resolve(response.result);
      } catch (error) { reject(error); }
      socket.destroy();
    });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); if (!buffer.includes('\n')) reject(new Error('POC focus endpoint unavailable')); });
  });
}

export async function runClient(sandbox: Sandbox, initial?: OpenRequest): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('client requires a terminal; use demo.ts --record for automated proof');
  const lock = join(sandbox.root, 'ui-lock');
  await mkdir(lock, { mode: 0o700 }); // Atomic admission: never steal a lock from an unknown process.
  let model: WorkspaceTerminal | undefined, server: Server | undefined, timer: NodeJS.Timeout | undefined;
  let queue = Promise.resolve(), stopped = false, pollPending = false;
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn);
    queue = result.then(() => {}, error => { process.stderr.write(`\r\nPOC: ${String(error)}\r\n`); });
    return result;
  };
  const redraw = () => process.stdout.write(model!.paint());
  const stop = () => { stopped = true; finish(); };
  const onResize = () => { void enqueue(async () => { await model!.resize(process.stdout.columns, process.stdout.rows - 2); redraw(); }); };
  const onInput = (data: Buffer) => { void enqueue(async () => {
    for (const action of inputActions(decoder.write(data))) {
      if (action.kind === 'detach') { stop(); break; }
      if (action.kind === 'input') await model!.write(action.data);
      else if (action.kind === 'workspace') await model!.cycleWorkspace(action.delta);
      else await model!.cycleSession(action.delta);
    }
    if (!stopped) { await model!.poll(); redraw(); }
  }); };
  const wasRaw = process.stdin.isRaw;
  const decoder = new InputDecoder();
  let entered = false;
  try {
    model = new WorkspaceTerminal(sandbox, await connectHost(sandbox), process.stdout.columns, process.stdout.rows - 2);
    await model.load();
    if (initial) await model.open(initial);
    else if (model.sessions.size) await model.focus(model.sessions.keys().next().value!);
    server = createServer(socket => {
      let buffer = '', handled = false;
      socket.setEncoding('utf8'); socket.on('error', () => {}); socket.setTimeout(5000, () => socket.destroy());
      socket.on('data', chunk => {
        if (handled) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 65536) { socket.destroy(); return; }
        if (!buffer.includes('\n')) return;
        handled = true;
        void enqueue(async () => {
          const request = JSON.parse(buffer.split('\n')[0]!) as Request;
          if (request.token !== sandbox.token) throw new Error('invalid sandbox focus token');
          let result;
          if (request.op === 'run') result = await model!.open(request.request);
          else if (request.op === 'focus') { await model!.focus(request.id); result = model!.snapshot(); }
          else if (request.op === 'snapshot') { await model!.poll(); result = model!.snapshot(); }
          else throw new Error('unknown POC focus operation');
          redraw();
          return result;
        }).then(result => socket.end(`${JSON.stringify({ result })}\n`), error => socket.end(`${JSON.stringify({ error: String(error) })}\n`));
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(sandbox.focusSocket, resolve); });
    await chmod(sandbox.focusSocket, 0o600);
    process.stdout.write('\x1b[?1049h\x1b[?2004l'); entered = true;
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', onInput); process.stdin.on('end', stop); process.stdout.on('resize', onResize);
    process.on('SIGTERM', stop); process.on('SIGHUP', stop); process.on('SIGINT', stop);
    redraw();
    timer = setInterval(() => {
      if (pollPending || stopped) return;
      pollPending = true;
      void enqueue(async () => { await model!.poll(); redraw(); }).catch(stop).finally(() => { pollPending = false; });
    }, 100);
    await done;
  } finally {
    stopped = true; clearInterval(timer);
    process.stdin.off('data', onInput); process.stdin.off('end', stop); process.stdout.off('resize', onResize);
    process.off('SIGTERM', stop); process.off('SIGHUP', stop); process.off('SIGINT', stop);
    process.stdin.setRawMode(wasRaw ?? false); process.stdin.pause();
    await queue;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await model?.close();
    if (entered) process.stdout.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1l\x1b>\x1b[?2004l\x1b[?1049l');
    await rm(lock, { recursive: true, force: true });
  }
}
