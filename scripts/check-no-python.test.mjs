// Maintained tests for scripts/check-no-python.mjs (zero-python rule).
// Positive fixtures (must flag) and negative fixtures (must stay silent) for
// every case of the independent review: shebangs, py/-c, heredocs, absolute
// paths, versioned binaries, backticks/quoting, installer shims, prose and
// comment false positives, substring/multiplicity allowlist bypasses.
// Run: node --test scripts/check-no-python.test.mjs (also wired in CI).
// Uses temp dirs only; never touches real state or installed binaries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLIST_REL,
  applyAllowlist,
  classifyFile,
  isPyCommandWord,
  isPyPackageWord,
  isPythonImage,
  parseAllowlist,
  readScanEntry,
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
  'pip3.12 install foo',
  'uvx black .',
  'pypy script.py',
  'pypy3 script.py',
  'timeout 5 python3 -c "print(1)"',
  'timeout -s KILL 5 python3 -c "print(1)"',
  'nice python3 -c "print(1)"',
  'nice -n 5 python3 -c "print(1)"',
  'time python3 -c "print(1)"',
  'stdbuf -oL python3 -c "print(1)"',
  'sudo -u alice python3 -c "print(1)"',
  'sudo -E python3 -c "print(1)"',
  'env -i python3 -c "print(1)"',
  'env -u FOO python3 -c "print(1)"',
  'eval python3 -c "print(1)"',
  'eval "python3 -c print(1)"',
  'sh -c "python3 -c print(1)"',
  "bash -c 'python3 x.py'",
  'command -p python3 -c "print(1)"',
  'xargs -I{} python3 {}',
  'apk add --no-cache python3-dev',
  'apk add --no-cache py3-pip',
  'apt-get install -y python3-pip',
  'apt-get install -y python3.12',
  'brew install python@3.12',
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
  'sudo -u alice echo hi',
  'sh -c "echo hi"',
  'timeout 5 echo hi',
  'eval "echo hi"',
  'apt-get install -y curl git',
  'apk add make g++',
  'brew install node',
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
  for (const bang of ['#!/usr/bin/env pypy3', '#!/usr/bin/env pypy', '#!/usr/bin/env -S python3 -u']) {
    it(`flags ${bang}`, () => {
      assert.equal(scanFileHits('scripts/my-tool', `${bang}\nprint(1)\n`).length, 1);
    });
  }
  it('ignores a shell shebang', () => {
    assert.deepEqual(scanFileHits('x.sh', '#!/bin/sh\necho hi\n'), []);
  });
  it('ignores an env shell shebang', () => {
    assert.deepEqual(scanFileHits('x.sh', '#!/usr/bin/env bash\necho hi\n'), []);
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
  it('quoted workflow run scalars', () => {
    assert.equal(scanFileHits('w.yml', 'steps:\n  - run: "python3 -c x"\n').length, 1);
    assert.equal(scanFileHits('w.yml', "steps:\n  - run: 'python3 -c x'\n").length, 1);
    assert.deepEqual(scanFileHits('w.yml', 'steps:\n  - run: "echo hi"\n'), []);
  });
  it('workflow uses: referencing python', () => {
    assert.equal(scanFileHits('.github/workflows/w.yml', 'steps:\n  - uses: actions/setup-python@v5\n').length, 1);
    assert.deepEqual(scanFileHits('.github/workflows/w.yml', 'steps:\n  - uses: actions/checkout@v4\n'), []);
  });
  it('workflow shell: python', () => {
    assert.equal(scanFileHits('w.yml', 'steps:\n  - shell: python\n    run: print(1)\n').length, 1);
    assert.deepEqual(scanFileHits('w.yml', 'steps:\n  - shell: bash\n    run: echo hi\n'), []);
  });
  it('generic YAML command:/script: keys', () => {
    assert.equal(scanFileHits('deploy/d.yml', 'spec:\n  containers:\n  - command: ["python3","app.py"]\n').length, 1);
    assert.equal(scanFileHits('docker-compose.yml', 'services:\n  a:\n    command: python3 app.py\n').length, 1);
    assert.equal(scanFileHits('.gitlab-ci.yml', 'job:\n  script:\n    - python3 x.py\n').length, 1);
    assert.deepEqual(scanFileHits('docker-compose.yml', 'services:\n  a:\n    command: node app.js\n'), []);
  });
  it('Dockerfile FROM/CMD/ENTRYPOINT/ONBUILD/exec-JSON', () => {
    assert.equal(scanFileHits('Dockerfile', 'FROM python:3.12-alpine\n').length, 1);
    assert.deepEqual(scanFileHits('Dockerfile', 'FROM node:22-alpine\n'), []);
    assert.equal(scanFileHits('Dockerfile', 'FROM node:22\nCMD ["python3","app.py"]\n').length, 1);
    assert.deepEqual(scanFileHits('Dockerfile', 'FROM node:22\nCMD ["node","app.js"]\n'), []);
    assert.equal(scanFileHits('Dockerfile', 'FROM node:22\nCMD python3 app.py\n').length, 1);
    assert.equal(scanFileHits('Dockerfile', 'FROM node:22\nENTRYPOINT python3 app.py\n').length, 1);
    assert.equal(scanFileHits('Dockerfile', 'FROM node:22\nONBUILD RUN python3 x.py\n').length, 1);
    assert.equal(scanFileHits('Dockerfile', 'FROM node:22\nRUN ["python3","-c","x"]\n').length, 1);
  });
  it('Makefile and extensionless hooks are shell-scanned', () => {
    assert.equal(scanFileHits('Makefile', 'test:\n\tpython3 -m pytest\n').length, 1);
    assert.deepEqual(scanFileHits('Makefile', 'test:\n\tnpm test\n'), []);
    assert.equal(scanFileHits('.githooks/pre-commit', 'python3 -c "x"\n').length, 1);
    assert.deepEqual(scanFileHits('LICENSE', 'Permission is hereby granted.\n'), []);
  });
});

