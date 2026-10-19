import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { E, setup, change, freeze } from './editing-fixture.js';
const require = createRequire(import.meta.url);
const rehash = (v: any) => ({ ...v, digest: E.returnDigest(v) });
describe('editing contract S/F/M boundaries', () => {
  it('should preserve exact JSON and YAML values and reject duplicate keys, tags, aliases and non-JSON scalars', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest, [change(doc, manifest)]);
    for (const format of ['json', 'yaml']) expect(E.decodeReturn(E.encodeReturn(value, format), format)).toEqual(value);
    for (const raw of ['a: 1\na: 2', 'a: !custom x', 'a: &a [*a]', 'a: .nan', 'a: !!timestamp 2026-01-01']) expect(() => E.decodeReturn(raw, 'yaml')).toThrow();
    expect(() => E.decodeReturn('{"a":1,"a":2}', 'json')).toThrow();
  });
  it('should enforce structural schema parity independently of semantic checks', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest, [change(doc, manifest)]);
    const Ajv = require('ajv/dist/2020.js');
    for (const [name, valid, check] of [['focus-edit-return', value, E.validateReturnStructure], ['focus-editing-manifest', manifest, E.validateManifestStructure]] as const) {
      const schema = JSON.parse(readFileSync(new URL(`../schemas/${name}.v1.schema.json`, import.meta.url), 'utf8'));
      const schemaCheck = new Ajv({ strict: false }).compile(schema);
      const invalids = [null, {}, { ...valid, schemaVersion: 2 }, { ...valid, approval: true }];
      for (const sample of [valid, ...invalids]) expect(check(sample), JSON.stringify(sample)).toEqual(schemaCheck(sample));
      expect(check(valid)).toBe(true); for (const sample of invalids) expect(check(sample)).toBe(false);
    }
  });
  it('should reject unknown keys even when their names shadow Object.prototype', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest, [change(doc, manifest)]);
    const Ajv = require('ajv/dist/2020.js'), validate = new Ajv({ strict: false }).compile(require('../schemas/focus-edit-return.v1.schema.json'));
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const v = JSON.parse(JSON.stringify(value).replace('"kind":', `${JSON.stringify(key)}:true,"kind":`));
      expect(validate(v)).toBe(false); expect(E.validateReturnStructure(v)).toBe(false);
    }
  });
  it('should reject every illegal operation/value combination in schema and runtime, keeping empty text distinct from null', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest, [change(doc, manifest)]);
    const Ajv = require('ajv/dist/2020.js'), schema = require('../schemas/focus-edit-return.v1.schema.json');
    const validate = new Ajv({ strict: false }).compile(schema);
    for (const operation of ['replace', 'insert', 'delete', 'move']) for (const before of [null, '', 'A']) for (const after of [null, '', 'B']) {
      const v = structuredClone(value), c = v.editReturn.transactions[0].changes[0];
      Object.assign(c, { operation, before, after, beforeAnchors: operation === 'insert' ? null : c.anchors });
      const expected = operation === 'insert' ? before === null && after !== null : operation === 'delete' ? before !== null && after === null : before !== null && after !== null;
      expect(E.validateReturnStructure(v)).toBe(expected); expect(validate(v)).toBe(expected);
    }
  });
  it('should reject semantic address mismatches, duplicate IDs, digest tampering and authority fields', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest, [change(doc, manifest)]);
    expect(E.validateReturn(value, doc, manifest).ok).toBe(true);
    for (const mutate of [
      (v: any) => { v.editReturn.transactions[0].changes[0].targetRef = 'question:q'; },
      (v: any) => { v.editReturn.transactions.push(v.editReturn.transactions[0]); },
      (v: any) => { v.editReturn.transactions[0].changes.push(v.editReturn.transactions[0].changes[0]); },
      (v: any) => { v.source.baseHash = 'sha256:' + '0'.repeat(64); },
      (v: any) => { v.editReturn.transactions[0].changes[0].approval = 'ratified'; },
      (v: any) => { v.schemaVersion = 100; },
    ]) { const v = structuredClone(value); mutate(v); expect(E.validateReturn(rehash(v), doc, manifest).ok).toBe(false); }
    const tampered = structuredClone(value); tampered.notes[0].text += 'x'; expect(E.validateReturn(tampered, doc, manifest).ok).toBe(false);
  });
  it('should resolve answer and note targets against their actual source nodes', () => {
    const { doc, manifest } = setup(), value = freeze(doc, manifest);
    for (const mutate of [
      (v: any) => { v.answers[0].targetRef = 'option:o'; },
      (v: any) => { v.answers[0].optionIds = ['q']; },
      (v: any) => { v.notes[0].targetRef = 'nonexistent'; },
    ]) { const v = structuredClone(value); mutate(v); expect(E.validateReturn(rehash(v), doc, manifest).ok).toBe(false); }
  });
  it('should transport complete ancestry and reject internally inconsistent lists at semantic boundaries', () => {
    const { doc, manifest } = setup(), r1 = freeze(doc, manifest), r2 = freeze(doc, manifest, [change(doc, manifest)], r1, 'R2');
    const r3 = freeze(doc, manifest, [], r2, 'R3');
    expect(r3.editReturn.supersededReturnIds).toEqual(['R2', 'R1']);
    expect(E.decodeReturn(E.encodeReturn(r3, 'json'), 'json')).toEqual(r3);
    for (const mutate of [
      (v: any) => { delete v.editReturn.supersededReturnIds; },
      (v: any) => { v.editReturn.supersededReturnIds = ['R2', 'R2']; },
      (v: any) => { v.editReturn.supersededReturnIds = ['R2', 'R3']; },
      (v: any) => { v.editReturn.supersededReturnIds = ['R1', 'R2']; },
      (v: any) => { v.editReturn.supersededReturnIds = []; },
      (v: any) => { delete v.editReturn.supersedesReturnId; },
    ]) { const v = structuredClone(r3); mutate(v); expect(E.validateReturn(rehash(v), doc, manifest).ok).toBe(false); }
  });
  it('should hash canonical values without normalization or self-reference and publish fixed manifest vectors', () => {
    const { doc, manifest } = setup();
    const { manifestBaseHash, ...projection } = manifest;
    expect(manifestBaseHash).toBe('sha256:' + createHash('sha256').update(E.canonicalJson(projection)).digest('hex'));
    expect(E.manifestDigest({ ...manifest, manifestBaseHash: null })).toBe(manifestBaseHash);
    expect(E.baseDigest(JSON.parse(JSON.stringify(doc, null, 4)))).toBe(E.baseDigest(doc));
    const altered = structuredClone(manifest); altered.paragraphs.reverse(); expect(E.manifestDigest(altered)).not.toBe(manifestBaseHash);
    expect(E.validateManifest({ ...manifest, manifestBaseHash: null }, doc).ok).toBe(false);
    expect(E.validateManifest({ ...manifest, transient: 'x' }, doc).ok).toBe(false);
    expect(() => E.canonicalJson({ x: NaN })).toThrow(); expect(() => E.canonicalJson({ x: '\ud800' })).toThrow();
  });
  it('should reproduce pinned manifest vectors in the browser bundle and Node consumer', () => {
    const { vectors } = require('./fixtures/editing-vectors.json');
    const { buildSync } = require('esbuild');
    const bundle = buildSync({ entryPoints: [new URL('../src/editing/index.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Editing' }).outputFiles[0].text;
    for (const vector of vectors) {
      expect(E.manifestDigest(vector.manifest)).toBe(vector.expectedManifestBaseHash);
      const source = `${bundle}\nEditing.manifestDigest(JSON.parse(${JSON.stringify(JSON.stringify(vector.manifest))}))`;
      expect(runInNewContext(source, { TextEncoder, structuredClone })).toBe(vector.expectedManifestBaseHash);
    }
  });
});
