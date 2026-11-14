import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Exercise the actual dependency consumed by each independently locked build.
for (const workspace of ['apps/focus', 'packages/h2a/focus-kit']) {
  const require = createRequire(new URL(`../${workspace}/package.json`, import.meta.url));
  const pluginRequire = createRequire(require.resolve('@sveltejs/vite-plugin-svelte'));
  const merge = pluginRequire('deepmerge');
  const payload = () => JSON.parse('{"__proto__":{"injected":true},"safe":true}');
  const check = (result) => {
    assert.equal(result.injected, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, '__proto__'), false);
    assert.equal(result.safe, true);
    assert.equal({}.injected, undefined);
  };

  test(`${workspace}: rejects prototype poisoning with a null-prototype target`, () => {
    check(merge(Object.create(null), payload()));
  });

  test(`${workspace}: rejects prototype poisoning from either operand`, () => {
    check(merge(payload(), {}));
    check(merge(payload(), payload()));
  });

  test(`${workspace}: rejects nested prototype poisoning and merge.all payloads`, () => {
    for (const value of [null, undefined, false, 0, '']) {
      check(merge({ nested: value }, { nested: payload() }).nested);
    }
    check(merge.all([{ nested: null }, { nested: payload() }]).nested);
    check(merge({ list: [] }, { list: [payload()] }).list[0]);
  });

  test(`${workspace}: never evaluates a forbidden getter`, () => {
    const value = { safe: true };
    Object.defineProperty(value, '__proto__', {
      enumerable: true,
      get() { assert.fail('forbidden getter evaluated'); },
    });
    check(merge(value, {}));
    check(merge(Object.create(null), value));
  });

  test(`${workspace}: preserves configuration merging and arrayMerge options`, () => {
    const left = { compilerOptions: { dev: false }, extensions: ['.svelte'] };
    const right = { compilerOptions: { css: 'external' }, extensions: ['.svx'] };
    assert.deepEqual(merge.all([left, right]), {
      compilerOptions: { dev: false, css: 'external' }, extensions: ['.svelte', '.svx'],
    });
    assert.deepEqual(merge(left, right, { arrayMerge: (_target, source) => source }).extensions, ['.svx']);
    assert.deepEqual(left, { compilerOptions: { dev: false }, extensions: ['.svelte'] });
  });
}
