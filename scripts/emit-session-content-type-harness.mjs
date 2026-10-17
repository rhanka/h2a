import { readFileSync,readdirSync,writeFileSync } from 'node:fs';
const root=new URL('../packages/h2a-runtime/src/fixtures/session-content/v2/',import.meta.url);
const entries=readdirSync(root).filter(n=>n.endsWith('.v2.json')&&!n.includes('vectors')).sort().map(name=>JSON.parse(readFileSync(new URL(name,root),'utf8')));
const messages=Object.fromEntries(entries.map(value=>[value.kind,value]));
const source=`// Generated from pinned capsule JSON; compile with tsconfig.session-content-tests.json.\nimport type {ContentMessageMap} from './session-content-types.js';\ntype Immutable<T>=T extends object?{readonly [K in keyof T]:Immutable<T[K]>}:T;\nconst fixtures=${JSON.stringify(messages,null,2)} as const satisfies Immutable<ContentMessageMap>;\nvoid fixtures;\n`;
writeFileSync(new URL('../packages/h2a-runtime/src/session-content-fixture-types.typecheck.ts',import.meta.url),source);
console.log('Type harness emitted for '+entries.length+' exact message fixtures.');
