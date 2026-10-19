import { readFileSync, writeFileSync } from 'node:fs';
import { manifestSchema, returnSchema } from '../dist/editing/structure.js';
for (const [name, schema] of [['focus-editing-manifest', manifestSchema], ['focus-edit-return', returnSchema]]) {
  const path = new URL(`../schemas/${name}.v1.schema.json`, import.meta.url), bytes = JSON.stringify(schema, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== bytes) throw new Error(`${name}: schema drift`);
  } else writeFileSync(path, bytes);
}
