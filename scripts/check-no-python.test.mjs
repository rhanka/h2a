// Maintained tests for scripts/check-no-python.mjs (zero-python rule).
// Positive fixtures (must flag) and negative fixtures (must stay silent) for
// every case of the independent review: shebangs, py/-c, heredocs, absolute
// paths, versioned binaries, backticks/quoting, installer shims, prose and
// comment false positives, substring/multiplicity allowlist bypasses.
// Run: node --test scripts/check-no-python.test.mjs (also wired in CI).
// Uses temp dirs only; never touches real state or installed binaries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST_REL,
  applyAllowlist,
  classifyFile,
  parseAllowlist,
  scanFileHits,
  scanShellSnippet,
} from './check-no-python.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SHELL_POS = [
  'python -c "print(1)"',
  'python3 -c "print(1)"',
  'python3 <<PY',
  'python3 - <<PY',
  'py -c "print(1)"',
  'py -3 -c "print(1)"',
  'py - <<PY',
  '/usr/bin/python3 -c "print(1)"',
  '/bin/python -c "print(1)"',
  'python3.12 -c "print(1)"',
  'python2 -c "print(1)"',
  'x=`python3 -c "print(1)"`',
  'x=$(python3 -c "print(1)")',
  '"python3" -c "print(1)"',
  "'python3' -c 'print(1)'",
  '\\python3 -c "print(1)"',
  'uv run ruff check',
  'pipx run black .',
  'pipx install foo',
  'poetry run pytest',
  'pip install -r requirements.txt',
  'pip3 install foo',
  'apk add --no-cache python3 make g++',
  'sudo python3 -c "print(1)"',
  'python3',
  'echo ok && python3 -c "print(1)"',
  'echo ok; py -c "print(1)"',
  'if python3 -c "print(1)"; then echo ok; fi',
];

const SHELL_NEG = [
  '# was python3 -c (full-line comment)',
  'echo "python3 was invoked (forbidden)"',
  'printf "%s\\necho CALLED\\n" "x" > "$lab/bin/python3"',
  'bash scripts/check-no-python.sh',
  'node scripts/check-no-python.mjs',
  'echo pipeline ready',
  'CPython',
  'node script.py',
  'curl -fsSL https://example.invalid/foo.py -o foo.py',
  'VAR=python3',
  'export PATH=/usr/bin:/bin',
  'echo "use uv run instead" | cat',
];

describe('shell snippets: positives flag, negatives stay silent', () => {
  for (const src of SHELL_POS) {
    it(`flags ${JSON.stringify(src)}`, () => {
      assert.equal(scanShellSnippet(src), true, src);
    });
  }
  for (const src of SHELL_NEG) {
    it(`ignores ${JSON.stringify(src)}`, () => {
      // Full-line comments are dropped by the caller; the snippet alone must
      // still not match (trailing-comment cut included).
      assert.equal(scanShellSnippet(src), false, src);
    });
  }
});

describe('shebangs (every tracked file)', () => {
  for (const bang of ['#!/usr/bin/env python3', '#!/usr/bin/python3', '#!/usr/bin/python']) {
    it(`flags ${bang}`, () => {
      assert.equal(scanFileHits('scripts/my-tool', `${bang}\nprint(1)\n`).length, 1);
    });
  }
  it('ignores a shell shebang', () => {
    assert.deepEqual(scanFileHits('x.sh', '#!/bin/sh\necho hi\n'), []);
  });
  it('ignores a full-line comment mentioning an invocation', () => {
    assert.deepEqual(scanFileHits('x.sh', '# was python3 -c\n'), []);
  });
  it('flags a python shebang even on a prose extension (executable bit rules)', () => {
    assert.equal(scanFileHits('docs/note.md', '#!/usr/bin/env python3\ntext\n').length, 1);
  });
});

