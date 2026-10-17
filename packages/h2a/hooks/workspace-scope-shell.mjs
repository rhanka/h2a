import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { canonical, inside } from './workspace-scope-state.mjs';

// Parse shell structure without evaluating agent-controlled source. Preserve
// subshell/pipeline boundaries and inspect executable heredocs/substitutions.
export function shellWords(command) {
  const embedded = [];
  for (let n = 0; n < 20; n++) {
    const match = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(command);
    if (!match) break;
    const end = command.indexOf('\n', match.index);
    if (end < 0) break;
    const closing = new RegExp('^\\t*' + match[2] + '[ \\t]*(?:\\n|$)', 'm').exec(command.slice(end + 1));
    if (!closing) break;
    const body = command.slice(end + 1, end + 1 + closing.index);
    const header = command.slice(command.lastIndexOf('\n', match.index) + 1, end);
    const headerWords = shellWords(header.replace(match[0], '')).groups.flatMap(g => g.words).map(w => basename(w));
    const shell = headerWords.some(w => ['bash', 'sh', 'zsh'].includes(w));
    const runtime = headerWords.some(w => ['node', 'bun', 'deno', 'tsx'].includes(w));
    const marker = shell || runtime ? ` __H2A_INPUT_${embedded.length}__ ` : ' ';
    if (shell || runtime) embedded.push({ body, runtime });
    command = command.slice(0, match.index) + marker + command.slice(match.index + match[0].length, end) + '\n' +
      command.slice(end + 1 + closing.index + closing[0].length);
  }
  const groups = []; let words = [], word = '', started = false, quote = '', escape = false, uncertain = false;
  const flush = () => { if (started) words.push(word); word = ''; started = false; };
  const group = separator => { flush(); groups.push({ words, separator }); words = []; };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escape) { word += ch; started = true; escape = false; continue; }
    if (ch === '\\' && command[i + 1] === '\n' && quote !== "'") { i++; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; started = true; continue; }
    if (quote !== "'" && (command.startsWith('$(', i) || ch === '`')) {
      const tick = ch === '`'; let j = i + (tick ? 1 : 2), depth = 1, innerQuote = '', escaped = false;
      const start = j;
      for (; j < command.length; j++) {
        const c = command[j];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (innerQuote) { if (c === innerQuote) innerQuote = ''; continue; }
        if (tick && c === '`') break;
        if (c === "'" || c === '"') { innerQuote = c; continue; }
        if (!tick && c === '(') depth++;
        if (!tick && c === ')' && --depth === 0) break;
      }
      if (j === command.length) uncertain = true;
      word += `__H2A_SUB_${embedded.length}__`;
      embedded.push({ body: command.slice(start, j) }); started = true; i = j; continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      else word += ch === '$' && quote === '"' ? '__H2A_DYNAMIC__' : ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (ch === '#' && !started) { while (i < command.length && command[i] !== '\n') i++; group('\n'); continue; }
    if (ch === '$') { word += '__H2A_DYNAMIC__'; started = true; continue; }
    if (ch === '>' || ch === '&' && command[i + 1] === '>') {
      const fd = /^\d+$/.test(word) ? word : ''; if (fd) { word = ''; started = false; }
      flush(); let op = fd + ch;
      if (ch === '&') { op += '>'; i++; }
      if (command[i + 1] === '>' || command[i + 1] === '|') op += command[++i];
      if (command[i + 1] === '&') {
        op += command[++i];
        while (/[\d-]/.test(command[i + 1] ?? 'x')) op += command[++i];
      }
      words.push(op); continue;
    }
    const brace = '{}'.includes(ch) && !started && /^(?:\s|;|$)/.test(command[i + 1] ?? '');
    if ('{}'.includes(ch) && !brace) uncertain = true; // unquoted expansion is not a command boundary
    if (';|&\n()'.includes(ch) || brace) {
      let op = ch; if ('|&'.includes(ch) && command[i + 1] === ch) op += command[++i];
      group(op);
    } else if (/\s/.test(ch)) flush(); else { word += ch; started = true; }
  }
  group('');
  return { groups, embedded, uncertain: uncertain || !!quote || escape || /<<|[<>]\(/.test(command) };
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
function npmWorkspaces(root, words) {
  const selectors = [];
  const all = words.includes('--workspaces') || words.includes('-ws');
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--workspace' || words[i] === '-w') selectors.push(words[++i]);
    else if (words[i].startsWith('--workspace=')) selectors.push(words[i].slice(12));
    else if (words[i].startsWith('-w') && words[i] !== '-ws') selectors.push(words[i].slice(2));
  }
  if (!selectors.length && !all) return [root];
  const candidates = [];
  try {
    const config = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).workspaces;
    for (const pattern of Array.isArray(config) ? config : config?.packages ?? []) {
      let paths = [root];
      for (const segment of pattern.split('/')) paths = paths.flatMap(path => {
        if (segment === '*') {
          try { return fs.readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(path, e.name)); }
          catch { return []; }
        }
        return [join(path, segment)];
      });
      for (const path of paths) {
        try { candidates.push({ path: canonical(path), name: JSON.parse(fs.readFileSync(join(path, 'package.json'), 'utf8')).name }); }
        catch { /* Not a declared package directory. */ }
      }
    }
  } catch { /* npm itself rejects invalid workspace configuration. */ }
  return [...new Set(all ? candidates.map(c => c.path) : selectors.flatMap(selector => {
    const direct = resolve(root, selector);
    if (fs.existsSync(join(direct, 'package.json'))) return [canonical(direct)];
    return candidates.filter(c => c.name === selector).map(c => c.path);
  }))];
}
export function classify(command, initialCwd, context, depth = 0) {
  if (depth > 5) return [{ action: 'shell.opaque', ref: '', repo: '', foreign: true, uncertain: true }];
  const requests = [], parsed = shellWords(command); let cwd = initialCwd, pipeline, groupIndex = -1, conditionalState = false;
  const conditional = parsed.groups.some(g=>['&&','||'].includes(g.separator));
  const stack = [], directories = []; let variables = { ...context.toolEnv }, oldpwd;
  const opaque = (action = 'shell.syntax') => requests.push({ action, ref: '', repo: context.repo, code: 'UNVERIFIABLE' });
  if (parsed.uncertain) opaque();
  // Compound pipeline stages require a full shell AST. Never guess at their
  // shared cwd/stack; simple pipeline stages are isolated below.
  if (parsed.groups.some(g=>'{}()'.includes(g.separator) && g.separator) && parsed.groups.some(g=>g.separator==='|')) opaque();
  for (const group of parsed.groups) {
    groupIndex++;
    if (pipeline) { cwd=pipeline.cwd; variables={...pipeline.variables}; oldpwd=pipeline.oldpwd; directories.splice(0,directories.length,...pipeline.directories); }
    if (group.separator === '(') {
      if (group.words.some(w => !['!', 'time'].includes(w))) { opaque(); continue; }
      stack.push({ cwd, variables: { ...variables }, oldpwd, directories: [...directories] }); continue;
    }
    if (group.separator === '|' && pipeline === undefined) pipeline = { cwd, variables: { ...variables }, oldpwd, directories: [...directories] };
    let words = [...group.words]; const env = { ...variables }, groupCwd = cwd;
    let envChdir = false;
    try {
    // Redirections belong to the outer shell, before any builtin, wrapper or
    // early return. Remove them from argv so they cannot become git refspecs.
    const argv = [];
    for (let i = 0; i < words.length; i++) {
      if (/^\d*>&[\d-]+$/.test(words[i])) continue;
      if (!/^(?:\d*|&)>(?:>|\|)?$/.test(words[i])) { argv.push(words[i]); continue; }
      const destination = words[++i];
      if (['/dev/null', '/dev/stdout', '/dev/stderr'].includes(destination)) continue;
      const path = canonical(resolve(groupCwd, destination ?? '.'));
      requests.push({ action: 'file.write', repo: repository(dirname(path)).repo, ref: path, foreign: !inside(context.workspace, path),
        uncertain: !destination || parsed.uncertain || /__H2A_(DYNAMIC|SUB)/.test(path) });
    }
    const embeddedWords = words;
    words = argv.filter(w => !/^__H2A_INPUT_\d+__$/.test(w));
    while (words.length) {
      const assignment = words[0].match(/^([A-Za-z_]\w*)=(.*)$/s);
      if (assignment) { env[assignment[1]] = assignment[2]; words.shift(); continue; }
      if (words[0] === 'env') {
        words.shift();
        while (words[0]?.startsWith('-')) {
          const option = words.shift();
          if (option === '-C' || option === '--chdir') { cwd = canonical(resolve(cwd, words.shift())); envChdir = true; }
          else if (option.startsWith('--chdir=')) { cwd = canonical(resolve(cwd, option.slice(8))); envChdir = true; }
          else if (option === '-u' || option === '--unset') delete env[words.shift()];
          else if (option === '--') break;
        }
        continue;
      }
      if (['command', 'builtin', 'sudo', 'rtk', 'proxy', 'nohup', 'exec', '!', 'time', 'nice', 'timeout', 'stdbuf', 'setsid'].includes(basename(words[0]))) {
        const wrapper = basename(words.shift());
        while (words[0]?.startsWith('-')) {
          const flag = words.shift();
          if (flag === '--') break;
          const valueFlags = {nice:['-n','--adjustment'],timeout:['-s','--signal','-k','--kill-after'],stdbuf:['-i','-o','-e'],sudo:['-u','-g','-h','-p','-C','-T']};
          const plainFlags = {command:['-p','-v','-V'],time:['-p'],nice:[],timeout:['--foreground','--preserve-status','-v','--verbose'],setsid:['-f','-w','--fork','--wait','-c','--ctty'],sudo:['-n','-E','-H']};
          if ((valueFlags[wrapper] ?? []).includes(flag)) words.shift();
          else if (!(plainFlags[wrapper] ?? []).includes(flag) && !(valueFlags[wrapper] ?? []).some(name=>flag.startsWith(name+(name.startsWith('--')?'=':'')) && flag!==name) &&
            !(wrapper==='nice' && /^-\d+$/.test(flag))) opaque('shell.wrapper');
        }
        if (wrapper === 'timeout') words.shift();
        continue;
      }
      break;
    }
    for (const word of embeddedWords) for (const match of word.matchAll(/__H2A_(?:INPUT|SUB)_(\d+)__/g)) {
      const { body, runtime } = parsed.embedded[Number(match[1])];
      if (runtime) requests.push({ action: 'runtime.inline', ref: '', repo: context.repo,
        code: body.includes('workspace-scope') ? 'OWNER_ONLY' : 'UNVERIFIABLE' });
      else requests.push(...classify(body, cwd, { ...context, toolEnv: env }, depth + 1));
    }
    if (!words.length) {
      if (conditional && groupIndex>0 && JSON.stringify(variables)!==JSON.stringify(env)) conditionalState=true;
      Object.assign(variables, env); continue;
    }
    const exe = basename(words.shift() ?? '');
    if (/__H2A_(DYNAMIC|SUB)/.test(exe) || ['if','then','elif','else','fi','for','select','while','until','do','done','case','esac','function',
      'source','.','eval','export','readonly','declare','typeset','local','set','unset','shopt','alias','unalias','hash','enable'].includes(exe)) {
      opaque(); continue;
    }
    if (['cd', 'pushd', 'popd'].includes(exe)) {
      if (conditional && groupIndex>0) conditionalState=true;
      const path = words.find(w => w === '-' || !w.startsWith('-'));
      const previous = cwd;
      if (exe === 'popd' || exe === 'pushd' && path === undefined) {
        const next = directories.pop();
        if (!next) { opaque('shell.cwd'); continue; }
        if (exe === 'pushd') directories.push(cwd);
        cwd = next;
      } else {
        if (exe === 'pushd') directories.push(cwd);
        const next = path === '-' ? oldpwd ?? env.OLDPWD : path ?? env.HOME ?? process.env.HOME;
        if (!next || words.some(w => /^[-+]\d+$/.test(w)) || env.CDPATH) { opaque('shell.cwd'); continue; }
        cwd = canonical(resolve(cwd, next));
      }
      oldpwd = previous;
      if (/__H2A_(DYNAMIC|SUB)/.test(cwd)) requests.push({ action: 'shell.cwd', code: 'UNVERIFIABLE', repo: context.repo, ref: cwd });
      continue;
    }
    if (['bash', 'sh', 'zsh'].includes(exe) && words.some(w => /^-[a-z]*c[a-z]*$/.test(w))) {
      const index = words.findIndex(w => /^-[a-z]*c[a-z]*$/.test(w));
      requests.push(...classify(words[index + 1] ?? '', cwd, { ...context, toolEnv: env }, depth + 1)); continue;
    }
    if (['bash', 'sh', 'zsh'].includes(exe) && !words.some(w => !w.startsWith('-'))) opaque('shell.stdin');
    const interpreter = ['node', 'tsx', 'ts-node', 'bash', 'sh', 'zsh', 'bun', 'deno', 'npx'].includes(exe);
    const launches = name => exe === name || interpreter && words.some(w => basename(w) === name);
    if (launches('workspace-scope-grant.mjs') || launches('workspace-scope-guard.mjs') && words.some(w => w.startsWith('--initialize-session'))) {
      requests.push({ action: 'owner.grant', code: 'OWNER_ONLY', ref: '', repo: '' }); continue;
    }
    if (interpreter && words.some(w => /^(?:--(?:eval|print)(?:=|$)|-[ep])/.test(w))) {
      requests.push({ action: 'runtime.inline', repo: context.repo, ref: '',
        code: words.some(w => w.includes('workspace-scope') || context.ownerKey && w.includes(context.ownerKey)) ? 'OWNER_ONLY' : 'UNVERIFIABLE' });
    }
    let target = cwd, additionalTargets = [], action, ref = '', remote, extraRemotes = [], checkVersions = false, privateVersion = false, revision, versionRefs, ownerOnly = false, gitOptionsUncertain = false;
    if (exe === 'git') {
      let gitDir = env.GIT_DIR, workTree = env.GIT_WORK_TREE;
      let i = 0;
      for (; i < words.length; i++) {
        const word = words[i];
        if (word === '-C') { target = resolve(target, words[++i]); continue; }
        if (word.startsWith('-C') && word.length > 2) { target = resolve(target, word.slice(2)); continue; }
        if (word === '--work-tree') { workTree = words[++i]; continue; }
        if (word.startsWith('--work-tree=')) { workTree = word.slice(12); continue; }
        if (word === '--git-dir') { gitDir = words[++i]; continue; }
        if (word.startsWith('--git-dir=')) { gitDir = word.slice(10); continue; }
        if (word === '-c' || word.startsWith('--config-env')) gitOptionsUncertain = true;
        if (['-c', '--namespace', '--config-env', '--exec-path', '--super-prefix', '--attr-source'].includes(word)) { i++; continue; }
        if (!word.startsWith('-')) break;
        if (!/^(?:--(?:namespace|config-env|exec-path|super-prefix|attr-source)=|--(?:no-pager|paginate|bare|no-optional-locks)$)/.test(word)) opaque('git.options');
      }
      if (workTree) additionalTargets.push(canonical(resolve(target, workTree)));
      if (gitDir) target = dirname(resolve(target, gitDir));
      else if (workTree) target = resolve(target, workTree);
      const sub = words[i], args = words.slice(i + 1), pos = positional(args, ['--repo', '--receive-pack', '--exec', '-m', '--message',
        '--author', '--date', '-F', '--file', '-C', '-c', '--cleanup', '--trailer', '--fixup', '--squash', '--pathspec-from-file']);
      if (['push', 'merge', 'tag', 'rebase', 'commit', 'reset', 'checkout', 'switch', 'cherry-pick', 'revert', 'clean', 'stash', 'add', 'rm', 'mv', 'config', 'update-ref', 'pull', 'apply', 'am'].includes(sub) ||
        (sub === 'branch' && args.some(w => /^-[^-]*[DdMmCcf]/.test(w) || ['--delete', '--move', '--copy', '--force'].includes(w)))) action = `git.${sub}`;
      ref = pos.at(-1) ?? git(target, ['symbolic-ref', '--short', 'HEAD']) ?? '';
      if (sub === 'tag' && (!args.length || args.some(w => ['-l', '--list', '-v', '--verify'].includes(w)))) action = undefined;
      if (sub === 'config' && (args.some(w => /^(--get|--list|-l|-e)/.test(w)) || pos.length < 2)) action = undefined;
      checkVersions = ['push', 'commit', 'merge'].includes(sub);
      if (sub === 'merge') revision = pos.find(w => !/^(?:--|FETCH_HEAD$)/.test(w));
      // Every commit contains the index; path/--all commits additionally select
      // worktree content. Option operands must never select the wrong tree.
      if (sub === 'commit') { revision = ':INDEX'; versionRefs = [':INDEX', ...(args.includes('--all') || args.some(w => /^-[a-z]*a/.test(w)) || pos.length ? [undefined] : [])]; }
      if (sub === 'update-ref') requests.push({ action, code: 'OWNER_ONLY', repo: context.repo, ref });
      if (sub === 'remote' && !['', 'show', 'get-url', '-v', '--verbose'].includes(args[0] ?? '') || sub === 'config' && action) opaque('git.config-mutation');
      ownerOnly = sub === 'am' || sub === 'apply' && (args.includes('--apply') || !args.some(w=>['--check','--stat','--numstat','--summary'].includes(w)));
      if (sub === 'clean' && !args.includes('--dry-run') && !args.includes('-n')) {
        for (const path of pos.length ? pos : ['.']) requests.push({action:'file.rm',repo:context.repo,ref:canonical(resolve(target,path))});
      }
      if (sub === 'push') {
        const branch = git(target, ['symbolic-ref', '--short', 'HEAD']);
        const destination = valueAfter(args, '--repo') ?? pos[0] ??
          git(target, ['config', `branch.${branch}.pushRemote`]) ?? git(target, ['config', 'remote.pushDefault']) ??
          git(target, ['config', `branch.${branch}.remote`]) ?? 'origin';
        const destinations = pushUrls(target, destination);
        [remote, ...extraRemotes] = destinations;
        // get-url expands pushInsteadOf/insteadOf and pushurl before comparison.
        ref = pos.length <= 1 ? git(target, ['symbolic-ref', '--short', 'HEAD']) ?? '' : pos.slice(1).join(' ');
        versionRefs = pos.length <= 1 ? ['HEAD'] : pos.slice(1).flatMap(p => p.replace(/^\+/, '') === ':' ?
          (git(target, ['for-each-ref', '--format=%(refname)', 'refs/heads/']) ?? '').split('\n').filter(Boolean) :
          [p.replace(/^\+/, '').split(':')[0]]).filter(Boolean);
        if (args.some(w => ['--all','--branches','--tags','--mirror'].includes(w))) {
          const namespaces = args.includes('--mirror') ? ['refs/'] : [
            ...(args.some(w => ['--all','--branches'].includes(w)) ? ['refs/heads/'] : []), ...(args.includes('--tags') ? ['refs/tags/'] : [])];
          versionRefs = (git(target, ['for-each-ref', '--format=%(refname)', ...namespaces]) ?? '').split('\n').filter(Boolean);
        }
        if (args.includes('--follow-tags')) versionRefs.push(...(git(target,['for-each-ref','--format=%(refname)','refs/tags/']) ?? '').split('\n').filter(Boolean));
        revision = 'HEAD';
      }
    } else if (exe === 'gh') {
      const selected = valueAfter(words, '--repo', '-R') ?? env.GH_REPO;
      const pos = positional(words, ['--repo', '-R', '--body', '-b', '--title', '-t', '--subject', '--comment', '-c', '--body-file', '-F', '--target', '--notes-file']);
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
      if (noun === 'pr' && (['merge', 'ready', 'close'].includes(verb) || verb === 'review' && (words.includes('--approve') || words.includes('-a'))) || noun === 'release') {
        if (noun === 'release' && (!verb || ['view', 'list', 'download'].includes(verb))) continue;
        action = `gh.${noun}.${verb}`; ref = argument ?? '';
        const url = argument?.match(/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)/);
        remote = url ? `${url[1]}/${url[2]}` : selected;
        if (url) ref = url[3];
      }
    } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(exe)) {
      target = resolve(cwd, valueAfter(words, '--prefix') ?? valueAfter(words, '--cwd', '-C') ?? cwd);
      const scriptTargets = npmWorkspaces(target, words);
      if (scriptTargets.length) [target, ...additionalTargets] = scriptTargets;
      const pos = positional(words, ['--prefix', '--cwd', '-C', '--workspace', '-w']);
      let [sub, script] = pos;
      if (sub === 'run-script') sub = 'run';
      else if (exe !== 'npm' && sub && !['run','publish','version','pkg','install','ci','add','remove','exec','test','list','info','help'].includes(sub)) {
        script = sub; sub = 'run';
      }
      if (sub === 'version' && !script) continue; // npm version without an argument only prints versions.
      if (sub === 'pkg' && script === 'set' && pos.slice(2).some(w => /^version=/.test(w))) {
        action = `${exe}.version`; ref = pos.slice(2).join(' '); checkVersions = true;
      } else if (['publish', 'version'].includes(sub) || sub === 'run' && /(?:^|[:/-])(release|publish|version|bump)(?:$|[:/-])/.test(script ?? '')) {
        action = `${exe}.${sub}`; ref = script ?? sub; checkVersions = true;
      } else if (['run', 'install', 'ci', 'add', 'remove'].includes(sub)) { action = `${exe}.${sub}`; ref = script ?? sub; }
      if (action === `${exe}.version`) {
        try { privateVersion = JSON.parse(fs.readFileSync(join(target, 'package.json'), 'utf8')).private === true; }
        catch { /* Unknown publication status keeps the release gate. */ }
        if (privateVersion) checkVersions = false;
      }
      if (sub === 'run' && script) {
        for (const directory of scriptTargets) {
          try {
            const body = JSON.parse(fs.readFileSync(join(directory, 'package.json'), 'utf8')).scripts?.[script];
            if (typeof body === 'string') requests.push(...classify(body, directory, context, depth + 1));
          } catch { /* Unknown aliases still retain the outer workspace check. */ }
        }
      }
    } else if (/(?:^|[-_.])(release|publish|bump)(?:[-_.]|$)/i.test(exe) ||
      ['node', 'tsx', 'ts-node', 'deno', 'bash', 'sh', 'zsh', 'bun', 'npx'].includes(exe) &&
      !(exe === 'node' && words.includes('--test') && words.indexOf('--test') < words.findIndex(w => !w.startsWith('-'))) &&
      words.some(w => /(?:^|[/])(?:release|publish|bump)(?:[-_.]|$)/i.test(w))) {
      action = 'script.release'; ref = words[0] ?? exe;
      if (words[0] && /[\/]/.test(words[0])) target = dirname(resolve(cwd, words[0]));
    } else if (['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'chmod', 'chown', 'truncate', 'install', 'dd', 'ln'].includes(exe)) {
      const paths = words.filter(w => !w.startsWith('-'));
      const destination = valueAfter(words,'--target-directory','-t');
      const targets = exe === 'dd' ? words.filter(w => w.startsWith('of=')).map(w => w.slice(3)) :
        ['cp','install','ln'].includes(exe) ? [destination ?? paths.at(-1)].filter(Boolean) : paths;
      for (const path of targets) {
        const resolved = canonical(resolve(cwd, path));
        requests.push({ action: `file.${exe}`, repo: repository(dirname(resolved)).repo, ref: resolved, foreign: !inside(context.workspace, resolved) });
      }
    }
    if (!action) continue;
    const repo = repository(canonical(target));
    const destination = remote ? repoIdentity(remote, target) : repo.repo;
    const request = { action, ref, repo: destination, cwd: canonical(target), checkVersions, revision, versionRefs,
      foreign: repo.path !== context.path || !inside(context.workspace, canonical(target)) || destination !== context.repo,
      release: /^(?:npm|pnpm|yarn|bun)\.publish$/.test(action) ||
        /^(?:npm|pnpm|yarn|bun)\.version$/.test(action) && !privateVersion || action === 'script.release' ||
        action.endsWith('.run') && /release|publish|version|bump/.test(ref) || action.startsWith('gh.release.'),
      uncertain: parsed.uncertain || [target, remote, ...words.filter((w, i) => i === 0 || words[i - 1] !== '-m' && words[i - 1] !== '--message')].some(w => /__H2A_(DYNAMIC|SUB)/.test(w ?? '')) || Object.keys(env).some(k => /^(?:GIT_CONFIG|GIT_COMMON_DIR)/.test(k)) ||
        gitOptionsUncertain || exe === 'git' && words.some(w => w === '--mirror' || w === '--all' && action === 'git.push') };
    requests.push(request);
    if (ownerOnly) requests.push({...request,code:'OWNER_ONLY'});
    for (const path of additionalTargets) {
      const repo = repository(path);
      let release = request.release, checkVersions = request.checkVersions;
      if (/^(?:npm|pnpm|yarn|bun)\.version$/.test(action)) {
        let privatePackage = false;
        try { privatePackage = JSON.parse(fs.readFileSync(join(path, 'package.json'), 'utf8')).private === true; } catch { /* Keep release gate. */ }
        release = checkVersions = !privatePackage;
      }
      requests.push({ ...request, cwd: path, repo: repo.repo, release, checkVersions,
        foreign: repo.path !== context.path || !inside(context.workspace, path) || repo.repo !== context.repo });
    }
    for (const locator of extraRemotes) {
      const repo = repoIdentity(locator, target);
      requests.push({ ...request, repo, foreign: request.foreign || repo !== context.repo });
    }
    } finally {
      if (envChdir) cwd = groupCwd;
      if (group.separator === ')') {
        const previous = stack.pop();
        if (!previous) opaque();
        else { cwd = previous.cwd; variables = previous.variables; oldpwd = previous.oldpwd; directories.splice(0,directories.length,...previous.directories); }
      }
      if (pipeline !== undefined && group.separator !== '|') {
        cwd = pipeline.cwd; variables = pipeline.variables; oldpwd=pipeline.oldpwd; directories.splice(0,directories.length,...pipeline.directories); pipeline = undefined;
      }
    }
  }
  // A short-circuit can skip a later cwd/environment reset. The linear subset
  // must never erase the prior foreign context by assuming that reset ran.
  if (conditionalState) opaque('shell.conditional-state');
  return requests;
}

