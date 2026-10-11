import { lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { control, runClient, type OpenRequest } from './client.ts';
import { readSandbox } from './sandbox.ts';

export async function main(args: string[]): Promise<void> {
  const op = args.shift();
  const flags = new Map<string, string>();
  let command: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--') { command = args.slice(i + 1); break; }
    if (!['--sandbox', '--workspace', '--name'].includes(args[i]!) || !args[i + 1]) throw new Error(`invalid flag ${args[i]}`);
    flags.set(args[i]!, args[i + 1]!);
  }
  if (!flags.has('--sandbox')) throw new Error('--sandbox /tmp/h2a-mwt-.../sandbox.json is mandatory');
  const sandbox = await readSandbox(flags.get('--sandbox')!);
  if (op === 'client') return runClient(sandbox);
  if (op !== 'run' || !flags.has('--workspace') || !flags.has('--name') || !command.length) {
    throw new Error('usage: cli.ts client --sandbox FILE | run --sandbox FILE --workspace DIR --name NAME -- command args');
  }
  const request: OpenRequest = { workspace: flags.get('--workspace')!, name: flags.get('--name')!, command };
  let existing = false;
  try { await lstat(sandbox.focusSocket); existing = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing) process.stdout.write(`${JSON.stringify(await control(sandbox, { op: 'run', request }))}\n`);
  else await runClient(sandbox, request);
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
}