describe('JS sinks: aliases, bindings, tags', () => {
  it('spawn via a one-level variable binding', () => {
    const hits = scanFileHits('a.js', 'const c="python3";\nspawnSync(c,["-c","x"]);\n');
    assert.equal(hits.length, 1);
  });
  it('renamed execSync alias', () => {
    const hits = scanFileHits('a.js', 'const run=execSync;\nrun("python3 x.py");\n');
    assert.equal(hits.length, 1);
  });
  it('import-renamed sink alias', () => {
    const hits = scanFileHits('a.mjs', "import {execSync as ex} from 'node:child_process';\nex('python3 x.py');\n");
    assert.equal(hits.length, 1);
  });
  it('execa tagged template', () => {
    const hits = scanFileHits('a.mjs', 'await execa`python3 x.py`;\n');
    assert.equal(hits.length, 1);
  });
  it('clean alias call stays silent', () => {
    assert.deepEqual(scanFileHits('a.js', 'const run=execSync;\nrun("npm test");\n'), []);
  });
  it('unused python binding stays silent', () => {
    assert.deepEqual(scanFileHits('a.js', 'const c="python3";\nconsole.log("hi");\n'), []);
  });
});

describe('tracked python sources', () => {
  for (const rel of ['a.py', 'a.pyw', 'a.pyi', 'a.pyx', 'A.PY']) {
    it(`flags ${rel}`, () => {
      assert.equal(scanFileHits(rel, 'x = 1\n').length, 1);
    });
  }
});

describe('installer package names', () => {
  it('flags python-ish packages, ignores neutral ones', () => {
    for (const w of ['python3-dev', 'py3-pip', 'python3-pip', 'python@3.12', 'python3.12']) {
      assert.equal(isPyPackageWord(w), true, w);
    }
    for (const w of ['make', 'g++', 'curl', 'node', '-y', '--no-cache']) {
      assert.equal(isPyPackageWord(w), false, w);
    }
  });
});

