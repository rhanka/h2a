#!/usr/bin/env node
/**
 * Zero-Python guard (owner standing rule: no interpreter outside the allowlist).
 *
 * Scans TRACKED files only (`git ls-files`) and distinguishes EXECUTABLE
 * contexts from prose:
 *   - `#!` shebang lines are checked on EVERY tracked file (interpreter word
 *     tested, `/usr/bin/env` flags skipped, so `pypy3` and `env -S` count);
 *   - tracked `*.py|*.pyw|*.pyi|*.pyx` sources always fail (case-insensitive);
 *   - shell snippets (`.sh`/hooks, extensionless non-dotfiles, `Makefile`s,
 *     `package.json` scripts, workflow `run:`/`command:`/`script:`/`args:`
 *     steps, `Dockerfile` RUN/CMD/ENTRYPOINT/ONBUILD instructions) are parsed
 *     for a command in command position — quoted (`"…"`) and escaped (`\…`)
 *     forms included, `$(…)`/backtick bodies recursed into, `sh -c` snippets
 *     recursed into, wrapper options (`sudo -u`, `timeout 5`, `nice -n`, …)
 *     skipped — so redirect targets, `echo` arguments and full-line `#`
 *     comments never match;
 *   - `Dockerfile` FROM images naming python and workflow `uses:` actions
 *     referencing python fail; workflow `shell:` values are shell-scanned;
 *   - installer lines (`apk add`, `apt-get install`, `brew install`, …) also
 *     match python-ish package names (`python3-dev`, `py3-pip`,
 *     `python@3.12`);
 *   - JS/TS files match when a string literal that LOOKS LIKE a shell
 *     invocation is passed to a process-spawning call
 *     (`spawn`/`exec`/`execFile`/`fork`/`execa` and their `Sync` variants,
 *     including `import`/`require` aliases and `const run = execSync`),
 *     when a one-level `const cmd = "python3 …"` binding flows into such a
 *     call, or when an `execa` tagged template carries one —
 *     so `//` comments, data strings and canary arrays stay silent;
 *   - Markdown/prose files are never content-scanned (shebang rule aside).
 *
 * Vocabulary is lowercase-only and matched as whole command words, so
 * `check-no-python`, `CPython`, `pipeline` or `"Python"` never match.
 *
 * KNOWN REMAINING LIMITS (fail-open, documented instead of assured):
 * `cp.execSync`-style member-call sinks, re-assigned (multi-level) JS
 * bindings, computed string assembly, exotic YAML exec spellings, and `//`
 * inside JS regex literals.
 *
 * The allowlist (`scripts/no-python-allowlist.txt`, `FILE|FULL_LINE[|COUNT]`)
 * excuses a hit only on EXACT trimmed-line equality, and every entry must be
 * observed EXACTLY its expected number of times (default 1): stale entries
 * and duplicated/injected lines both fail the gate.
 *
 * Usage: node scripts/check-no-python.mjs   (CI gate: `zero-python` job)
 * Exit 0 when clean, 1 on any unexcused hit / allowlist problem / I/O error.
 */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const ALLOWLIST_REL = 'scripts/no-python-allowlist.txt';

// Lowercase-only: real interpreter binaries are lowercase; capitalised prose
// (`Python`, `Pip`) and hyphenated names (`check-no-python`) never match.
const PY_BASE_RE = /^(?:python\d*(?:\.\d+)*|pythonw|pypy\d*(?:\.\d+)*|pyw?|pip\d*(?:\.\d+)*)$/;
const PY_TOOL_CMDS = new Set(['uv', 'uvx', 'pipx', 'poetry']);
const SHELL_WRAPPERS = new Set([
  'sudo', 'command', 'exec', 'env', 'nohup', 'xargs', 'timeout', 'nice',
  'time', 'stdbuf', 'eval', 'sh', 'bash', 'dash', 'zsh', 'ksh',
]);
const SHELL_NAMES = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh']);
// Wrapper flags that consume the FOLLOWING word as their value
// (`sudo -u alice …`, `timeout -s KILL 5 …`, `nice -n 5 …`).
const WRAPPER_VALUE_FLAGS = {
  sudo: new Set(['-u', '-g', '-U', '-h', '-p', '-r', '-t', '-C', '--user', '--group', '--host', '--prompt', '--role', '--type']),
  env: new Set(['-u', '--unset']),
  timeout: new Set(['-s', '--signal']),
  nice: new Set(['-n']),
  time: new Set(['-o', '--output']),
  stdbuf: new Set(['-o', '-e', '--output', '--error']),
  xargs: new Set(['-I', '-n', '-P', '-s', '-a', '-d', '-E', '--max-args', '--max-procs']),
  exec: new Set(['-a']),
};
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'in', 'function', 'select', 'coproc', 'export', 'readonly',
  'local', 'declare', '!', '{', '}',
]);
const INSTALL_RE = /\b(apk\s+add|apt-get\s+install|apt\s+install|dnf\s+install|yum\s+install|zypper\s+install|brew\s+install|pkg\s+install)\b/;
// Python-ish distro package names on installer lines (`python3-dev`,
// `py3-pip`, `python3-pip`, `python@3.12`); tested lowercased.
const INSTALL_PKG_RE = /(^|[^a-z0-9])python\d*([^a-z0-9]|$)|^pip\d*([^a-z0-9]|$)|^pypy\d*([^a-z0-9]|$)|^py\d([^a-z0-9]|$)|^python@/;
const REDIRECT_RE = /^(\d+)?(>>|>|<<-|<<|<<<|<>|>&|<&)/;
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const DURATION_RE = /^[\d.]+(ns|us|µs|ms|s|m|h|d)?$/;

