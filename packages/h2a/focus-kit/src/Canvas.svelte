<script>
  import { SvelteFlow, Controls, Background, MarkerType } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import EcosystemNode from './EcosystemNode.svelte';
  import { interimNodes } from './interim-nodes.js';
  let { document, dark = false, alt } = $props();
  const nodeTypes = { ecosystem: EcosystemNode };
  let nodes = $derived(interimNodes(document));
  let links = $derived(Object.values(document.relations).filter(r => r.type === 'link'));
  const endpoint = (relation, role) => relation.endpoints.find(e => e.role === role).target;
  let edges = $derived(links.map(r => ({ id: r.id, source: endpoint(r, 'source'), target: endpoint(r, 'target'),
    label: r.attributes?.label?.value, type: 'smoothstep',
    style: 'stroke: var(--st-semantic-border-strong); stroke-width: 1px;',
    labelStyle: 'fill: var(--st-semantic-text-primary); font-size: 12px;',
    labelBgStyle: 'fill: var(--st-semantic-surface-raised);',
    markerEnd: { type: MarkerType.ArrowClosed, color: dark ? '#94a3b8' : '#475569', width: 16, height: 16 },
  })));
</script>

<figure aria-label={alt}>
  <figcaption>{alt}</figcaption>
  <p class="canvas-hint">Déplacez le schéma et pincez pour zoomer, ou utilisez les boutons + et −.</p>
  <div class="canvas" data-renderer="xyflow-svelte" role="region" aria-label={`Schéma : ${alt}`}>
    <SvelteFlow {nodes} {edges} {nodeTypes} fitView minZoom={0.15} maxZoom={2.5}
      zoomOnPinch={true} zoomOnScroll={false} panOnDrag={true} nodesDraggable={false}
      nodesConnectable={false} colorMode={dark ? 'dark' : 'light'}>
      <Controls showInteractive={false} />
      <Background gap={20} size={1} />
    </SvelteFlow>
  </div>
  <details><summary>Lire les relations du schéma</summary>
    <ul>{#each links as link}<li>{document.entities[endpoint(link, 'source')].attributes.name.value} → {document.entities[endpoint(link, 'target')].attributes.name.value}{link.attributes?.label ? ` : ${link.attributes.label.value}` : ''}</li>{/each}</ul>
  </details>
</figure>