describe('prose and data are silent', () => {
  it('markdown prose with bare words', () => {
    assert.deepEqual(
      scanFileHits('docs/note.md', 'Nous avons remplace python3 par node dans tous les scripts.\n'),
      [],
    );
  });
  it('JS line comment', () => {
    assert.deepEqual(scanFileHits('a.js', '// Do not use python3 in this module\nconst a = 1;\n'), []);
  });
  it('JS block comment', () => {
    assert.deepEqual(scanFileHits('a.ts', '/* python3 -c "x" */\nconst a = 1;\n'), []);
  });
  it('JS data string outside any spawn call', () => {
    assert.deepEqual(scanFileHits('a.js', 'const msg = "aucun appel a python dans ce depot";\n'), []);
  });
  it('JS canary array (no process sink)', () => {
    assert.deepEqual(
      scanFileHits('t.js', 'for (const name of ["python3", "h2a"]) writeFileSync(join(bin, name), "x");\n'),
      [],
    );
  });
  it('JS vendor data list', () => {
    assert.deepEqual(scanFileHits('v.js', 'export const LANGS = [\n    "python",\n    "ruby",\n];\n'), []);
  });
  it('JS non-sink call carrying a shim spec', () => {
    assert.deepEqual(
      scanFileHits('t.js', 'buildInstallCommand({ spec: "pipx install foo" });\n'),
      [],
    );
  });
  it('JS clean spawn stays silent', () => {
    assert.deepEqual(
      scanFileHits('s.mjs', 'import { spawnSync } from "node:child_process";\nspawnSync("bash", ["x.sh"]);\n'),
      [],
    );
  });
  it('lockfiles are not package scripts', () => {
    assert.deepEqual(
      scanFileHits('package-lock.json', '{"description":"needs python3 to build"}\n'),
      [],
    );
  });
});

describe('JS process sinks flag', () => {
  it('spawnSync with interpreter first arg', () => {
    const hits = scanFileHits('a.js', 'const r = spawnSync("python3", ["-c", "x"]);\n');
    assert.equal(hits.length, 1);
  });
  it('exec with a shell command string', () => {
    const hits = scanFileHits('a.js', 'exec("python3 script.py");\n');
    assert.equal(hits.length, 1);
  });
  it('execFile with the launcher', () => {
    const hits = scanFileHits('a.mjs', "execFile('py', ['-c', 'x']);\n");
    assert.equal(hits.length, 1);
  });
  it('backtick command in execSync', () => {
    const hits = scanFileHits('a.js', 'execSync(`python3 --version`);\n');
    assert.equal(hits.length, 1);
  });
  it('multiline spawn still matches', () => {
    const hits = scanFileHits('a.js', 'spawnSync(\n  "python3",\n  ["-c"],\n);\n');
    assert.equal(hits.length, 1);
  });
  it('clean exec string stays silent', () => {
    assert.deepEqual(scanFileHits('a.js', 'execSync("npm run build");\n'), []);
  });
});

describe('workflows, Dockerfiles, package scripts', () => {
  it('inline workflow run step', () => {
    const hits = scanFileHits('w.yml', 'jobs:\n  t:\n    steps:\n      - run: python3 -c "print(1)"\n');
    assert.equal(hits.length, 1);
  });
  it('block workflow run step', () => {
    const hits = scanFileHits('w.yml', 'steps:\n  - run: |\n      py -c "print(1)"\n');
    assert.equal(hits.length, 1);
  });
  it('workflow prose (names) is ignored', () => {
    assert.deepEqual(scanFileHits('w.yml', 'name: check python3 compat\non: push\n'), []);
  });
  it(' rerun-like keys are not run steps', () => {
    assert.deepEqual(scanFileHits('w.yml', 'jobs:\n  t:\n    rerun: python3\n'), []);
  });
  it('Dockerfile RUN with installer', () => {
    const hits = scanFileHits('Dockerfile', 'FROM x\nRUN apk add --no-cache python3 make g++\n');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].text, 'RUN apk add --no-cache python3 make g++');
  });
  it('Dockerfile comments and COPY stay silent', () => {
    assert.deepEqual(scanFileHits('Dockerfile', '# needs python3 at build\nFROM x\nCOPY r.txt .\n'), []);
  });
  it('package.json script invoking the interpreter', () => {
    const hits = scanFileHits('p/package.json', '{"scripts":{"test":"python3 run.py"}}\n');
    assert.equal(hits.length, 1);
  });
  it('package.json with clean scripts', () => {
    assert.deepEqual(scanFileHits('package.json', '{"scripts":{"test":"node --test"}}\n'), []);
  });
  it('unparseable package.json fails closed', () => {
    assert.equal(scanFileHits('package.json', '{oops\n').length, 1);
  });
});

describe('tracked python sources', () => {
  for (const rel of ['a.py', 'a.pyw', 'a.pyi', 'a.pyx']) {
    it(`flags ${rel}`, () => {
      assert.equal(scanFileHits(rel, 'x = 1\n').length, 1);
    });
  }
});

