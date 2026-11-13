import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { diagramAdapter } from '../diagram-adapter.js';

test('all application templates compile as Vapor without handwritten render functions', () => {
  for (const filename of ['App.vue', 'Canvas.vue', 'Evidence.vue', 'SourceViewer.vue']) {
    const source = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    const { descriptor, errors } = parse(source, { filename });
    assert.deepEqual(errors, []); assert.equal(descriptor.vapor, true);
    assert.doesNotMatch(source, /\bh\s*\(|v-html/);
    const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true });
    assert.match(compiled.content, /__vapor: true/);
  }
});

test('generic projection retains names, type kickers, containment and exact semantic bytes', () => {
  const dossier = JSON.parse(readFileSync(new URL('../../test/fixtures/renderer-parity/decision.prepared.json', import.meta.url)));
  const scene = dossier.sections.find(s => s.kind === 'diagram').scene;
  scene.entities['entity:writer'].type = 'container';
  scene.relations['relation:contains'] = { id: 'relation:contains', profile: 'generic@1', type: 'contains', attributes: {},
    endpoints: [{ role: 'parent', target: 'entity:writer' }, { role: 'child', target: 'entity:reader' }] };
  const before = JSON.stringify(scene), result = diagramAdapter(scene);
  assert.equal(JSON.stringify(scene), before);
  assert.deepEqual(result.presentation.entities['occurrence:e.writer'], { form: 'container', text: { title: 'Rédaction', kicker: 'container' } });
  assert.deepEqual(result.presentation.entities['occurrence:e.reader'], { form: 'card', text: { title: 'Lecture', kicker: 'node' } });
  assert.throws(() => diagramAdapter({ ...scene, profileRefs: ['erd@1'] }), /Unsupported/);
  scene.relations['relation:contains'].endpoints[1].target = 'entity:writer';
  assert.throws(() => diagramAdapter(scene), /Unsupported/);
});