export function patchBump(path, patch, cwd) {
  let old;
  try { old = JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return false; }
  if (!old.name || !old.version || old.private === true) return false;
  const section = patch.split(/^\*\*\* (?:Update File|Add File|Delete File): /m)
    .find(s => canonical(resolve(cwd, s.split('\n')[0])) === path);
  const versions = [...(section ?? patch).matchAll(/^\+.*?"version"\s*:\s*"([^"]+)"/gm)];
  return versions.some(m => m[1] !== old.version);
}

export function prBump(request) {
  if (!/^[\w.-]+\/[^/]+\/[^/]+$/.test(request.repo)) return undefined;
  if (!request.ref) {
    const result = spawnSync('gh', ['pr', 'view', '--repo', request.repo, '--json', 'number'],
      { cwd: request.cwd, encoding: 'utf8', timeout: 4000, maxBuffer: 100_000 });
    try { request.ref = String(JSON.parse(result.stdout).number); } catch { return undefined; }
  }
  if (!/^\d+$/.test(request.ref)) return undefined;
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
export function branchBump(cwd, revision, baseline) {
  const base = baseline ?? git(cwd, ['merge-base', 'origin/main', 'HEAD']) ?? git(cwd, ['merge-base', 'main', 'HEAD']);
  if (!base) return undefined;
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return undefined;
  const files = git(root, ['diff', '--name-only', ...(revision === ':INDEX' ? ['--cached'] : []), base,
    ...(revision && revision !== ':INDEX' ? [revision] : []), '--', '*package.json', 'package.json']);
  if (files === undefined) return undefined;
  return files.split('\n').filter(p => basename(p) === 'package.json').some(path => {
    const before = git(root, ['show', `${base}:${path}`]);
    let after;
    try { after = revision ? git(root, ['show', `${revision === ':INDEX' ? '' : revision}:${path}`]) : fs.readFileSync(join(root, path), 'utf8'); } catch { return false; }
    return before && publishedBump(before, after);
  });
}
