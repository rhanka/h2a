<script>
  import { onMount } from 'svelte';
  import { renderProcessTable, renderR7Diagram } from './diagram-model.js';
  import { displayWidth, pickDiagramVariant } from './diagram-fit.js';
  let { document, diagram = null, alt, sectionId = 'diagram', target = 'document' } = $props();

  let rendered = $derived.by(() => {
    if (diagram && diagram.renderer === 'r7' && typeof diagram.wide?.svg === 'string' && typeof diagram.narrow?.svg === 'string') {
      return {
        kind: 'rendered',
        profile: diagram.profile ?? document.profileRefs?.[0] ?? 'generic@1',
        wide: diagram.wide,
        narrow: diagram.narrow,
        ...(diagram.phone ? { phone: diagram.phone } : {}),
        ...(diagram.processTable ? { processTable: diagram.processTable } : {}),
      };
    }
    return renderR7Diagram(document, { id: sectionId, alt });
  });

  // Width offered by the parent section column; kept independent of symmetrical desktop breakout.
  let columnWidth = $state(0);
  let viewportWidth = $state(globalThis.innerWidth || 0);
  onMount(() => {
    const onResize = () => { viewportWidth = window.innerWidth; };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  let isProcess = $derived((document.profileRefs?.[0] ?? rendered?.profile) === 'process@1');
  let chromePx = $derived((columnWidth || viewportWidth) <= 600 ? 14 : 26);
  let baseRoom = $derived(Math.max(0, (columnWidth || viewportWidth) - chromePx));
  let wideDisplayPx = $derived(rendered.kind === 'rendered' ? displayWidth('wide', rendered.wide) : 0);
  let stageExtra = $derived.by(() => {
    if (rendered.kind !== 'rendered' || !isProcess || target !== 'document' || columnWidth < 800) return 0;
    if (wideDisplayPx <= baseRoom || viewportWidth < wideDisplayPx + chromePx + 32) return 0;
    return Math.ceil(wideDisplayPx - baseRoom);
  });
  let stageStyle = $derived(
    stageExtra > 0
      ? `width: calc(100% + ${stageExtra}px); margin-inline: -${Math.ceil(stageExtra / 2)}px;`
      : '',
  );
  let active = $derived(
    rendered.kind === 'rendered'
      ? pickDiagramVariant(baseRoom + stageExtra, rendered)
      : 'narrow',
  );
  let processTableHtml = $derived.by(() => {
    if (!isProcess) return '';
    if (rendered.kind === 'rendered' && typeof rendered.processTable === 'string') return rendered.processTable;
    return renderProcessTable(document);
  });

  let links = $derived(Object.values(document.relations ?? {}).filter((r) => r.type === 'link'));
  const endpoint = (relation, role) => relation.endpoints.find((e) => e.role === role).target;
</script>

<figure class="ds-diagram-figure" aria-label={alt} bind:clientWidth={columnWidth}>
  <figcaption>{alt}</figcaption>
  {#if rendered.kind === 'rendered'}
    <div
      class="ds-diagram-stage"
      data-renderer="r7"
      data-profile={isProcess ? 'process@1' : 'generic@1'}
      data-active={active}
      style={stageStyle}
      role="region"
      aria-label={`Schéma : ${alt}`}
    >
      <div class="ds-diagram-fit">
        <div class="ds-diagram-mount" data-variant="wide" style={`max-width: ${displayWidth('wide', rendered.wide)}px`}>{@html rendered.wide.svg}</div>
        <div class="ds-diagram-mount" data-variant="narrow" style={`max-width: ${displayWidth('narrow', rendered.narrow)}px`}>{@html rendered.narrow.svg}</div>
        {#if rendered.phone}
          <div class="ds-diagram-mount" data-variant="phone" style={`max-width: ${displayWidth('phone', rendered.phone)}px`}>{@html rendered.phone.svg}</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="diagram-refusal" role="alert">
      <p>Schéma non affiché : les cartes du design system refusent ce contenu.</p>
      <ul>{#each rendered.diagnostics as d}<li><code>{d.code}</code> {d.slot} {d.entityId} : {d.neededPx} px &gt; {d.allocatedPx} px{d.text === undefined ? '' : ` « ${d.text} »`}</li>{/each}</ul>
    </div>
  {/if}
  {#if isProcess}
    {@html processTableHtml}
  {:else}
    <details><summary>Lire les relations du schéma</summary>
      <ul>{#each links as link}<li>{document.entities[endpoint(link, 'source')].attributes.name.value} → {document.entities[endpoint(link, 'target')].attributes.name.value}{link.attributes?.label ? ` : ${link.attributes.label.value}` : ''}</li>{/each}</ul>
    </details>
  {/if}
</figure>
