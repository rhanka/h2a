<script>
  import { SvelteFlow, Controls, Background, MarkerType } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import EcosystemNode from './EcosystemNode.svelte';
  import { interimLayout, renderDiagramViews } from './diagram-model.js';
  let { document, views = {}, dark = false, alt } = $props();
  const nodeTypes = { ecosystem: EcosystemNode };
  // The build embeds the DC-1 views. A payload without them (a store that keeps only the built
  // document) is drawn here by the same bundled DS renderers; a refusal shows its typed
  // diagnostics in the figure, never an empty node.
  let diagram = $derived.by(() => {
    const layout = interimLayout(document);
    if (layout.refusals.length) return { kind: 'refused', diagnostics: layout.refusals };
    const complete = Object.keys(document.entities).every(id => typeof views[id]?.svg === 'string');
    const outcome = complete ? { kind: 'rendered', views } : renderDiagramViews(document);
    if (outcome.kind !== 'rendered') return outcome;
    return { kind: 'rendered', nodes: layout.nodes.map(node => ({ ...node, data: { ...node.data, svg: outcome.views[node.id].svg } })) };
  });
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
  {#if diagram.kind === 'rendered'}
    <p class="canvas-hint">Déplacez le schéma et pincez pour zoomer, ou utilisez les boutons + et −.</p>
    <div class="canvas" data-renderer="xyflow-svelte" role="region" aria-label={`Schéma : ${alt}`}>
      <SvelteFlow nodes={diagram.nodes} {edges} {nodeTypes} fitView minZoom={0.15} maxZoom={2.5}
        zoomOnPinch={true} zoomOnScroll={false} panOnDrag={true} nodesDraggable={false}
        nodesConnectable={false} colorMode={dark ? 'dark' : 'light'}>
        <Controls showInteractive={false} />
        <Background gap={20} size={1} />
      </SvelteFlow>
    </div>
  {:else}
    <div class="diagram-refusal" role="alert">
      <p>Schéma non affiché : les cartes du design system refusent ce contenu.</p>
      <ul>{#each diagram.diagnostics as d}<li><code>{d.code}</code> {d.slot} {d.entityId} : {d.neededPx} px > {d.allocatedPx} px{d.text === undefined ? '' : ` « ${d.text} »`}</li>{/each}</ul>
    </div>
  {/if}
  <details><summary>Lire les relations du schéma</summary>
    <ul>{#each links as link}<li>{document.entities[endpoint(link, 'source')].attributes.name.value} → {document.entities[endpoint(link, 'target')].attributes.name.value}{link.attributes?.label ? ` : ${link.attributes.label.value}` : ''}</li>{/each}</ul>
  </details>
</figure>
