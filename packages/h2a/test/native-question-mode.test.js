import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMcpServer, runCli } from '../dist/index.js';
import { parseNativeToml } from '../dist/hosts/native-toml.js';
import { NATIVE_QUESTION_GUIDANCE } from '../dist/hosts/native-questions.js';

// Verified native tool names from the owner's 2026-10-17 study, not from
// production constants: a wrong mapping must fail the acceptance test.
const hosts = {
  claude: ['AskUserQuestion', '.claude'],
  codex: ['request_user_input', '.codex'],
  muse: ['request_user_input', '.config/muse', '.muse'],
  agy: ['ask_question', '.gemini'],
  gemini: ['ask_user', '.gemini'],
  vibe: ['ask_user_question', '.vibe']
};
const entrySkills = ['h2a', 'h2a-run', 'harness', 'harness-using-harness', 'present-decision'];

function assertGuidance(text, host, tool) {
  assert.ok(text.includes(NATIVE_QUESTION_GUIDANCE), 'shared guidance stays synchronized across entry points');
  assert.ok(text.includes(`| ${host} | \`${tool}\` |`), `${host}: exact native tool mapping`);
  assert.match(text, /current mode/);
  assert.match(text, /decision dossier with a diagram before/);
  assert.match(text, /never a bare text question/);
  assert.match(text, /leave the decision pending/);
  assert.match(text, /Do not change modes or permissions/);
}

function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'native-questions-'));
  const previous = { ...process.env };
  Object.assign(process.env, {
    HOME: dir, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', VIBE_HOME: '',
    XDG_RUNTIME_DIR: join(dir, 'runtime'), XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_STATE_HOME: join(dir, 'state'), H2A_ROOT: join(dir, 'bus')
  });
  fs.mkdirSync(process.env.XDG_RUNTIME_DIR);
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

for (const [host, [tool, userRoot, projectRoot = userRoot]] of Object.entries(hosts)) {
  for (const scope of ['user', 'project']) {
    test(`${host} ${scope} install delivers native questions and the decision boundary`, t => {
      const dir = fixture(t);
      let out = '', err = '';
      const code = runCli(['install-skills', '--host', host, '--scope', scope], {
        cwd: () => dir, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }
      });
      assert.equal(code, 0, err || out);
      const report = JSON.parse(out);
      const root = join(dir, scope === 'user' ? userRoot : projectRoot);
      const toml = host === 'gemini' || host === 'agy';
      for (const skill of entrySkills) {
        const path = toml ? join(root, 'commands', `${skill}.toml`) : join(root, 'skills', skill, 'SKILL.md');
        const bytes = fs.readFileSync(path, 'utf8');
        const prompt = toml ? parseNativeToml(bytes).prompt : bytes;
        if (skill === 'present-decision') {
          assert.match(prompt, /native question tool after a decision\s+dossier with a diagram/);
          const resource = toml ? prompt.match(/`([^`]*assets\/native-questions.md)`/)?.[1]
            : join(root, 'skills', skill, 'assets/native-questions.md');
          assert.ok(resource, 'decision skill links its native-question resource');
          assertGuidance(fs.readFileSync(resource, 'utf8'), host, tool);
        } else assertGuidance(prompt, host, tool);
      }
      assertGuidance(report.nativeQuestionHint, host, tool);
      if (host === 'agy') assert.match(report.importHint, /agy plugin import gemini/);
    });
  }
}

test('packaged plugin entry skills carry the same native-question guidance without installation', () => {
  for (const path of ['h2a/SKILL.md', 'h2a-run/SKILL.md', 'harness/SKILL.md', 'harness/using-harness/SKILL.md']) {
    const raw = fs.readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8');
    for (const [host, [tool]] of Object.entries(hosts)) assertGuidance(raw, host, tool);
  }
});

test('install output includes the native-question instruction for the selected host', t => {
  const dir = fixture(t);
  let out = '', err = '';
  assert.equal(runCli(['install-skills', '--host', 'claude'], {
    cwd: () => dir, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }
  }), 0, err);
  assert.equal(typeof JSON.parse(out).nativeQuestionHint, 'string');
  assertGuidance(JSON.parse(out).nativeQuestionHint, 'claude', 'AskUserQuestion');
});

test('MCP discovery explains native human questions at session, escalation and confirmation entry points', t => {
  const root = fixture(t);
  const tools = createMcpServer({ root }).listTools();
  for (const name of ['h2a_session_open', 'h2a_escalate', 'h2a_conductor_launch', 'h2a_run']) {
    const descriptor = tools.find(tool => tool.name === name);
    assert.ok(descriptor, name);
    for (const [host, [tool]] of Object.entries(hosts)) assertGuidance(descriptor.description, host, tool);
    assert.match(descriptor.description, /request_user_input_async/);
  }
});

for (const [host, base] of [['hermes', '.hermes'], ['opencode', '.config/opencode']]) {
  for (const scope of ['user', 'project']) {
    test(`${host} ${scope} install receives guidance without inventing an unverified native tool`, t => {
      const dir = fixture(t);
      let out = '', err = '';
      assert.equal(runCli(['install-skills', '--host', host, '--scope', scope], {
        cwd: () => dir, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } }
      }), 0, err);
      const root = join(dir, scope === 'project' ? `.${host}` : base, 'skills');
      for (const skill of entrySkills.filter(name => name !== 'present-decision')) {
        const text = fs.readFileSync(join(root, skill, 'SKILL.md'), 'utf8');
        assert.ok(text.includes(NATIVE_QUESTION_GUIDANCE));
        assert.match(text, /For other hosts, use their exposed native question tool without guessing its name/);
      }
      assertGuidance(fs.readFileSync(join(root, 'present-decision/assets/native-questions.md'), 'utf8'), 'claude', 'AskUserQuestion');
      assert.equal(JSON.parse(out).nativeQuestionHint, NATIVE_QUESTION_GUIDANCE);
    });
  }
}

test('shared agy and Gemini commands retain both tools without rewriting on the second install', t => {
  const root = fixture(t);
  const install = host => {
    let error = '';
    assert.equal(runCli(['install-skills', '--host', host], {
      cwd: () => root, stdout: { write() {} }, stderr: { write: s => { error += s; } }
    }), 0, error);
  };
  install('agy');
  const path = join(root, '.gemini/commands/h2a.toml');
  const bytes = fs.readFileSync(path), mtime = fs.statSync(path).mtimeMs;
  install('gemini');
  assert.deepEqual(fs.readFileSync(path), bytes);
  assert.equal(fs.statSync(path).mtimeMs, mtime);
  const prompt = parseNativeToml(bytes.toString()).prompt;
  assertGuidance(prompt, 'agy', 'ask_question');
  assertGuidance(prompt, 'gemini', 'ask_user');
});
