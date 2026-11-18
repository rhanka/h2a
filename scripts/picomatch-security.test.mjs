import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// GHSA-fc5q-39xc-vjpf / CVE-2026-112366: upstream picomatch through 4.0.7 has
// no patched release (first_patched_version is null), so every locked tree
// that reaches picomatch through vite/vitest/tsup/tinyglobby pins the patched
// fork @ryotsu/picomatch@4.0.7-a through an npm alias override, the same
// pattern as the deepmerge override (scripts/deepmerge-security.test.mjs).
// Remove the overrides when upstream publishes a patched picomatch and the
// consumers accept it. These tests exercise the actual installed module in
// each tree: a silent revert to upstream picomatch must turn CI red, because
// `npm install` in a workspace root is known to drop this alias.

const TREES = ['.', 'apps/focus', 'packages/h2a/focus-kit'];

for (const tree of TREES) {
  const require = createRequire(new URL(`../${tree}/package.json`, import.meta.url));
  const picomatch = require('picomatch');
  const installed = require('picomatch/package.json');

  test(`${tree}: installs the patched picomatch fork, not upstream 4.0.7`, () => {
    assert.equal(installed.name, '@ryotsu/picomatch');
    assert.equal(installed.version, '4.0.7-a');
  });

  test(`${tree}: single-branch repeated extglobs cannot backtrack catastrophically`, () => {
    // Upstream 4.0.7 needs ~25 s for the first pattern at this length; the
    // patched fork collapses a repeated star branch and answers immediately.
    const subject = `${'a'.repeat(30)}!`;
    for (const pattern of ['+(*a)', '+(*?a)', '+(?*a)']) {
      const start = Date.now();
      assert.equal(picomatch.isMatch(subject, pattern), false, pattern);
      assert.ok(Date.now() - start < 5000, `${pattern} backtracked`);
    }
    assert.equal(picomatch.isMatch(subject, '+(*)'), true);
    assert.equal(picomatch.isMatch('aaa', '+(*a)'), true);
    assert.equal(picomatch.isMatch('abcabc', '+(abc)'), true);
  });

  test(`${tree}: glob behaviour the build and test tools rely on is preserved`, () => {
    assert.equal(picomatch.isMatch('src/index.ts', 'src/**/*.ts'), true);
    assert.equal(picomatch.isMatch('src/index.ts', 'src/**/*.js'), false);
    assert.equal(picomatch.isMatch('packages/h2a/test/a.test.js', '**/*.test.js'), true);
    assert.equal(picomatch.isMatch('a.js', '*.{js,ts}'), true);
    assert.equal(picomatch.isMatch('a.css', '*.{js,ts}'), false);
    assert.equal(picomatch.isMatch('file.ts', '@(file|other).ts'), true);
    assert.equal(picomatch.isMatch('.hidden/keep.js', '**/*.js', { dot: true }), true);
    assert.equal(picomatch.isMatch('foo/bar', 'foo/*'), true);
    assert.equal(picomatch.isMatch('foo/bar/baz', 'foo/*'), false);
  });
}