function stripQuotes(word) {
  let w = word;
  if (w.startsWith('$') && (w[1] === "'" || w[1] === '"' || w[1] === '`')) w = w.slice(1);
  if (w.length >= 2 && w[0] === w[w.length - 1] && (w[0] === "'" || w[0] === '"' || w[0] === '`')) {
    const q = w[0];
    w = w.slice(1, -1);
    if (q !== "'") w = w.replace(/\\(.)/gs, '$1');
  } else {
    w = w.replace(/\\(.)/gs, '$1');
  }
  return w;
}

function baseName(word) {
  const i = word.lastIndexOf('/');
  return i >= 0 ? word.slice(i + 1) : word;
}

export function isPyCommandWord(word) {
  return PY_BASE_RE.test(baseName(stripQuotes(word)));
}

/** Python-ish distro package name on an installer line (lowercased test). */
export function isPyPackageWord(word) {
  const w = baseName(stripQuotes(word));
  if (PY_BASE_RE.test(w)) return true;
  return INSTALL_PKG_RE.test(w.toLowerCase());
}

/** True when a Dockerfile image reference names a python image. */
export function isPythonImage(ref) {
  const seg = stripQuotes(ref).slice(stripQuotes(ref).lastIndexOf('/') + 1);
  const name = seg.split(/[:@]/)[0];
  return /python/i.test(name) || /^(pypy\d*|py\d)/i.test(name);
}

/**
 * Read one worktree entry for scanning.
 * Symlinks are judged by NAME (link and target basenames): a link exposing an
 * interpreter is a hit; a dangling or otherwise unreadable link with a neutral
 * name is silent (a link carries no code of its own). Readable link targets
 * are content-scanned like regular files. Genuinely unreadable non-links stay
 * fail-closed (`unreadable`).
 */
export function readScanEntry(rootDir, rel) {
  const abs = join(rootDir, rel);
  let st = null;
  try {
    st = lstatSync(abs);
  } catch {
    return { status: 'unreadable' };
  }
  if (st.isSymbolicLink()) {
    let target = null;
    try {
      target = readlinkSync(abs);
    } catch {
      target = null;
    }
    if (isPyCommandWord(rel) || (target != null && isPyCommandWord(target))) {
      return { status: 'hit', line: 1, text: `<symlink exposing an interpreter -> ${target ?? 'unreadable target'}>` };
    }
    let content = null;
    try {
      content = readFileSync(abs);
    } catch {
      content = null;
    }
    if (content == null || content.subarray(0, 8192).includes(0)) return { status: 'skipped' };
    return { status: 'content', content: content.toString('utf8') };
  }
  let buf = null;
  try {
    buf = readFileSync(abs);
  } catch {
    return { status: 'unreadable' };
  }
  if (buf.subarray(0, 8192).includes(0)) return { status: 'skipped' };
  return { status: 'content', content: buf.toString('utf8') };
}

function readBacktick(text, at) {
  let i = at + 1;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) { i += 2; continue; }
    if (text[i] === '`') return [text.slice(at + 1, i), i + 1];
    i++;
  }
  return [text.slice(at + 1), text.length];
}

