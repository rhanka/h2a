<script>
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import SourceViewer from './SourceViewer.svelte';
  import { evidenceVolume } from '../../../focus/src/render/evidence.ts';
  let { dossier } = $props();
  let active = $state(null), locator = $state(null), opener, scroll;
  const expanded = new SvelteSet();
  const volume = $derived(evidenceVolume(dossier));
  export function openCitation(id) {
    const citation = dossier.citations.find(c => c.id === id);
    openSource(citation.sourceId, citation.locator);
  }
  function openSource(id, range = null) {
    if (!active) { opener = document.activeElement; scroll = window.scrollY; }
    locator = range; active = dossier.sources.find(s => s.id === id);
  }
  async function back() {
    active = null; locator = null; await tick();
    opener?.focus({ preventScroll: true }); window.scrollTo(0, scroll);
  }
</script>
<section aria-label="Pièces justificatives" class="evidence-index">
  <h2>Pièces justificatives</h2>
  <p>{volume.sources} sources · {volume.bytes} octets · consultation estimée : {volume.consultationMinutes} minute(s), à six octets par mot, hors budget de décision.</p>
  {#if active}{#key active.id}<SourceViewer source={active} {locator} onback={back} />{/key}{/if}
  <ul>{#each dossier.citations as citation}<li><button onclick={() => openCitation(citation.id)}>{citation.label}</button> — {citation.sourceId}</li>{/each}</ul>
  <details open><summary>Catalogue des sources</summary><ul>{#each dossier.sources as source}<li><button onclick={() => openSource(source.id)}>Consulter {source.title}</button> · {source.size} octets</li>{/each}</ul></details>
  {#each dossier.evidenceGroups as group}<article><p>{group.summary}</p>
    {#each group.citationRefs as id}<button onclick={() => openCitation(id)}>{dossier.citations.find(c => c.id === id).label}</button>{/each}
    {#each group.sourceRefs as id}<button onclick={() => openSource(id)}>Source : {dossier.sources.find(s => s.id === id).title}</button>{/each}
  </article>{/each}
  {#each dossier.annexes as annex}<details ontoggle={e => { if (e.currentTarget.open) expanded.add(annex.id); else expanded.delete(annex.id); }}><summary><span>{annex.title}</span> — {annex.summary}</summary>
    {#if expanded.has(annex.id)}
    {#each annex.blocks as block}
      {#if block.kind === 'text'}<p>{block.text}</p>
      {:else if block.kind === 'code'}<pre><code>{block.text}</code></pre>
      {:else if block.kind === 'table'}<div class="evidence-table"><table><thead><tr>{#each block.columns as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each block.rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody></table></div>
      {:else if block.kind === 'references'}{#each block.citationRefs as id}<button onclick={() => openCitation(id)}>{dossier.citations.find(c => c.id === id).label}</button>{/each}{/if}
    {/each}
    {#each annex.backRefs as id}<a href={`#${encodeURIComponent(id)}`}>Retour : {id}</a>{/each}
    {/if}
  </details>{/each}
</section>