describe('docker images', () => {
  it('flags python images, ignores neutral ones', () => {
    for (const r of ['python:3.12-alpine', 'registry.example/python-base:1', 'pypy:3']) {
      assert.equal(isPythonImage(r), true, r);
    }
    for (const r of ['node:22-alpine', '--platform=linux/amd64']) {
      assert.equal(isPythonImage(r), false, r);
    }
  });
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
    assert.equal(classifyFile('deploy/deployment.yaml', ''), 'workflow');
    assert.equal(classifyFile('Makefile', ''), 'shell');
    assert.equal(classifyFile('.githooks/pre-commit', ''), 'shell');
    assert.equal(classifyFile('x.sh', ''), 'shell');
    assert.equal(classifyFile('.githooks/commit-msg', '#!/usr/bin/env bash\n'), 'shell');
    assert.equal(classifyFile('a.ts', ''), 'js');
    assert.equal(classifyFile('docs/note.md', ''), null);
  });
});

describe('symlinks (CI dangling-link case)', () => {
  it('a dangling link with a neutral name is silent', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-link-'));
    try {
      symlinkSync('/nonexistent-target-xyz/4d257e5f.json', join(lab, 'odd.json'));
      assert.equal(readScanEntry(lab, 'odd.json').status, 'skipped');
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
  });
  it('a link NAMED like an interpreter is a hit even when dangling', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-link-'));
    try {
      symlinkSync('/nonexistent-target-xyz/real', join(lab, 'python3'));
      const e = readScanEntry(lab, 'python3');
      assert.equal(e.status, 'hit');
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
  });
  it('a link TARGETING an interpreter is a hit', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-link-'));
    try {
      symlinkSync('/usr/bin/python3', join(lab, 'tool'));
      assert.equal(readScanEntry(lab, 'tool').status, 'hit');
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
  });
  it('a readable link is content-scanned', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-link-'));
    try {
      writeFileSync(join(lab, 'real.sh'), '#!/bin/sh\npy -c "print(1)"\n');
      symlinkSync(join(lab, 'real.sh'), join(lab, 'link.sh'));
      const e = readScanEntry(lab, 'link.sh');
      assert.equal(e.status, 'content');
      assert.equal(scanFileHits('link.sh', e.content).length, 1);
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
  });
  it('command-word vocabulary stays exact', () => {
    for (const w of ['python', 'python3', 'python3.12', 'py', '/usr/bin/python3', 'pip', 'pip3']) {
      assert.equal(isPyCommandWord(w), true, w);
    }
    for (const w of ['check-no-python.sh', 'CPython', 'pipeline', 'node', 'tool', 'odd.json']) {
      assert.equal(isPyCommandWord(w), false, w);
    }
  });
});

describe('symlinked entry point runs the guard (no silent pass)', () => {
  it('node <symlink-to-guard> prints ZERO PYTHON OK', () => {
    const lab = mkdtempSync(join(tmpdir(), 'check-no-python-main-'));
    try {
      mkdirSync(join(lab, 'scripts'), { recursive: true });
      copyFileSync(join(HERE, 'check-no-python.mjs'), join(lab, 'scripts', 'check-no-python.mjs'));
      writeFileSync(join(lab, 'scripts', 'no-python-allowlist.txt'), '');
      writeFileSync(join(lab, 'clean.sh'), '#!/bin/sh\necho hi\n');
      spawnSync('git', ['-C', lab, 'init', '-q']);
      spawnSync('git', ['-C', lab, 'add', '-A']);
      symlinkSync(join(lab, 'scripts', 'check-no-python.mjs'), join(lab, 'scripts', 'link.mjs'));
      const r = spawnSync(process.execPath, [join(lab, 'scripts', 'link.mjs')], { encoding: 'utf8' });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /ZERO PYTHON OK/);
    } finally {
      rmSync(lab, { recursive: true, force: true });
    }
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