describe('allowlist: exact lines with expected counts', () => {
  it('parses FILE|LINE|COUNT and defaults COUNT to 1', () => {
    const { entries, errors } = parseAllowlist('Dockerfile|RUN apk add --no-cache python3 make g++|1\nA|B\n');
    assert.deepEqual(errors, []);
    assert.deepEqual(entries.map((e) => [e.file, e.text, e.expected]), [
      ['Dockerfile', 'RUN apk add --no-cache python3 make g++', 1],
      ['A', 'B', 1],
    ]);
  });
  it('rejects malformed rows', () => {
    for (const bad of ['no-pipe-here\n', '|x|1\n', 'a|b|0\n', 'a|b|nope\n', 'a|b|c|d\n']) {
      const { errors } = parseAllowlist(bad);
      assert.ok(errors.length > 0, bad);
    }
  });
  it('excuses the exact Dockerfile line', () => {
    const { entries } = parseAllowlist('Dockerfile|RUN apk add --no-cache python3 make g++|1\n');
    const r = applyAllowlist(
      [{ file: 'Dockerfile', line: 20, text: 'RUN apk add --no-cache python3 make g++' }],
      entries,
    );
    assert.deepEqual(r.unexcused, []);
    assert.deepEqual(r.problems, []);
    assert.equal(r.excused, 1);
  });
  it('a substring prefix does NOT excuse (old bypass)', () => {
    const { entries } = parseAllowlist('Dockerfile|apk add --no-cache python3 make g++|1\n');
    const r = applyAllowlist(
      [{ file: 'Dockerfile', line: 20, text: 'RUN apk add --no-cache python3 make g++' }],
      entries,
    );
    assert.equal(r.unexcused.length, 1);
    assert.equal(r.problems.length, 1); // stale entry
  });
  it('an injected suffix on the allowlisted line is unexcused', () => {
    const { entries } = parseAllowlist('Dockerfile|RUN apk add --no-cache python3 make g++|1\n');
    const r = applyAllowlist(
      [{
        file: 'Dockerfile',
        line: 20,
        text: 'RUN apk add --no-cache python3 make g++ && python3 -c "import os"',
      }],
      entries,
    );
    assert.equal(r.unexcused.length, 1);
    assert.equal(r.problems.length, 1); // entry now stale too
  });
  it('a duplicated allowlisted line breaks the expected count', () => {
    const { entries } = parseAllowlist('Dockerfile|RUN apk add --no-cache python3 make g++|1\n');
    const hit = { file: 'Dockerfile', line: 20, text: 'RUN apk add --no-cache python3 make g++' };
    const r = applyAllowlist([hit, { ...hit, line: 21 }], entries);
    assert.deepEqual(r.unexcused, []);
    assert.equal(r.problems.length, 1);
  });
  it('the shipped allowlist parses with one entry', () => {
    const text = readFileSync(join(ROOT, ALLOWLIST_REL), 'utf8');
    const { entries, errors } = parseAllowlist(text);
    assert.deepEqual(errors, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].expected, 1);
  });
});

describe('classifier', () => {
  it('routes names to the right scanner', () => {
    assert.equal(classifyFile('Dockerfile', ''), 'docker');
    assert.equal(classifyFile('a/Dockerfile.arm64', ''), 'docker');
    assert.equal(classifyFile('package.json', ''), 'pkgjson');
    assert.notEqual(classifyFile('package-lock.json', ''), 'pkgjson');
    assert.equal(classifyFile('.github/workflows/ci.yml', ''), 'workflow');
    assert.equal(classifyFile('x.sh', ''), 'shell');
    assert.equal(classifyFile('.githooks/commit-msg', '#!/usr/bin/env bash\n'), 'shell');
    assert.equal(classifyFile('a.ts', ''), 'js');
    assert.equal(classifyFile('docs/note.md', ''), null);
  });
});

describe('real files in a temp dir', () => {
  it('one dirty shell file among clean neighbours yields one hit', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-'));
    try {
      writeFileSync(join(lab, 'clean.sh'), '#!/bin/sh\necho "python3 was invoked"\n');
      writeFileSync(join(lab, 'dirty.sh'), '#!/bin/sh\npy -c "print(1)"\n');
      writeFileSync(join(lab, 'note.md'), 'remplace python3 par node\n');
      const hits = [];
      for (const f of ['clean.sh', 'dirty.sh', 'note.md']) {
        for (const h of scanFileHits(f, readFileSync(join(lab, f), 'utf8'))) hits.push(h);
      }
      assert.equal(hits.length, 1);
      assert.equal(hits[0].file, 'dirty.sh');
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
  });
});
