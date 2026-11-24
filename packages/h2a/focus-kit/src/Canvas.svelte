<script>
  import { renderR7Diagram } from './diagram-model.js';
  import { displayWidth, pickDiagramVariant } from './diagram-fit.js';
  let { document, diagram = null, alt, sectionId = 'diagram' } = $props();

  // The build embeds static offline r7 inline SVGs (`wide` + `narrow`). A payload without them
  // (e.g., a store keeping only the built document) renders the exact same r7 SVGs here using
  // the bundled pure DS card/zone painters; any card refusal surfaces its typed diagnostics.
  let rendered = $derived.by(() => {
    if (diagram && diagram.renderer === 'r7' && typeof diagram.wide?.svg === 'string' && typeof diagram.narrow?.svg === 'string') {
      return { kind: 'rendered', wide: diagram.wide, narrow: diagram.narrow };
    }
    return renderR7Diagram(document, { id: sectionId, alt });
  });

  // Room actually offered to the drawing; before the first measure, the page width is the estimate.
  let available = $state(0);
  let active = $derived(rendered.kind === 'rendered'
    ? pickDiagramVariant(available || globalThis.innerWidth || 0, rendered.wide.width) : 'narrow');

  let links = $derived(Object.values(document.relations).filter(r => r.type === 'link'));
  const endpoint = (relation, role) => relation.endpoints.find(e => e.role === role).target;
</script>

<figure class="ds-diagram-figure" aria-label={alt}>
  <figcaption>{alt}</figcaption>
  {#if rendered.kind === 'rendered'}
    <div class="ds-diagram-stage" data-renderer="r7" data-active={active} role="region" aria-label={`Schéma : ${alt}`}>
      <div class="ds-diagram-fit" bind:clientWidth={available}>
        <div class="ds-diagram-mount" data-variant="wide" style={`max-width: ${displayWidth('wide', rendered.wide.width)}px`}>{@html rendered.wide.svg}</div>
        <div class="ds-diagram-mount" data-variant="narrow" style={`max-width: ${displayWidth('narrow', rendered.narrow.width)}px`}>{@html rendered.narrow.svg}</div>
      </div>
    </div>
  {:else}
    <div class="diagram-refusal" role="alert">
      <p>Schéma non affiché : les cartes du design system refusent ce contenu.</p>
      <ul>{#each rendered.diagnostics as d}<li><code>{d.code}</code> {d.slot} {d.entityId} : {d.neededPx} px > {d.allocatedPx} px{d.text === undefined ? '' : ` « ${d.text} »`}</li>{/each}</ul>
    </div>
  {/if}
  <details><summary>Lire les relations du schéma</summary>
    <ul>{#each links as link}<li>{document.entities[endpoint(link, 'source')].attributes.name.value} → {document.entities[endpoint(link, 'target')].attributes.name.value}{link.attributes?.label ? ` : ${link.attributes.label.value}` : ''}</li>{/each}</ul>
  </details>
</figure>
