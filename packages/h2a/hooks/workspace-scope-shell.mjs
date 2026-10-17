import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { canonical, inside } from './workspace-scope-state.mjs';

// A small lexer, not a shell interpreter. Arguments containing separators remain
// data. Unsupported expansion is marked uncertain for classified mutations.
export function shellWords(command) {
  // Here-document bodies are data for cat/node, shell source for sh/bash.
  // Keep them out of the outer command lexer (a test fixture is not a command).
  for (let n = 0; n < 20; n++) {
    const match = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(command);
    if (!match) break;
    const end = command.indexOf('\n', match.index);
    if (end < 0) break;
    const closing = new RegExp('^\\t*' + match[2] + '[ \\t]*(?:\\n|$)', 'm').exec(command.slice(end + 1));
    if (!closing) break;
    const body = command.slice(end + 1, end + 1 + closing.index);
    const header = command.slice(command.lastIndexOf('\n', match.index) + 1, match.index);
    const shell = /(?:^|[;&|])\s*(?:bash|sh|zsh)\b/.test(header);
    const replacement = shell ? " -c '" + body.replace(/'/g, "'\\''") + "' " : ' ';
    command = command.slice(0, match.index) + replacement + command.slice(match.index + match[0].length, end) + '\n' +
      command.slice(end + 1 + closing.index + closing[0].length);
  }
  const groups = []; let words = [], word = '', started = false, quote = '', escape = false;
  const flush = () => { if (started) words.push(word); word = ''; started = false; };
  for (const ch of command) {
    if (escape) { word += ch; started = true; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; started = true; continue; }
    if (quote) { if (ch === quote) quote = ''; else word += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (';|&\n()'.includes(ch)) { flush(); if (words.length) groups.push(words); words = []; }
    else if (/\s/.test(ch)) flush(); else { word += ch; started = true; }
  }
  flush(); if (words.length) groups.push(words);
  return { groups, uncertain: !!quote || escape || /\$|`|<<|[<>]\(/.test(command) };
}
export function git(cwd, args) {
  // Read-only plumbing, bounded and isolated from per-command environment.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|CONFIG|INDEX|OBJECT|ALTERNATE)/.test(key)) delete env[key];
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, timeout: 2000, maxBuffer: 2_000_000 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}
export function repoIdentity(locator, cwd) {
  if (!locator) return canonical(cwd);
  const value = locator.replace(/^git\+/, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
  if (/^[\w.-]+\.[\w.-]+\/[^/]+\/[^/]+$/.test(value)) return value.toLowerCase();
  const scp = value.match(/^(?:[^/@]+@)?([^/:]+):([^/].*)$/);
  if (scp && !/^[A-Za-z]:/.test(value) && !value.includes('://')) return `${scp[1]}/${scp[2]}`.toLowerCase();
  try { const url = new URL(value); if (url.protocol !== 'file:') return `${url.host}${url.pathname}`.toLowerCase(); return canonical(url.pathname); } catch { /* local path */ }
  if (/^[\w.-]+\/[\w.-]+$/.test(value) && !value.startsWith('.')) return `github.com/${value}`.toLowerCase();
  return canonical(resolve(cwd, value));
}
export function repository(cwd) {
  let existing = cwd;
  while (!fs.existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const root = git(existing, ['rev-parse', '--show-toplevel']);
  const path = root ? canonical(root) : canonical(cwd);
  return { path, repo: repoIdentity(git(existing, ['remote', 'get-url', 'origin']), path) };
}
function pushUrls(cwd, destination) {
  const named = git(cwd, ['remote', 'get-url', '--push', '--all', destination]);
  if (named !== undefined) return named.split('\n');
  const rules = git(cwd, ['config', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$']) ?? '';
  for (const kind of ['pushinsteadof', 'insteadof']) {
    const matches = rules.split('\n').map(line => line.match(/^url\.(.*)\.(pushinsteadof|insteadof) (.*)$/))
      .filter(m => m && m[2] === kind && destination.startsWith(m[3])).sort((a, b) => b[3].length - a[3].length);
    if (matches.length) return [matches[0][1] + destination.slice(matches[0][3].length)];
  }
  return [destination];
}
const valueAfter = (words, long, short) => {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === long || words[i] === short) return words[i + 1];
    if (words[i].startsWith(long + '=')) return words[i].slice(long.length + 1);
    if (short && words[i].startsWith(short) && words[i].length > short.length) return words[i].slice(short.length);
  }
};
function positional(words, valueOptions = []) {
  const result = [];
  for (let i = 0; i < words.length; i++) {
    if (/^(?:\d*)>>?/.test(words[i])) { if (/^(?:\d*)>>?$/.test(words[i])) i++; continue; }
    if (valueOptions.includes(words[i])) { i++; continue; }
    if (!words[i].startsWith('-')) result.push(words[i]);
  }
  return result;
}
export function classify(command, initialCwd, context, depth = 0) {
  if (depth > 5) return [{ action: 'shell.opaque', ref: '', repo: '', foreign: true, uncertain: true }];
  const requests = [], parsed = shellWords(command); let cwd = initialCwd;
  for (let words of parsed.groups) {
    words = [...words]; const env = { ...context.toolEnv };
    while (words.length) {
      const assignment = words[0].match(/^([A-Za-z_]\w*)=(.*)$/s);
      if (assignment) { env[assignment[1]] = assignment[2]; words.shift(); continue; }
      if (words[0] === 'env') {
        words.shift();
        while (words[0]?.startsWith('-')) {
          const option = words.shift();
          if (option === '-C' || option === '--chdir') cwd = canonical(resolve(cwd, words.shift()));
          else if (option.startsWith('--chdir=')) cwd = canonical(resolve(cwd, option.slice(8)));
          else if (option === '-u' || option === '--unset') delete env[words.shift()];
          else if (option === '--') break;
        }
        continue;
      }
      if (['command', 'sudo', 'rtk', 'proxy', 'nohup', 'exec'].includes(words[0])) { words.shift(); continue; }
      break;
    }
    const exe = basename(words.shift() ?? '');
    if (words.includes('--help') || words.includes('-h')) continue;
    if (exe === 'cd') { cwd = canonical(resolve(cwd, words[0] ?? context.workspace)); continue; }
    if (['bash', 'sh', 'zsh'].includes(exe) && words.some(w => /^-[a-z]*c$/.test(w))) {
      const index = words.findIndex(w => /^-[a-z]*c$/.test(w));
      requests.push(...classify(words[index + 1] ?? '', cwd, context, depth + 1)); continue;
    }
    if (words.some(w => basename(w) === 'workspace-scope-grant.mjs') || exe === 'workspace-scope-grant.mjs') {
      requests.push({ action: 'owner.grant', code: 'OWNER_ONLY', ref: '', repo: '' }); continue;
    }
    let target = cwd, action, ref = '', remote, extraRemotes = [], checkVersions = false, revision, versionRefs;
    if (exe === 'git') {
      if (env.GIT_WORK_TREE) target = resolve(cwd, env.GIT_WORK_TREE);
      else if (env.GIT_DIR) target = dirname(resolve(cwd, env.GIT_DIR));
      let i = 0;
      for (; i < words.length; i++) {
        const word = words[i];
        if (word === '-C') { target = resolve(target, words[++i]); continue; }
        if (word.startsWith('-C') && word.length > 2) { target = resolve(target, word.slice(2)); continue; }
        if (word === '--work-tree') { target = resolve(cwd, words[++i]); continue; }
        if (word.startsWith('--work-tree=')) { target = resolve(cwd, word.slice(12)); continue; }
        if (word === '--git-dir') { target = dirname(resolve(cwd, words[++i])); continue; }
        if (word.startsWith('--git-dir=')) { target = dirname(resolve(cwd, word.slice(10))); continue; }
        if (word === '-c') { i++; continue; }
        if (!word.startsWith('-')) break;
      }
      const sub = words[i], args = words.slice(i + 1), pos = positional(args, ['--repo', '--receive-pack', '--exec', '-m', '--message']);
      if (['push', 'merge', 'tag', 'rebase', 'commit', 'reset', 'checkout', 'switch', 'cherry-pick', 'revert', 'clean', 'stash', 'add', 'rm', 'mv', 'config', 'update-ref'].includes(sub) ||
        (sub === 'branch' && args.some(w => /^-.*[DdMmCc]/.test(w) || w === '--delete'))) action = `git.${sub}`;
      ref = pos.at(-1) ?? git(target, ['symbolic-ref', '--short', 'HEAD']) ?? '';
      if (sub === 'tag' && (!args.length || args.some(w => ['-l', '--list', '-v', '--verify'].includes(w)))) action = undefined;
      if (sub === 'config' && (args.some(w => /^(--get|--list|-l|-e)/.test(w)) || pos.length < 2)) action = undefined;
      checkVersions = ['push', 'commit', 'merge'].includes(sub);
      if (sub === 'merge') revision = pos.find(w => !/^(?:--|FETCH_HEAD$)/.test(w));
      if (sub === 'commit') revision = args.some(w => /^-[a-z]*a/.test(w) || w === '--all') ? undefined : ':INDEX';
      if (sub === 'push') {
        const branch = git(target, ['symbolic-ref', '--short', 'HEAD']);
        const destination = valueAfter(args, '--repo') ?? pos[0] ??
          git(target, ['config', `branch.${branch}.pushRemote`]) ?? git(target, ['config', 'remote.pushDefault']) ??
          git(target, ['config', `branch.${branch}.remote`]) ?? 'origin';
        const destinations = pushUrls(target, destination);
        [remote, ...extraRemotes] = destinations;
        // get-url expands pushInsteadOf/insteadOf and pushurl before comparison.
        ref = pos.length <= 1 ? git(target, ['symbolic-ref', '--short', 'HEAD']) ?? '' : pos.slice(1).join(' ');
        versionRefs = pos.length <= 1 ? ['HEAD'] : pos.slice(1).map(p => p.replace(/^\+/, '').split(':')[0]).filter(Boolean);
        revision = 'HEAD';
      }
    } else if (exe === 'gh') {
      const selected = valueAfter(words, '--repo', '-R') ?? env.GH_REPO;
      const pos = positional(words, ['--repo', '-R', '--body', '--title', '--target', '--notes-file']);
      const [noun, verb, argument] = pos;
      if (noun === 'api') {
        const method = valueAfter(words, '--method', '-X') ?? (words.some(w => ['-f', '-F', '--field', '--raw-field', '--input'].includes(w)) ? 'POST' : 'GET');
        const endpoint = positional(words.slice(words.indexOf('api') + 1), ['--method', '-X', '-f', '-F', '--field', '--raw-field', '--input'])[0];
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
          const match = endpoint?.match(/^\/?repos\/([^/]+\/[^/]+)\/(.*)$/);
          const merge = match?.[2].match(/^pulls\/(\d+)\/merge$/);
          action = merge ? 'gh.pr.merge' : `gh.api.${method.toUpperCase()}`;
          remote = match ? `${env.GH_HOST ?? 'github.com'}/${match[1]}` : 'unresolved';
          ref = merge ? merge[1] : endpoint ?? '';
        }
      }
      if (noun === 'pr' && (['merge', 'ready', 'close'].includes(verb) || verb === 'review' && words.includes('--approve')) || noun === 'release') {
        if (noun === 'release' && (!verb || ['view', 'list', 'download'].includes(verb))) continue;
        action = `gh.${noun}.${verb}`; ref = argument ?? '';
        const url = argument?.match(/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        remote = url ? `${url[1]}/${url[2]}` : selected;
        if (url) ref = url[3];
      }
    } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(exe)) {
      target = resolve(cwd, valueAfter(words, '--prefix') ?? valueAfter(words, '--cwd', '-C') ?? cwd);
      const pos = positional(words, ['--prefix', '--cwd', '-C', '--workspace', '-w']);
      const [sub, script] = pos;
      if (sub === 'pkg' && script === 'set' && pos.slice(2).some(w => /^version=/.test(w))) {
        action = `${exe}.version`; ref = pos.slice(2).join(' '); checkVersions = true;
      } else if (['publish', 'version'].includes(sub) || sub === 'run' && /(?:^|[:/-])(release|publish|version|bump)(?:$|[:/-])/.test(script ?? '')) {
        action = `${exe}.${sub}`; ref = script ?? sub; checkVersions = true;
      } else if (['run', 'install', 'ci', 'add', 'remove'].includes(sub)) { action = `${exe}.${sub}`; ref = script ?? sub; }
      if (sub === 'run' && script) {
        try {
          const body = JSON.parse(fs.readFileSync(join(target, 'package.json'), 'utf8')).scripts?.[script];
          if (typeof body === 'string') requests.push(...classify(body, target, context, depth + 1));
        } catch { /* Unknown aliases still retain the outer workspace check. */ }
      }
    } else if (/(?:^|[-_.])(release|publish|bump)(?:[-_.]|$)/i.test(exe) ||
      words.some(w => /(?:^|[/])(?:release|publish|bump)(?:[-_.]|$)/i.test(w))) {
      action = 'script.release'; ref = words[0] ?? exe;
      if (words[0] && /[\/]/.test(words[0])) target = dirname(resolve(cwd, words[0]));
    } else if (['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'chmod', 'chown', 'truncate', 'install'].includes(exe)) {
      const paths = words.filter(w => !w.startsWith('-'));
      for (const path of exe === 'cp' || exe === 'install' ? paths.slice(-1) : paths) {
        const resolved = canonical(resolve(cwd, path));
        requests.push({ action: `file.${exe}`, repo: repository(dirname(resolved)).repo, ref: resolved, foreign: !inside(context.workspace, resolved) });
      }
    }
    // Shell redirections are writes even when the executable itself is read-only.
    for (let i = 0; i < words.length; i++) {
      const match = words[i].match(/^(?:\d*)>>?(.*)$/);
      if (!match) continue;
      if (['/dev/null', '/dev/stdout', '/dev/stderr'].includes(match[1] || words[i + 1])) continue;
      const path = canonical(resolve(cwd, match[1] || words[i + 1] || '.'));
      requests.push({ action: 'file.write', repo: repository(dirname(path)).repo, ref: path, foreign: !inside(context.workspace, path) });
    }
    if (!action) continue;
    const repo = repository(canonical(target));
    const destination = remote ? repoIdentity(remote, target) : repo.repo;
    const request = { action, ref, repo: destination, cwd: canonical(target), checkVersions, revision, versionRefs,
      foreign: repo.path !== context.path || !inside(context.workspace, canonical(target)) || destination !== context.repo,
      release: /^(?:npm|pnpm|yarn|bun)\.(publish|version)$/.test(action) || action === 'script.release' ||
        action.endsWith('.run') && /release|publish|version|bump/.test(ref) || action.startsWith('gh.release.'),
      uncertain: parsed.uncertain || Object.keys(env).some(k => /^(?:GIT_CONFIG|GIT_COMMON_DIR)/.test(k)) ||
        exe === 'git' && words.some(w => w === '-c' || w.startsWith('--config-env') || ['--mirror', '--all'].includes(w)) };
    requests.push(request);
    for (const locator of extraRemotes) {
      const repo = repoIdentity(locator, target);
      requests.push({ ...request, repo, foreign: request.foreign || repo !== context.repo });
    }
  }
  return requests;
}

export function patchBump(path, patch) {
  let old;
  try { old = JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return false; }
  if (!old.name || !old.version || old.private === true) return false;
  const section = patch.split(/^\*\*\* (?:Update File|Add File|Delete File): /m)
    .find(s => s.split('\n')[0] === path || resolve(dirname(path), s.split('\n')[0]) === path || s.split('\n')[0] === basename(path));
  const versions = [...(section ?? patch).matchAll(/^\+.*?"version"\s*:\s*"([^"]+)"/gm)];
  return versions.some(m => m[1] !== old.version);
}

export function prBump(request) {
  if (!/^[\w.-]+\/[^/]+\/[^/]+$/.test(request.repo) || !/^\d+$/.test(request.ref)) return undefined;
  const deadline = Date.now() + 10_000;
  const read = args => {
    if (Date.now() >= deadline) return;
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout: Math.min(4000, deadline - Date.now()), maxBuffer: 2_000_000 });
    return r.status === 0 ? r.stdout : undefined;
  };
  const diff = read(['pr', 'diff', request.ref, '--repo', request.repo, '--color', 'never']);
  if (diff === undefined) return;
  let metadata;
  for (const section of diff.split(/^diff --git /m)) {
    const path = section.split('\n')[0].match(/ b\/(.*package\.json)$/)?.[1];
    if (!path || basename(path) !== 'package.json') continue;
    const added = [...section.matchAll(/^\+(?!\+).*?"version"\s*:\s*"([^"]+)"/gm)].map(m => m[1]);
    const removed = [...section.matchAll(/^-(?!-).*?"version"\s*:\s*"([^"]+)"/gm)].map(m => m[1]);
    if (!added.some(v => !removed.includes(v)) || !removed.length) continue;
    // Full before/after manifests distinguish private fixtures and nested
    // metadata fields from the published package's top-level version.
    try {
      metadata ??= JSON.parse(read(['pr', 'view', request.ref, '--repo', request.repo, '--json', 'baseRefOid,headRefOid']));
      if (![metadata.baseRefOid, metadata.headRefOid].every(s => /^[a-f0-9]{40,64}$/.test(s))) return;
      const [hostname, owner, repo] = request.repo.split('/');
      const endpoint = `repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
      const content = ref => read(['api', '--hostname', hostname, `${endpoint}?ref=${ref}`, '-H', 'Accept: application/vnd.github.raw+json']);
      const before = content(metadata.baseRefOid), after = content(metadata.headRefOid);
      if (before === undefined || after === undefined) return;
      JSON.parse(before); JSON.parse(after);
      if (publishedBump(before, after)) return true;
    } catch { return; }
  }
  return false;
}

export function publishedBump(before, after) {
  try {
    const old = JSON.parse(before), next = JSON.parse(after);
    return old.name && old.version && old.private !== true && next.version !== old.version;
  } catch { return false; }
}
export function branchBump(cwd, revision) {
  const base = git(cwd, ['merge-base', 'origin/main', 'HEAD']) ?? git(cwd, ['merge-base', 'main', 'HEAD']);
  if (!base) return undefined;
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return undefined;
  const files = git(cwd, ['diff', '--name-only', ...(revision === ':INDEX' ? ['--cached'] : []), base,
    ...(revision && revision !== ':INDEX' ? [revision] : []), '--', '*package.json', 'package.json']);
  if (files === undefined) return undefined;
  return files.split('\n').filter(p => basename(p) === 'package.json').some(path => {
    const before = git(root, ['show', `${base}:${path}`]);
    let after;
    try { after = revision ? git(root, ['show', `${revision === ':INDEX' ? '' : revision}:${path}`]) : fs.readFileSync(join(root, path), 'utf8'); } catch { return false; }
    return before && publishedBump(before, after);
  });
}
