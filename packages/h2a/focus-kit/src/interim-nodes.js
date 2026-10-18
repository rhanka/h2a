/** Disposable xyflow placement only. SemanticDocument carries no view or layout hints.
 * L-R1..L-R11 belong to the DS engine; this simple grid does not implement them. */
export function interimNodes(document) {
  const children = new Map([[undefined, []]]);
  const parents = new Map();
  for (const relation of Object.values(document.relations)) {
    if (relation.type !== 'contains') continue;
    const parent = relation.endpoints.find(e => e.role === 'parent').target;
    const child = relation.endpoints.find(e => e.role === 'child').target;
    parents.set(child, parent);
  }
  for (const entity of Object.values(document.entities)) {
    const parent = parents.get(entity.id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entity);
  }
  const nodes = [];
  function place(parentId) {
    const siblings = children.get(parentId) ?? [];
    let rowY = parentId ? 48 : 0, rowHeight = 0, x = parentId ? 24 : 0, width = 288;
    siblings.forEach((entity, i) => {
      const size = entity.type === 'container' ? place(entity.id) : { width: 240, height: 110 };
      if (i % 2 === 0 && i) { rowY += rowHeight + 50; x = parentId ? 24 : 0; rowHeight = 0; }
      nodes.push({ id: entity.id, type: 'ecosystem', position: { x, y: rowY },
        ...(parentId ? { parentId, extent: 'parent' } : {}),
        ...(entity.type === 'container' ? { style: `width: ${size.width}px; height: ${size.height}px;` } : {}),
        data: { label: entity.attributes.name.value, container: entity.type === 'container' },
      });
      x += size.width + 60;
      width = Math.max(width, x - 36);
      rowHeight = Math.max(rowHeight, size.height);
    });
    return { width, height: rowY + rowHeight + 24 };
  }
  place(undefined);
  // xyflow requires parent occurrences before their children.
  const depth = id => { let n = 0; for (; parents.has(id); id = parents.get(id)) n++; return n; };
  return nodes.sort((a, b) => depth(a.id) - depth(b.id));
}
