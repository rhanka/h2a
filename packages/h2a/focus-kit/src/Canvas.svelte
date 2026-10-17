<script>
  import { SvelteFlow, Controls, Background, MarkerType } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import EcosystemNode from './EcosystemNode.svelte';
  let { scene, dark = false, alt } = $props();
  const nodeTypes = { ecosystem: EcosystemNode };
  let nodes = $derived(scene.nodes.map(n => ({ id: n.id, type: 'ecosystem', position: n.position, data: { label: n.label, detail: n.detail } })));
  let edges = $derived(scene.edges.map((e, i) => ({ ...e, id: `edge-${i}`, type: 'smoothstep',
    style: 'stroke: var(--st-semantic-border-strong); stroke-width: 1px;',
    labelStyle: 'fill: var(--st-semantic-text-primary); font-size: 12px;',
    labelBgStyle: 'fill: var(--st-semantic-surface-raised);',
    markerEnd: { type: MarkerType.ArrowClosed, color: dark ? '#94a3b8' : '#475569', width: 16, height: 16 },
  })));
</script>

<figure aria-label={alt}>
  <figcaption>{scene.title} — {alt}</figcaption>
  <p class="canvas-hint">Déplacez le schéma et pincez pour zoomer, ou utilisez les boutons + et −.</p>
  <div class="canvas" data-renderer="xyflow-svelte" role="region" aria-label={`Schéma : ${scene.title}`}>
    <SvelteFlow {nodes} {edges} {nodeTypes} fitView minZoom={0.15} maxZoom={2.5}
      zoomOnPinch={true} zoomOnScroll={false} panOnDrag={true} nodesDraggable={false}
      nodesConnectable={false} colorMode={dark ? 'dark' : 'light'}>
      <Controls showInteractive={false} />
      <Background gap={20} size={1} />
    </SvelteFlow>
  </div>
  <details><summary>Lire les relations du schéma</summary>
    <ul>{#each scene.edges as edge}<li>{scene.nodes.find(n => n.id === edge.source)?.label} → {scene.nodes.find(n => n.id === edge.target)?.label} : {edge.label}</li>{/each}</ul>
  </details>
</figure>
