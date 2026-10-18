import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { checked, command } from './process.mjs';
import { safeDirectory, writeJson } from './state.mjs';
import { scanLocks } from './scan.mjs';
import { validateLockChange } from './policy.mjs';
import { supplyChain } from './verify.mjs';

export class Repository {
  constructor(spec, { execute = command, request } = {}) {
    this.spec = spec; this.execute = execute; this.request = request;
    this.root = resolve(spec.path); this.worktrees = []; this.locks = []; this.originalLocks = new Map();
  }
  git(args, cwd = this.workspace ?? this.root) { return checked('git', args, { cwd }, this.execute); }
  gh(args) { return checked('gh', args, { cwd: this.workspace }, this.execute); }
  file(path, root = this.workspace) {
    const target = resolve(root, path);
    if (target === root || relative(root, target).startsWith('..') || realpathSync(target) !== target ||
      lstatSync(target).isSymbolicLink()) throw new Error(`unsafe repository path: ${path}`);
    return target;
  }
  async worktree(sha, suffix) {
    const parent = join(this.root, 'tmp', 'worktrees');
    const path = join(parent, `vuln-fix-${suffix}-${randomUUID()}`);
    const ignored = await this.execute('git', ['check-ignore', '--quiet', relative(this.root, path)], { cwd: this.root });
    if (ignored.code !== 0) throw new Error('repository must ignore tmp/worktrees before scheduling');
    safeDirectory(parent);
    await this.git(['worktree', 'add', '--detach', path, sha], this.root);
    this.worktrees.push(path);
    return realpathSync(path);
  }
  async prepare() {
    if (realpathSync(this.root) !== this.root || await this.git(['rev-parse', '--show-toplevel'], this.root) !== this.root) throw new Error('repository root must be canonical and exact');
    const remote = await this.git(['remote', 'get-url', 'origin'], this.root);
    const escaped = this.spec.github.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escaped}(?:\\.git)?$`, 'i').test(remote)) throw new Error('origin does not match configured GitHub repository');
    // Check push URLs too: Git permits a different destination for push.
    const pushUrls = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'], this.root)).split('\n');
    if (pushUrls.length !== 1 || pushUrls[0] !== remote) throw new Error('origin has a different or multiple push destination');
    await this.git(['fetch', '--no-tags', 'origin', 'main'], this.root);
    this.baseline = await this.git(['rev-parse', 'FETCH_HEAD'], this.root);
    this.workspace = await this.worktree(this.baseline, 'scan');
    const files = (await this.git(['ls-files', '-z'])).split('\0').filter(Boolean);
    if (files.some(x => /[\r\n]/.test(x))) throw new Error('unsupported newline in tracked path');
    this.locks = files.filter(x => /(?:^|\/)(?:package-lock|npm-shrinkwrap)\.json$/.test(x)).sort();
    // npm gives shrinkwrap precedence. Auditing package-lock in the same domain
    // would actually audit shrinkwrap twice and falsely claim package-lock coverage.
    if (this.locks.some(x => x.endsWith('package-lock.json') && this.locks.includes(join(dirname(x), 'npm-shrinkwrap.json')))) throw new Error('ambiguous package-lock/shrinkwrap domain');
    for (const file of this.locks) this.originalLocks.set(file, readFileSync(this.file(file), 'utf8'));
    this.coverageGaps = files.filter(x => x.endsWith('package.json') && !this.locks.some(lock => {
      const domain = dirname(lock), manifest = dirname(x);
      const key = relative(domain, manifest);
      return (key === '' || (!key.startsWith('..') && JSON.parse(this.originalLocks.get(lock)).packages?.[key]));
    })).map(x => `${x}: manifest not represented by a discovered npm lock domain`);
    return this.baseline;
  }
  async scan() {
    const result = await scanLocks({ root: this.workspace, locks: this.locks, osv: this.spec.osv !== false,
      scanners: this.spec.scanners, command: this.execute, request: this.request });
    result.gaps.push(...this.coverageGaps);
    if (this.coverageGaps.length) { result.complete = false; result.errors.push(...this.coverageGaps); }
    return result;
  }
  async existingPr() {
    const entries = JSON.parse(await this.gh(['pr', 'list', '--repo', this.spec.github, '--state', 'open', '--limit', '1000',
      '--json', 'url,headRefName,headRefOid,isDraft']));
    if (!Array.isArray(entries) || entries.length >= 1000) throw new Error('PR inventory incomplete');
    return entries.find(x => x.headRefName?.startsWith('security/daily-vuln-'));
  }
  async install() {
    const outputs = [];
    for (const file of this.locks) {
      const output = await this.execute('npm', ['ci', '--ignore-scripts'], { cwd: join(this.workspace, dirname(file)) });
      outputs.push({ lockfile: file, ...output });
      if (output.code !== 0) throw new Error(`baseline npm ci failed: ${file}`);
    }
    return outputs;
  }
  async tests(phase) {
    const results = [];
    const sandbox = mkdtempSync(join(tmpdir(), 'h2a-vuln-tests-'));
    const env = { ...process.env, XDG_RUNTIME_DIR: sandbox, XDG_CONFIG_HOME: join(sandbox, 'config'),
      XDG_STATE_HOME: join(sandbox, 'state'), H2A_ROOT: join(sandbox, 'h2a'), TMPDIR: sandbox, ENV: 'test-vuln-fix',
      NODE_TEST_CONTEXT: undefined, FORCE_COLOR: '0' };
    try {
      for (const check of this.spec.tests) {
        for (const path of check.args.filter(x => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(x))) this.file(path);
        const output = await this.execute(check.command, check.args, { cwd: this.workspace, env });
        const diagnostic = (output.stdout + output.stderr).replace(/\x1b\[[0-9;]*m/g, '');
        const skipped = /(?:# (?:skipped|cancelled|todo) [1-9]\d*|[1-9]\d* skipped|^(?:not )?ok .*# (?:SKIP|TODO)\b|No test files found|tests?\s+0\b)/im.test(diagnostic);
        const executed = /(?:# tests [1-9]\d*|Tests\s+[1-9]\d*\s+(?:passed|failed))/i.test(diagnostic);
        const expectedRed = phase === 'before' && check.redBefore === true;
        const ok = executed && !skipped && (expectedRed ? output.code !== 0 : output.code === 0);
        results.push({ command: check.command, args: check.args, ...output, expectedRed, ok });
      }
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
    if (phase === 'before' && results.some(x => !x.ok)) {
      const error = new Error('baseline targeted verification failed or silently skipped: ' + JSON.stringify(results).slice(-2000));
      error.checks = results;
      throw error;
    }
    return results;
  }
  async begin(day) {
    this.branch = `security/daily-vuln-${day}-${randomUUID().slice(0, 8)}`;
    await this.git(['switch', '-c', this.branch]);
    return this.branch;
  }
  async generateFix() {
    const outputs = [];
    for (const file of this.locks) {
      const output = await this.execute('npm', ['audit', 'fix', '--package-lock-only', '--ignore-scripts'], { cwd: join(this.workspace, dirname(file)) });
      if (![0, 1].includes(output.code)) throw new Error(`compatible lock fix failed: ${file}`);
      outputs.push({ lockfile: file, ...output });
    }
    return outputs;
  }
  async authorContext(findings) {
    const file = '.h2a/vuln-fix-author/findings.json';
    if ((await this.execute('git', ['check-ignore', '--quiet', file], { cwd: this.workspace })).code !== 0) throw new Error('repository must ignore .h2a runtime evidence before seat launch');
    writeJson(join(this.workspace, file), { baseline: this.baseline, findings, locks: this.locks });
    return file;
  }
  async seal() {
    if (await this.git(['rev-parse', 'HEAD']) !== this.baseline) throw new Error('author must not create or rewrite commits');
    const unexpected = await this.git(['ls-files', '--others', '--exclude-standard']);
    if (unexpected) throw new Error(`untracked output outside lock-only scope: ${unexpected}`);
    const changes = (await this.git(['diff', '--name-status', '-z', '--no-renames', this.baseline])).split('\0');
    if (changes.at(-1) === '') changes.pop();
    if (!changes.length) throw new Error('no compatible lockfile patch; may require a separate major PR or manual mitigation');
    for (let i = 0; i < changes.length; i += 2) {
      const [status, file] = changes.slice(i, i + 2);
      if (status !== 'M' || !this.locks.includes(file)) throw new Error(`outside lock-only scope: ${status} ${file}`);
      const path = this.file(file);
      if (lstatSync(path).mode & 0o111) throw new Error(`executable lockfile: ${file}`);
      validateLockChange(JSON.parse(this.originalLocks.get(file)), JSON.parse(readFileSync(path, 'utf8')));
    }
    await this.git(['add', '--', ...this.locks]);
    await this.git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'fix(security): remediate high and critical dependency vulnerabilities']);
    const message = await this.git(['log', '-1', '--format=%B']);
    if (/Co-Authored-By:|Claude-Session:|Generated with/i.test(message)) throw new Error('attribution trailer refused');
    return this.git(['rev-parse', 'HEAD']);
  }
  supplyChain(now) { return supplyChain(this, now); }
  async assertHead(sha) {
    if (await this.git(['rev-parse', 'HEAD']) !== sha || await this.git(['status', '--porcelain'])) throw new Error('candidate changed after verification');
    for (const file of this.locks) this.file(file);
  }
  async openDraft(item, stateDir) {
    await this.git(['push', 'origin', `HEAD:refs/heads/${this.branch}`]);
    const bodyFile = join(stateDir, `pr-${randomUUID()}.md`);
    writeFileSync(bodyFile, `Remediates HIGH/CRITICAL dependency findings detected by npm, OSV or configured sources.\n\n` +
      `Baseline: ${item.baseline}\nCandidate: ${item.sha}\n\n` +
      `Lockfile-only compatible updates; major changes require a separate PR. This draft is gated by targeted verification, supply-chain admission and two independent seat reviews.\n\n` +
      `Verification: ${item.testsAfter.map(x => `\`${x.command} ${x.args.join(' ')}\`: exit ${x.code}`).join('; ')}.\n` +
      `Findings before/after: ${item.before.findings.length}/${item.after.findings.length}; detection complete: ${item.after.complete}.\n` +
      `Run report: ${join(stateDir, 'latest.json')}. Merge remains with the repository conductor; no automatic merge.\n`, { mode: 0o600 });
    const url = await this.gh(['pr', 'create', '--repo', this.spec.github, '--base', 'main', '--head', this.branch, '--draft',
      '--title', 'fix(security): remediate daily dependency vulnerabilities', '--body-file', bodyFile]);
    if (!url.startsWith(`https://github.com/${this.spec.github}/pull/`)) throw new Error('unexpected PR URL; publication requires reconciliation');
    return url;
  }
  async reviewWorkspace(index, sha, evidence) {
    const workspace = await this.worktree(sha, `review-${index}`);
    const artifacts = safeDirectory(join(workspace, '.h2a/vuln-fix-review'));
    const diff = await this.git(['diff', '--no-ext-diff', '--no-textconv', this.baseline, sha, '--']);
    writeFileSync(join(artifacts, 'diff.patch'), diff + '\n', { mode: 0o600 });
    writeJson(join(artifacts, 'evidence.json'), { baseline: this.baseline, sha, ...evidence });
    writeJson(join(artifacts, 'locks-before.json'), Object.fromEntries([...this.originalLocks].map(([path, text]) => [path, JSON.parse(text)])));
    writeJson(join(artifacts, 'locks-after.json'), Object.fromEntries(this.locks.map(path => [path, JSON.parse(readFileSync(this.file(path), 'utf8'))])));
    return workspace;
  }
  async ready(pr, sha) {
    const remote = JSON.parse(await this.gh(['pr', 'view', pr, '--repo', this.spec.github, '--json', 'headRefOid,isDraft']));
    if (remote.headRefOid !== sha || remote.isDraft !== true) throw new Error('PR head/draft changed after review');
    await this.gh(['pr', 'ready', pr, '--repo', this.spec.github]);
  }
  async cleanup() {
    if (this.quarantined) throw new Error('process cleanup ambiguous; own worktrees retained in quarantine for conductor recovery');
    const errors = [];
    for (const path of this.worktrees.reverse()) {
      try { await this.git(['worktree', 'remove', '--force', path], this.root); }
      catch (error) { errors.push(error.message); }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }
}
