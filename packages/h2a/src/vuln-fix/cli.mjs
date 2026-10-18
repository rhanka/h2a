import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDaily } from './controller.mjs';
import { safeDirectory } from './state.mjs';

export const HELP = `h2a vuln-fix — daily vulnerability remediation through seats
  h2a vuln-fix run --config /absolute/config.json [--dry-run]
  h2a vuln-fix timer --config /absolute/config.json --directory /absolute/units [--node /absolute/node] [--cli /absolute/bin.js]
Reports: <config.stateDir>/latest.json (latest-dry-run.json for dry runs).
Timer renders only; install/enable explicitly as documented in docs/vuln-fix.md.
Never merges. Failed scans, unqualified seats or incomplete reviews fail closed.
`;
const quote = (value, environment = false) => {
  if (!isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error('systemd paths must be absolute, without control characters');
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return '"' + (environment ? escaped.replaceAll('$', () => '$$') : escaped) + '"';
};
export function timerUnits({ config, cli, node }) {
  return { service: `[Unit]
Description=Daily dependency vulnerability fix through h2a seats
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
UMask=0077
WorkingDirectory=${quote(dirname(config))}
ExecStart=${quote(node, true)} ${quote(cli, true)} vuln-fix run --config ${quote(config, true)}
TimeoutStartSec=6h
TimeoutStopSec=30s
KillMode=control-group
Nice=10
`, timer: `[Unit]
Description=Daily h2a vulnerability remediation

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=15m
Persistent=true
Unit=h2a-vuln-fix.service

[Install]
WantedBy=timers.target
` };
}

/** @param {{stdout: {write(chunk: string): unknown}, stderr: {write(chunk: string): unknown}} streams */
export async function runVulnFixCli(argv, streams = { stdout: process.stdout, stderr: process.stderr }, { run = runDaily } = {}) {
  try {
    const args = argv[0] === 'vuln-fix' ? argv.slice(1) : argv;
    if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) { streams.stdout.write(HELP); return 0; }
    const [verb, ...rest] = args;
    if (!['run', 'timer'].includes(verb)) throw new Error('expected run or timer; use h2a vuln-fix --help');
    const flags = {};
    const allowed = new Set(verb === 'run' ? ['config', 'dry-run'] : ['config', 'directory', 'node', 'cli']);
    for (let i = 0; i < rest.length; i++) {
      const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
      if (!allowed.has(key) || Object.hasOwn(flags, key)) throw new Error(`unsupported or duplicate option: ${rest[i]}`);
      if (key === 'dry-run') flags[key] = true;
      else {
        const value = rest[++i];
        if (!value || value.startsWith('--') || !isAbsolute(value)) throw new Error(`--${key} requires an absolute path`);
        flags[key] = value;
      }
    }
    if (!flags.config) throw new Error('--config is required');
    if (verb === 'run') {
      const report = await run(JSON.parse(readFileSync(flags.config, 'utf8')), { dryRun: flags['dry-run'] === true });
      streams.stdout.write(report.summary + '\n');
      return report.ok ? 0 : 2;
    }
    if (!flags.directory) throw new Error('--directory is required');
    const units = timerUnits({ config: flags.config, node: flags.node ?? process.execPath,
      cli: flags.cli ?? resolve(dirname(fileURLToPath(import.meta.url)), '../bin.js') });
    const directory = safeDirectory(flags.directory);
    writeFileSync(join(directory, 'h2a-vuln-fix.service'), units.service, { mode: 0o600, flag: 'wx' });
    writeFileSync(join(directory, 'h2a-vuln-fix.timer'), units.timer, { mode: 0o600, flag: 'wx' });
    streams.stdout.write(`Rendered ${directory}/h2a-vuln-fix.{service,timer}; not activated.\n`);
    return 0;
  } catch (error) { streams.stderr.write(`h2a vuln-fix: ${error.message}\n`); return 1; }
}
