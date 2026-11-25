import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { diagramAdapter } from '../diagram-adapter.js';

test('all application templates compile as Vapor without handwritten render functions', () => {
  for (const filename of ['App.vue', 'Canvas.vue', 'Citation.vue', 'Evidence.vue', 'SourceViewer.vue']) {
    const source = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    const { descriptor, errors } = parse(source, { filename });
    assert.deepEqual(errors, []); assert.equal(descriptor.vapor, true);
    assert.doesNotMatch(source, /\bh\s*\(|v-html/);
    const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true });
    assert.match(compiled.content, /__vapor: true/);
  }
});

test('generic and process projections validate bounded semantics without mutating input', () => {
  const genericScene = JSON.parse(readFileSync(new URL('../../../../focus/tests/diagram-core-generic.fixture.json', import.meta.url)));
  const beforeGeneric = JSON.stringify(genericScene);
  const genericResult = diagramAdapter(genericScene);
  assert.equal(JSON.stringify(genericScene), beforeGeneric);
  assert.deepEqual(genericResult.presentation.entities['occurrence:e.root'], { form: 'container', text: { title: 'Services', kicker: 'container' } });
  assert.deepEqual(genericResult.presentation.entities['occurrence:e.gateway'], { form: 'card', text: { title: 'Relais de modèles', kicker: 'node' } });

  const processScene = {
    documentId: 'document:proc',
    schemaVersion: { major: 1, minor: 1 },
    revision: 0,
    profileRefs: ['process@1'],
    typeDefinitions: {},
    entities: {
      'entity:a': { id: 'entity:a', profile: 'process@1', type: 'step', attributes: { name: { kind: 'text', value: 'Réception' } } },
      'entity:b': { id: 'entity:b', profile: 'process@1', type: 'step', attributes: { name: { kind: 'text', value: 'Archive' } } },
    },
    relations: {
      'relation:a.b': {
        id: 'relation:a.b',
        profile: 'process@1',
        type: 'transition',
        endpoints: [{ role: 'source', target: 'entity:a' }, { role: 'target', target: 'entity:b' }],
        attributes: { label: { kind: 'text', value: 'suite' } },
      },
    },
    ports: {},
    resources: {},
    extensions: [],
  };
  const beforeProcess = JSON.stringify(processScene);
  const processResult = diagramAdapter(processScene);
  assert.equal(JSON.stringify(processScene), beforeProcess);
  assert.deepEqual(processResult.presentation.entities, {});

  assert.throws(() => diagramAdapter({ ...genericScene, profileRefs: ['erd@1'] }), /Unsupported/);
  genericScene.relations['relation:root-coordinator'].endpoints[1].target = 'entity:root';
  assert.throws(() => diagramAdapter(genericScene), /Unsupported/);
});