function readDollarParen(text, at) {
  let i = at + 2;
  let depth = 1;
  let sq = false;
  let dq = false;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (sq) { if (c === "'") sq = false; i++; continue; }
    if (dq) {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') dq = false;
      if (c === '`') { const r = readBacktick(text, i); i = r[1]; continue; }
      i++; continue;
    }
    if (c === "'") sq = true;
    else if (c === '"') dq = true;
    else if (c === '`') { const r = readBacktick(text, i); i = r[1]; continue; }
    else if (c === '$' && text[i + 1] === '(') { depth++; i += 2; continue; }
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  return [text.slice(at + 2, Math.max(i - 1, at + 2)), i];
}

// Flatten one shell snippet: recurse into executed substitutions, cut `#`
// comments, keep quotes verbatim for the word splitter below.
function flattenShell(text, onHit) {
  let flat = '';
  let i = 0;
  const n = text.length;
  let sq = false;
  let dq = false;
  while (i < n) {
    const c = text[i];
    if (sq) { flat += c; if (c === "'") sq = false; i++; continue; }
    if (dq) {
      if (c === '\\' && i + 1 < n) { flat += text[i] + text[i + 1]; i += 2; continue; }
      if (c === '"') { dq = false; flat += c; i++; continue; }
      if (c === '`') {
        const r = readBacktick(text, i);
        scanShellLevel(r[0], onHit);
        flat += ' '.repeat(Math.max(r[1] - i, 1)); i = r[1]; continue;
      }
      if (c === '$' && text[i + 1] === '(') {
        const r = readDollarParen(text, i);
        scanShellLevel(r[0], onHit);
        flat += ' '.repeat(Math.max(r[1] - i, 1)); i = r[1]; continue;
      }
      flat += c; i++; continue;
    }
    if (c === "'") { sq = true; flat += c; i++; continue; }
    if (c === '"') { dq = true; flat += c; i++; continue; }
    if (c === '`') {
      const r = readBacktick(text, i);
      scanShellLevel(r[0], onHit);
      flat += ' '.repeat(Math.max(r[1] - i, 1)); i = r[1]; continue;
    }
    if (c === '$' && text[i + 1] === '(') {
      const r = readDollarParen(text, i);
      scanShellLevel(r[0], onHit);
      flat += ' '.repeat(Math.max(r[1] - i, 1)); i = r[1]; continue;
    }
    if (c === '#' && (i === 0 || /[\s;|&(){}!]/.test(text[i - 1]))) break;
    flat += c; i++;
  }
  return flat;
}

function splitTopLevel(flat) {
  const segs = [];
  let cur = '';
  let i = 0;
  let sq = false;
  let dq = false;
  const push = () => { segs.push(cur); cur = ''; };
  while (i < flat.length) {
    const c = flat[i];
    if (sq) { cur += c; if (c === "'") sq = false; i++; continue; }
    if (dq) {
      cur += c;
      if (c === '\\' && i + 1 < flat.length) { cur += flat[i + 1]; i += 2; continue; }
      if (c === '"') dq = false;
      i++; continue;
    }
    if (c === "'") { sq = true; cur += c; i++; continue; }
    if (c === '"') { dq = true; cur += c; i++; continue; }
    if (c === '\\' && i + 1 < flat.length) { cur += c + flat[i + 1]; i += 2; continue; }
    if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') { push(); i++; continue; }
    cur += c; i++;
  }
  push();
  return segs;
}

function splitWords(seg) {
  const words = [];
  let cur = '';
  let has = false;
  let sq = false;
  let dq = false;
  const push = () => { if (has || cur !== '') words.push(cur); cur = ''; has = false; };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (sq) { cur += c; if (c === "'") sq = false; continue; }
    if (dq) {
      cur += c;
      if (c === '\\' && i + 1 < seg.length) { cur += seg[i + 1]; i++; continue; }
      if (c === '"') dq = false;
      continue;
    }
    if (c === "'") { sq = true; cur += c; has = true; continue; }
    if (c === '"') { dq = true; cur += c; has = true; continue; }
    if (c === '\\' && i + 1 < seg.length) { cur += c + seg[i + 1]; i++; has = true; continue; }
    if (c === ' ' || c === '\t') { push(); continue; }
    cur += c; has = true;
  }
  push();
  return words;
}

