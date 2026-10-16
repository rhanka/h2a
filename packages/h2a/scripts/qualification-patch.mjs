// Apply only the native public-history JSON patch dialect; never execute text.
export function patchNativeHistory(entry, operations) {
  let value = structuredClone(entry);
  for (const operation of operations) {
    if (!['add', 'replace', 'append', 'remove', 'test'].includes(operation.op)) throw new Error('unsupported native patch');
    const keys = operation.path.split('/').slice(1).map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('unsafe native patch');
    if (!keys.length) { if (operation.op !== 'replace') throw new Error('unsupported root patch'); value = operation.value; continue; }
    const last = keys.pop(), parent = keys.reduce((object, key) => object?.[key], value);
    if (!parent || typeof parent !== 'object') throw new Error('native patch target missing');
    if (operation.op === 'remove') { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
    else if (operation.op === 'test') { if (JSON.stringify(parent[last]) !== JSON.stringify(operation.value)) throw new Error('native patch mismatch'); }
    else if (operation.op === 'append') {
      if (typeof parent[last] === 'string') parent[last] += operation.value;
      else if (Array.isArray(parent[last])) parent[last].push(...operation.value);
      else throw new Error('unsupported native append');
    } else parent[last] = structuredClone(operation.value);
  }
  if (value.id !== entry.id || value.sessionId !== entry.sessionId) throw new Error('native patch identity changed');
  return value;
}
