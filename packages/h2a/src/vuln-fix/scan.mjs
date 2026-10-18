import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { command as defaultCommand, request as defaultRequest } from './process.mjs';
import { redactSecretsText } from './redact.mjs';

// npm inherits omit/include filters (notably under NODE_ENV=production).
// Force full dev/optional/peer coverage so detection never reports a
// falsely complete clean tree.
export const npmTreeIncludes = ['--include=prod', '--include=dev', '--include=optional', '--include=peer'];

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const severities = new Set(['info', 'low', 'moderate', 'medium', 'high', 'critical', 'unknown']);
const urgent = severity => ['high', 'critical', 'unknown'].includes(severity);

export function npmFindings(audit, lockfile) {
  if (!object(audit) || audit.error || !object(audit.vulnerabilities)) throw new Error('invalid npm audit vulnerabilities object');
  return Object.entries(audit.vulnerabilities).flatMap(([name, item]) => {
    if (!object(item) || !severities.has(item.severity) || !Array.isArray(item.via) ||
      !Array.isArray(item.nodes) || !item.nodes.every(x => typeof x === 'string')) throw new Error('invalid npm vulnerability');
    const aliases = [...new Set(item.via.filter(object).map(x => x.url?.match(/GHSA-[\w-]+/)?.[0] ?? String(x.source ?? '')).filter(Boolean))];
    return urgent(item.severity) ? [{ source: 'npm', id: aliases[0] ?? `npm:${name}`, aliases,
      name, severity: item.severity, lockfile, paths: item.nodes, range: item.range, fixAvailable: item.fixAvailable }] : [];
  });
}

export function publicPackages(lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !object(lock.packages)) throw new Error('unsupported npm lockfile (v2/v3 required)');
  const packages = new Map();
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/') || item.link || typeof item.version !== 'string' || typeof item.resolved !== 'string') continue;
    const url = new URL(item.resolved, 'https://invalid.local');
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) continue;
    const name = item.name ?? path.split('node_modules/').at(-1);
    const key = `${name}@${item.version}`;
    const entry = packages.get(key) ?? { name, version: item.version, paths: [] };
    entry.paths.push(path);
    packages.set(key, entry);
  }
  return [...packages.values()];
}

export function osvFindings(advisory, pkg, lockfile) {
  if (!object(advisory) || typeof advisory.id !== 'string' ||
    (advisory.aliases !== undefined && (!Array.isArray(advisory.aliases) || !advisory.aliases.every(x => typeof x === 'string')))) throw new Error('invalid OSV advisory');
  if (advisory.withdrawn) return [];
  const declared = advisory.database_specific?.severity?.toLowerCase();
  const severity = severities.has(declared) ? declared : 'unknown';
  return urgent(severity) ? [{ source: 'osv', id: advisory.id, aliases: [...new Set([advisory.id, ...(advisory.aliases ?? [])])],
    name: pkg.name, version: pkg.version, paths: pkg.paths, lockfile, severity }] : [];
}

export async function scanLocks({ root, locks, osv = true, scanners = [], command = defaultCommand,
  request = defaultRequest, readLock = file => JSON.parse(readFileSync(join(root, file), 'utf8')) }) {
  const result = { complete: true, findings: [], errors: [], coverage: [], gaps: [] };
  if (!locks.length) result.errors.push('no tracked npm lockfiles; dependency coverage unknown');
  const hydrated = new Map();
  for (const lockfile of locks) {
    try {
      const lock = readLock(lockfile);
      const packages = publicPackages(lock);
      const audit = await command('npm', ['audit', '--json', '--package-lock-only', '--ignore-scripts', ...npmTreeIncludes], { cwd: join(root, dirname(lockfile)) });
      if (![0, 1].includes(audit.code)) throw new Error(`npm audit exit ${audit.code}`);
      result.findings.push(...npmFindings(JSON.parse(audit.stdout), lockfile));
      result.coverage.push({ source: 'npm', lockfile });
      if (osv) {
        for (let offset = 0; offset < packages.length; offset += 100) {
          const batch = packages.slice(offset, offset + 100);
          const response = await request('https://api.osv.dev/v1/querybatch', { queries: batch.map(pkg => ({ package: { name: pkg.name, ecosystem: 'npm' }, version: pkg.version })) });
          if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error('invalid OSV batch response');
          for (const [i, row] of response.results.entries()) {
            if (!object(row) || (row.vulns !== undefined && !Array.isArray(row.vulns))) throw new Error('invalid OSV batch row');
            for (const hit of row.vulns ?? []) {
              if (!/^[A-Za-z0-9._-]+$/.test(hit.id ?? '')) throw new Error('invalid OSV id');
              if (!hydrated.has(hit.id)) hydrated.set(hit.id, await request(`https://api.osv.dev/v1/vulns/${encodeURIComponent(hit.id)}`));
              const advisory = hydrated.get(hit.id);
              if (advisory.id !== hit.id) throw new Error('OSV identity mismatch');
              result.findings.push(...osvFindings(advisory, batch[i], lockfile));
            }
          }
        }
        result.coverage.push({ source: 'osv', lockfile, publicPackages: packages.length });
      } else result.gaps.push(`${lockfile}: OSV disabled by repository sharing policy`);
      result.gaps.push(`${lockfile}: OSV excludes private registry, workspace and local dependencies`);
    } catch (error) { if (error.quarantine) throw error; result.errors.push(redactSecretsText(`${lockfile}: ${error.message}`)); }
  }
  for (const scanner of scanners) {
    try {
      const output = await command(scanner.command, scanner.args, { cwd: root });
      if (output.code !== 0) throw new Error(`exit ${output.code}`);
      const entries = JSON.parse(output.stdout);
      if (!Array.isArray(entries) || entries.some(x => !object(x) || typeof x.id !== 'string' || !severities.has(x.severity))) throw new Error('expected findings array with id/severity');
      result.findings.push(...entries.filter(x => urgent(x.severity)).map(x => ({ ...x, source: scanner.name })));
      result.coverage.push({ source: scanner.name });
    } catch (error) { if (error.quarantine) throw error; result.errors.push(redactSecretsText(`${scanner.name}: ${error.message}`)); }
  }
  result.complete = result.errors.length === 0;
  result.gaps.push('npm/OSV dependency trees do not cover OS images, vendored code or non-npm ecosystems unless a custom scanner is configured');
  return result;
}