function segmentInvokesPython(seg) {
  const words = splitWords(seg);
  if (words.length === 0) return false;
  if (INSTALL_RE.test(seg) && words.some((w) => isPyPackageWord(w))) return true;
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (ASSIGN_RE.test(w)) { i++; continue; }
    if (REDIRECT_RE.test(w)) {
      if (/^(\d+)?(>>|>|<<-|<<|<<<|<>|>&|<&)$/.test(w)) i += 2;
      else i++;
      continue;
    }
    const bare = stripQuotes(w);
    if (bare === '-') { i++; continue; } // YAML `- item` list marker
    if (SHELL_KEYWORDS.has(bare)) { i++; continue; }
    if (bare.startsWith('-') && bare.length > 1) { i++; continue; }
    if (SHELL_WRAPPERS.has(bare)) {
      i++;
      // Skip the wrapper's own options: assignments, flags, flag values
      // (`sudo -u alice`), durations (`timeout 5`). `sh -c <snippet>` and
      // quoted multi-word snippets (`eval "python3 -c x"`) are recursed into.
      const valued = WRAPPER_VALUE_FLAGS[bare] || new Set();
      while (i < words.length) {
        const a = stripQuotes(words[i]);
        if (ASSIGN_RE.test(words[i])) { i++; continue; }
        if (SHELL_NAMES.has(bare) && (a === '-c' || a === '--command')) {
          i++;
          if (i < words.length && scanShellSnippet(stripQuotes(words[i]))) return true;
          i++;
          continue;
        }
        if (a.startsWith('-') && a.length > 1) {
          i++;
          if (valued.has(a) && i < words.length) i++;
          continue;
        }
        if (DURATION_RE.test(a)) { i++; continue; }
        if (a.includes(' ') || a.includes('\t')) {
          if (scanShellSnippet(a)) return true;
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    const b = baseName(bare);
    return PY_BASE_RE.test(b) || PY_TOOL_CMDS.has(b);
  }
  return false;
}

function scanShellLevel(text, onHit) {
  const flat = flattenShell(text, onHit);
  for (const seg of splitTopLevel(flat)) {
    if (segmentInvokesPython(seg)) onHit();
  }
}

/** True when a shell snippet (one logical line, script value, …) invokes Python. */
export function scanShellSnippet(text) {
  let hit = false;
  scanShellLevel(text, () => { hit = true; });
  return hit;
}

/** Join `\`-continued lines; each entry keeps its starting 1-based line number. */
export function joinContinuations(content) {
  const lines = content.split('\n');
  const out = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (buf === '') start = i;
    const l = lines[i];
    if (/\\$/.test(l) && !/\\\\$/.test(l)) buf += l.slice(0, -1) + ' ';
    else { buf += l; out.push({ text: buf, line: start + 1 }); buf = ''; }
  }
  if (buf !== '') out.push({ text: buf, line: start + 1 });
  return out;
}

/** Unwrap one YAML single-line scalar: `"…"` / `'…'` (plus trailing comment). */
export function unquoteYamlScalar(s) {
  const t = s.trim();
  const m = t.match(/^(")(.*)"\s*(#.*)?$/) || t.match(/^(')(.*)'\s*(#.*)?$/);
  if (m) return m[2];
  return s;
}

/** Scan a YAML flow list (`["python3", "app.py"]`): any item that is a
 * command word — or itself a shell snippet invoking python — is a hit. */
export function scanFlowList(text) {
  const toks = text.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s,\[\]{}]+/g) || [];
  return toks.some((t) => {
    const u = stripQuotes(t);
    return isPyCommandWord(u) || ((u.includes(' ') || u.includes('\t')) && scanShellSnippet(u));
  });
}

/** Extract executable steps from a YAML file: `run:`, `command:`, `script:`,
 * `args:` (shell-scanned), `shell:` (shell-scanned value) and `uses:`
 * (flagged when it references python, e.g. `setup-python`). Block scalars
 * and indented block lines are collected; comments skipped.
 * `text` is the scanned fragment, `raw` the full trimmed line (hit identity),
 * `flow` selects flow-list scanning for `[...]` forms. */
export function extractWorkflowRuns(content) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^(\s*(?:-\s+)?)(run|command|script|args|uses|shell)\s*:(.*)$/);
    if (!m) continue;
    const key = m[2];
    const keyIdx = line.indexOf(`${key}:`);
    const inline = m[3].trim();
    // `text` is the scanned shell fragment, `raw` the full trimmed line used
    // for hit identity (exact allowlist matching).
    if (inline === '' || /^[|>][+-]?\d*\s*(#.*)?$/.test(inline)) {
      for (let j = i + 1; j < lines.length; j++) {
        const bl = lines[j];
        if (/^\s*(#|$)/.test(bl)) continue;
        const indent = bl.match(/^\s*/)[0].length;
        if (indent <= keyIdx) break;
        const t = bl.trim();
        out.push({ key, text: t, raw: t, line: j + 1, flow: /^(-\s*)?\[/.test(t) });
      }
    } else if (/^#/.test(inline)) {
      continue;
    } else {
      out.push({ key, text: inline, raw: line.trim(), line: i + 1, flow: /^\[/.test(inline) });
    }
  }
  return out;
}

/** Extract `RUN`/`CMD`/`ENTRYPOINT` instructions (optional `ONBUILD` prefix,
 * continuations joined) from a Dockerfile.
 * `text` is the scanned shell fragment, `raw` the full logical line,
 * `flow` selects flow-list scanning for `["…", …]` exec-JSON forms. */
export function extractDockerRuns(content) {
  const out = [];
  for (const { text: logical, line } of joinContinuations(content)) {
    const m = logical.match(/^\s*(?:ONBUILD\s+)?(RUN|CMD|ENTRYPOINT)\s+(.*)$/i);
    if (!m) continue;
    const rest = m[2];
    const raw = logical.trim();
    out.push({ text: rest, raw, line, flow: /^\[/.test(rest.trim()) });
  }
  return out;
}

/** Extract `FROM` image references (continuations joined) from a Dockerfile.
 * `text` is the image reference (last word), `raw` the full logical line. */
export function extractDockerFroms(content) {
  const out = [];
  for (const { text: logical, line } of joinContinuations(content)) {
    const m = logical.match(/^\s*FROM\s+(.*)$/i);
    if (!m) continue;
    const words = splitWords(m[1]);
    if (words.length === 0) continue;
    out.push({ text: stripQuotes(words[words.length - 1]), raw: logical.trim(), line });
  }
  return out;
}

/** Scan the `scripts` map of a package.json file. */
export function scanPackageJson(rel, content) {
  const hits = [];
  let obj = null;
  try {
    obj = JSON.parse(content);
  } catch {
    hits.push({ file: rel, line: 1, text: '<unparseable package.json: cannot prove zero-python>' });
    return hits;
  }
  const scripts = obj != null && typeof obj === 'object' ? obj.scripts : null;
  if (scripts == null || typeof scripts !== 'object') return hits;
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    if (scanShellSnippet(value)) hits.push({ file: rel, line: `scripts.${name}`, text: value.trim().slice(0, 220) });
  }
  return hits;
}

// Tokenize JS/TS: blank comments and string literals (positions kept so line
// numbers survive), recording literal values with their start line. Template
// `${…}` interpolations stay live code; regex literals are left alone (a
// literal `//` or `/*` inside one is a known blind spot, misses only).
function tokenizeJs(content) {
  const n = content.length;
  const out = content.split('');
  const literals = [];
  const blank = (a, b) => { for (let k = a; k < b; k++) { if (out[k] !== '\n') out[k] = ' '; } };
  const readQuoted = (q, i, lineRef) => {
    const a = i;
    const startLine = lineRef.v;
    i++;
    let raw = '';
    while (i < n && content[i] !== q) {
      if (content[i] === '\\' && i + 1 < n) { raw += content[i] + content[i + 1]; i += 2; continue; }
      if (content[i] === '\n') lineRef.v++;
      raw += content[i]; i++;
    }
    i = Math.min(i + 1, n);
    return { raw, end: i, a, startLine };
  };
  let i = 0;
  const lineRef = { v: 1 };
  const tplStack = []; // {chunkStart, startLine, chunks[]}
  const blankTplChunk = (a, b) => blank(a, b);
  while (i < n) {
    const c = content[i];
    if (c === '\n') { lineRef.v++; i++; continue; }
    if (tplStack.length > 0 && tplStack[tplStack.length - 1].exprDepth != null) {
      const top = tplStack[tplStack.length - 1];
      if (c === '{') { top.exprDepth++; i++; continue; }
      if (c === '}') {
        top.exprDepth--;
        i++;
        if (top.exprDepth === 0) top.exprDepth = null;
        continue;
      }
    }
    const inTpl = tplStack.length > 0 && tplStack[tplStack.length - 1].exprDepth == null;
    if (!inTpl && c === '/' && content[i + 1] === '/') {
      const a = i;
      while (i < n && content[i] !== '\n') i++;
      blank(a, i); continue;
    }
    if (!inTpl && c === '/' && content[i + 1] === '*') {
      const a = i;
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) { if (content[i] === '\n') lineRef.v++; i++; }
      i = Math.min(i + 2, n); blank(a, i); continue;
    }
    if (c === "'" || c === '"') {
      const r = readQuoted(c, i, lineRef);
      literals.push({ start: r.a, end: r.end, value: r.raw, line: r.startLine });
      blank(r.a, r.end); i = r.end; continue;
    }
    if (c === '`') {
      tplStack.push({ chunkStart: i + 1, startLine: lineRef.v, chunks: [], litStart: i });
      i++; continue;
    }
    if (inTpl && c === '\\' && i + 1 < n) {
      if (content[i + 1] === '\n') lineRef.v++;
      i += 2; continue;
    }
    if (inTpl && c === '$' && content[i + 1] === '{') {
      const top = tplStack[tplStack.length - 1];
      top.chunks.push({ text: content.slice(top.chunkStart, i), line: top.startLine });
      blankTplChunk(top.chunkStart, i);
      top.exprDepth = 1;
      i += 2; continue;
    }
    if (inTpl && c === '`') {
      const top = tplStack.pop();
      top.chunks.push({ text: content.slice(top.chunkStart, i), line: top.startLine });
      blankTplChunk(top.chunkStart, i);
      blank(top.litStart, top.litStart + 1);
      blank(i, i + 1);
      literals.push({ start: top.litStart, end: i + 1, value: top.chunks.map((k) => k.text).join(' '), line: top.startLine });
      i++; continue;
    }
    i++;
  }
  while (tplStack.length > 0) {
    const top = tplStack.pop();
    top.chunks.push({ text: content.slice(top.chunkStart, n), line: top.startLine });
    blankTplChunk(top.chunkStart, n);
    literals.push({ start: top.litStart, end: n, value: top.chunks.map((k) => k.text).join(' '), line: top.startLine });
  }
  return { code: out.join(''), literals };
}

const BASE_SINKS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork', 'execa'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Process-spawning names visible in one JS/TS file: base sinks plus local
 * aliases (`const run = execSync`, `import {execSync as run}`,
 * `const {execSync: run} = require('child_process')`). */
export function collectJsSinkAliases(content) {
  const aliases = new Set();
  const alt = BASE_SINKS.join('|');
  let m;
  const direct = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${alt})\\b`, 'g');
  while ((m = direct.exec(content)) !== null) aliases.add(m[1]);
  const imp = /\bimport\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g;
  while ((m = imp.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const im = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (im && BASE_SINKS.includes(im[1])) aliases.add(im[2] || im[1]);
    }
  }
  const destr = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"][^'"]*child_process[^'"]*['"]\s*\)/g;
  while ((m = destr.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const dm = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (dm && BASE_SINKS.includes(dm[1])) aliases.add(dm[2] || dm[1]);
    }
  }
  return aliases;
}

/** One-level `const name = "python3 …"` bindings whose string value looks
 * like a shell invocation (re-assignment and computed assembly stay blind). */
export function collectJsPyBindings(content) {
  const bound = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*("([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*')/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const inner = m[2].slice(1, -1);
    if (scanShellSnippet(inner)) {
      bound.push({ name: m[1], value: inner, line: content.slice(0, m.index).split('\n').length });
    }
  }
  return bound;
}

function findClosingParen(code, openIdx) {
  let depth = 1;
  const limit = Math.min(code.length, openIdx + 5000);
  for (let i = openIdx + 1; i < limit; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Scan a JS/TS file: string literals that look like shell invocations AND sit
 * inside a process-spawning call (aliases included) are hits, as are
 * one-level python bindings passed to such calls and `execa` tagged
 * templates carrying an invocation. */
export function scanJsFile(rel, content) {
  const hits = [];
  const { code, literals } = tokenizeJs(content);
  const sinkNames = [...BASE_SINKS, ...collectJsSinkAliases(content)];
  const sinkRe = new RegExp(`\\b(${sinkNames.map(escapeRegExp).join('|')})\\s*\\(`, 'g');
  const tagRe = new RegExp(`\\b(${sinkNames.map(escapeRegExp).join('|')})\\s*$`);
  const ranges = [];
  let m = null;
  while ((m = sinkRe.exec(code)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    let closeIdx = findClosingParen(code, openIdx);
    if (closeIdx < 0) closeIdx = openIdx + 2000;
    ranges.push([openIdx, closeIdx]);
  }
  for (const lit of literals) {
    if (tagRe.test(code.slice(Math.max(0, lit.start - 64), lit.start))) {
      if (scanShellSnippet(lit.value)) {
        hits.push({ file: rel, line: lit.line, text: lit.value.trim().slice(0, 220) });
      }
      continue;
    }
    for (const [a, b] of ranges) {
      if (lit.start > a && lit.start < b) {
        if (scanShellSnippet(lit.value)) {
          hits.push({ file: rel, line: lit.line, text: lit.value.trim().slice(0, 220) });
        }
        break;
      }
    }
  }
  for (const bound of collectJsPyBindings(content)) {
    const useRe = new RegExp(`\\b${escapeRegExp(bound.name)}\\b`);
    if (ranges.some(([a, b]) => useRe.test(code.slice(a, b)))) {
      hits.push({ file: rel, line: bound.line, text: bound.value.trim().slice(0, 220) });
    }
  }
  return hits;
}

export function isPythonSourceFile(rel) {
  return /\.(py|pyw|pyi|pyx)$/i.test(rel);
}

/** True when a `#!` line selects a python interpreter (`/usr/bin/env` forms
 * with flags like `-S` included; plain shells stay silent). */
export function scanShebangLine(firstLine) {
  const m = firstLine.match(/^#!\s*(.*)$/);
  if (!m) return false;
  const toks = splitWords(m[1]).map(stripQuotes);
  if (toks.length === 0) return false;
  let interp = baseName(toks[0]);
  if (interp === 'env') {
    let i = 1;
    while (i < toks.length) {
      const t = toks[i];
      if (t === '-S' || t === '--split-string') { i++; continue; }
      if (/^-/.test(t)) {
        if (/^(-u|--unset|--block-signal|--default-signal|--ignore-signal)$/.test(t)) i += 2;
        else i++;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
      break;
    }
    if (i >= toks.length) return false;
    interp = baseName(toks[i]);
  }
  return PY_BASE_RE.test(interp) || PY_TOOL_CMDS.has(interp);
}

/** Executable-content kind for a tracked path (null = prose: shebang rule only). */
export function classifyFile(rel, firstLine) {
  const b = basename(rel);
  if (/^dockerfile/i.test(b) || /\.dockerfile$/i.test(b)) return 'docker';
  if (b === 'package.json') return 'pkgjson';
  if (/\.(ya?ml)$/i.test(b)) return 'workflow';
  if (/\.(m?js|cjs|m?ts|cts|jsx|tsx)$/.test(b)) return 'js';
  if (/\.(sh|bash|zsh|ksh|dash)$/.test(b)) return 'shell';
  if (/^(gnumakefile|makefile)$/i.test(b) || /\.(mk|mak|make)$/i.test(b)) return 'shell';
  if (/^#!.*\b(bash|sh|dash|zsh|ksh)\b/.test(firstLine)) return 'shell';
  // Extensionless non-dotfiles (hooks/scripts without extension or shebang)
  // are shell-scanned; a prose line almost never sits in command position.
  if (!b.startsWith('.') && !b.includes('.')) return 'shell';
  return null;
}

/** All hits for one tracked file (pure: easy to unit-test with fixtures). */
export function scanFileHits(rel, content) {
  const hits = [];
  const push = (line, text) => {
    const t = String(text).trim().slice(0, 220);
    if (t !== '') hits.push({ file: rel, line, text: t });
  };
  if (isPythonSourceFile(rel)) {
    push(1, '<tracked python source file>');
    return hits;
  }
  const nl = content.indexOf('\n');
  const firstLine = nl < 0 ? content : content.slice(0, nl);
  if (scanShebangLine(firstLine)) push(1, firstLine);
  const kind = classifyFile(rel, firstLine);
  if (kind === null) return hits;
  if (kind === 'shell') {
    for (const { text, line } of joinContinuations(content)) {
      if (/^\s*(#|$)/.test(text)) continue;
      if (scanShellSnippet(text)) push(line, text);
    }
  } else if (kind === 'workflow') {
    for (const { key, text, raw, line, flow } of extractWorkflowRuns(content)) {
      if (/^\s*(#|$)/.test(text)) continue;
      if (key === 'uses') {
        if (/python/i.test(text)) push(line, raw);
      } else if (flow) {
        if (scanFlowList(text)) push(line, raw);
      } else if (scanShellSnippet(unquoteYamlScalar(text))) {
        push(line, raw);
      }
    }
  } else if (kind === 'docker') {
    for (const { text, raw, line, flow } of extractDockerRuns(content)) {
      if (flow ? scanFlowList(text) : scanShellSnippet(text)) push(line, raw);
    }
    for (const { text, raw, line } of extractDockerFroms(content)) {
      if (isPythonImage(text)) push(line, raw);
    }
  } else if (kind === 'pkgjson') {
    for (const h of scanPackageJson(rel, content)) hits.push(h);
  } else if (kind === 'js') {
    for (const h of scanJsFile(rel, content)) hits.push(h);
  }
  return hits;
}

/** Parse `FILE|FULL_LINE[|COUNT]` allowlist text. */
export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  text.split('\n').forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (/^\s*(#|$)/.test(raw)) return;
    const parts = raw.split('|');
    if (parts.length < 2 || parts.length > 3) {
      errors.push(`line ${lineNo}: expected FILE|FULL_LINE[|COUNT], got ${parts.length} field(s)`);
      return;
    }
    const file = parts[0].trim();
    const lit = parts[1].trim();
    if (file === '' || lit === '') {
      errors.push(`line ${lineNo}: empty FILE or FULL_LINE`);
      return;
    }
    let expected = 1;
    if (parts.length === 3) {
      expected = Number(parts[2].trim());
      if (!Number.isInteger(expected) || expected < 1) {
        errors.push(`line ${lineNo}: COUNT must be an integer >= 1`);
        return;
      }
    }
    entries.push({ file, text: lit, expected, observed: 0 });
  });
  return { entries, errors };
}

/** Excuse hits on EXACT file+line equality; every entry must hit its count. */
export function applyAllowlist(hits, entries) {
  const unexcused = [];
  for (const h of hits) {
    const e = entries.find((c) => c.file === h.file && c.text === h.text);
    if (e != null) e.observed++;
    else unexcused.push(h);
  }
  const problems = [];
  for (const e of entries) {
    if (e.observed === 0) {
      problems.push(`stale allowlist entry (0 hits, expected ${e.expected}): ${e.file}|${e.text}`);
    } else if (e.observed !== e.expected) {
      problems.push(
        `allowlist multiplicity mismatch (${e.observed} hits, expected ${e.expected}): ${e.file}|${e.text}`,
      );
    }
  }
  return { unexcused, problems, excused: hits.length - unexcused.length };
}

function main() {
  const g = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (g.status !== 0) {
    console.error('check-no-python: `git ls-files` failed — cannot prove zero-python');
    process.exit(1);
  }
  const rels = g.stdout.toString('utf8').split('\0').filter((s) => s !== '');
  let hits = [];
  for (const rel of rels) {
    if (rel === ALLOWLIST_REL) continue;
    const entry = readScanEntry(ROOT, rel);
    if (entry.status === 'unreadable') {
      hits.push({ file: rel, line: '?', text: '<unreadable file: cannot prove zero-python>' });
      continue;
    }
    if (entry.status === 'hit') {
      hits.push({ file: rel, line: entry.line, text: entry.text });
      continue;
    }
    if (entry.status === 'skipped') continue; // binary, or neutral dangling link
    hits = hits.concat(scanFileHits(rel, entry.content));
  }
  let allowText = '';
  try {
    allowText = readFileSync(join(ROOT, ALLOWLIST_REL), 'utf8');
  } catch {
    allowText = '';
  }
  const parsed = parseAllowlist(allowText);
  if (parsed.errors.length > 0) {
    console.error('check-no-python: malformed allowlist:');
    for (const e of parsed.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const { unexcused, problems, excused } = applyAllowlist(hits, parsed.entries);
  if (unexcused.length === 0 && problems.length === 0) {
    console.log(`✓ ZERO PYTHON OK (${excused} allowlisted hit(s), 0 unexcused)`);
    return;
  }
  if (unexcused.length > 0) {
    console.error(`check-no-python: invocations outside the allowlist (${ALLOWLIST_REL}):`);
    for (const h of unexcused) console.error(`  ${h.file}:${h.line}:${h.text}`);
  }
  for (const p of problems) console.error(`check-no-python: ${p}`);
  process.exit(1);
}

// Entry-point detection compares REAL paths: through a symlinked invocation
// `argv[1]` and the module URL differ textually while naming the same file,
// and a textual comparison would skip `main()` with a silent exit 0.
const invokedAsMain = (() => {
  try {
    if (process.argv[1] == null) return false;
    return realpathSync(resolve(process.cwd(), process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsMain) main();
