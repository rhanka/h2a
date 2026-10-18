import { isAbsolute } from 'node:path';

const profiles = new Set(['claude', 'codex', 'agy', 'muse', 'vibe']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh']);
export const pair = seat => `${seat.profile}/${seat.model}`;

export function validateConfig(config) {
  if (config?.version !== undefined && config.version !== 1) throw new Error('unsupported config version');
  if (!isAbsolute(config?.stateDir ?? '') || !Array.isArray(config.repositories) || !config.repositories.length || !Array.isArray(config.seats)) throw new Error('absolute stateDir, repositories and seats required');
  const repos = new Set(), paths = new Set(), ids = new Set(), pairs = new Set();
  for (const repo of config.repositories) {
    if (!isAbsolute(repo.path ?? '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.github ?? '') || !repo.github.startsWith('rhanka/')) throw new Error('absolute repo path and rhanka/repository required');
    if (repos.has(repo.github) || paths.has(repo.path)) throw new Error('duplicate repository');
    repos.add(repo.github); paths.add(repo.path);
    if (!Array.isArray(repo.tests) || !repo.tests.length) throw new Error('explicit targeted test commands required');
    for (const check of repo.tests) {
      const args = check.args;
      const prefix = check.command === 'node' ? ['--test'] : check.command === 'npx'
        ? ['--no-install', 'vitest', 'run'] : check.command?.endsWith('vitest') ? ['run'] : [];
      if (!prefix.length || !Array.isArray(args) || args.length <= prefix.length ||
        !prefix.every((value, index) => args[index] === value) ||
        !args.slice(prefix.length).every(x => typeof x === 'string' && !x.startsWith('-') &&
          !isAbsolute(x) && !x.split(/[\\/]/).includes('..') && !/[*?\[\]{}]/.test(x) && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(x))) throw new Error('only targeted node --test / vitest run <file> commands supported');
    }
    for (const scanner of repo.scanners ?? []) {
      if (!/^[\w.-]+$/.test(scanner.name ?? '') || typeof scanner.command !== 'string' || !Array.isArray(scanner.args) || !scanner.args.every(x => typeof x === 'string')) throw new Error('invalid custom scanner');
    }
  }
  for (const seat of config.seats) {
    if (!/^[\w.-]+$/.test(seat.id ?? '') || !profiles.has(seat.profile) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(seat.model ?? '') || !efforts.has(seat.effort)) throw new Error('seat id/profile/exact model/effort required');
    if (ids.has(seat.id) || pairs.has(pair(seat))) throw new Error('distinct seat ids and host/model pairs required');
    ids.add(seat.id); pairs.add(pair(seat));
    if (seat.admission && (typeof seat.admission.command !== 'string' || !Array.isArray(seat.admission.args) || !seat.admission.args.every(x => typeof x === 'string'))) throw new Error('invalid admission command');
  }
  return config;
}

export function selectSeats(seats, cursor, capacity = {}) {
  if (new Set(seats.map(pair)).size !== seats.length) throw new Error('distinct seat host/model pairs required');
  if (!seats.length) throw new Error('no admitted seat with two eligible reviewers');
  for (let offset = 0; offset < seats.length; offset++) {
    const index = (cursor + offset) % seats.length;
    const author = seats[index];
    const reviewers = [...seats.slice(index + 1), ...seats.slice(0, index)]
      .filter(candidate => candidate.profile !== author.profile && candidate.model !== author.model).slice(0, 2);
    const usage = {};
    for (const seat of [author, ...reviewers]) usage[seat.profile] = (usage[seat.profile] ?? 0) + 1;
    if (reviewers.length === 2 && Object.entries(usage).every(([profile, count]) => count <= (capacity[profile] ?? Infinity))) {
      return { author, reviewers, cursor: cursor + offset + 1 };
    }
  }
  throw new Error('two complementary reviewers and shared CLI quota capacity required');
}

const version = value => typeof value === 'string' && value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/);
const nameAt = (path, pkg) => pkg.name ?? path.split('node_modules/').at(-1);
export function validateLockChange(before, after) {
  if (![2, 3].includes(before?.lockfileVersion) || after?.lockfileVersion !== before.lockfileVersion || !before.packages || !after.packages) throw new Error('unsupported lockfile change');
  const identities = new Map();
  for (const [path, pkg] of Object.entries(before.packages)) {
    if (!path.includes('node_modules/')) {
      if (JSON.stringify(pkg) !== JSON.stringify(after.packages[path])) throw new Error('workspace manifest metadata changed');
      continue;
    }
    if (pkg.link) continue;
    const parsed = version(pkg.version);
    if (!parsed) throw new Error(`ambiguous baseline version: ${path}`);
    const name = nameAt(path, pkg);
    const majors = identities.get(name) ?? new Set(); majors.add(parsed[1]); identities.set(name, majors);
  }
  for (const [path, pkg] of Object.entries(after.packages)) {
    if (!path.includes('node_modules/')) {
      if (!before.packages[path]) throw new Error('new workspace');
      continue;
    }
    if (pkg.link) {
      if (JSON.stringify(pkg) !== JSON.stringify(before.packages[path])) throw new Error('local link changed');
      continue;
    }
    const name = nameAt(path, pkg), parsed = version(pkg.version);
    if (!identities.has(name)) throw new Error(`new dependency ${name}: separate supervised PR required`);
    if (!parsed) throw new Error(`ambiguous candidate version: ${path}`);
    if (!identities.get(name).has(parsed[1])) throw new Error(`major bump ${name}: separate major PR required`);
    const old = before.packages[path];
    if (old && (nameAt(path, old) !== name || version(old.version)?.[1] !== parsed[1])) throw new Error(`major bump or package replacement ${path}: separate major PR required`);
    if (old && old.version === pkg.version && JSON.stringify(old) === JSON.stringify(pkg)) continue;
    if (old?.hasInstallScript !== pkg.hasInstallScript) throw new Error(`install script changed: ${name}`);
    const url = new URL(pkg.resolved ?? '', 'https://invalid.local');
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) throw new Error(`registry change or unsupported registry: ${name}`);
    if (old && new URL(old.resolved ?? '', 'https://invalid.local').origin !== url.origin) throw new Error(`registry changed: ${name}`);
  }
}
