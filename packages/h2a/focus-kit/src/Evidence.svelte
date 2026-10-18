<script>
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import SourceViewer from './SourceViewer.svelte';
  import { evidenceVolume } from '../../../focus/src/render/evidence.ts';
  let { dossier } = $props();
  let active = $state(null), locator = $state(null), visit = $state(0), opener, scroll;
  const expanded = new SvelteSet();
  const volume = $derived(evidenceVolume(dossier));
  export function openCitation(id) {
    const citation = dossier.citations.find(c => c.id === id);
    openSource(citation.sourceId, citation.locator);
  }
  function openSource(id, range = null) {
    opener = document.activeElement; scroll = window.scrollY;
    locator = range;
    if (active?.id !== id) active = dossier.sources.find(s => s.id === id);
    visit++;
  }
  async function back() {
    active = null; locator = null; await tick();
    opener?.focus({ preventScroll: true }); window.scrollTo(0, scroll);
  }
  function referenceTarget(ref) {
    if (ref === dossier.ref) return { id: null, label: 'dossier' };
    for (const section of dossier.sections) {
      const option = section.kind === 'optionSet' && section.options.find(o => o.id === ref || o.targetRef === ref);
      if (option) return { id: option.id, label: option.label };
      if (section.id === ref || section.targetRef === ref) return { id: section.id,
        label: section.question ?? section.title ?? section.alt ?? (section.kind === 'outcome' ? 'Conclusion' : section.kind === 'amendmentTrace' ? 'Historique' : 'Contexte') };
    }
  }
  function returnTo(ref) {
    const target = referenceTarget(ref), element = target?.id === null ? document.querySelector('main')
      : [...document.querySelectorAll('main .dossier-section, main .option-card')].find(el => el.id === target?.id);
    if (!element) throw new Error(`Unresolved annex back reference: ${ref}`);
    if (!element.matches('button, a, input')) element.tabIndex = -1;
    element.focus(); element.scrollIntoView({ block: 'start' });
  }
</script>
<section aria-label="Pièces justificatives" class="evidence-index">
  <h2>Pièces justificatives</h2>
  <p>{volume.sources} sources · {volume.bytes} octets · consultation estimée : {volume.consultationMinutes} minute(s), à six octets par mot, hors budget de décision.</p>
  {#if active}{#key active.id}<SourceViewer source={active} {locator} {visit} onback={back} />{/key}{/if}
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
    {#each annex.backRefs as id}<button onclick={() => returnTo(id)}>Retour : {referenceTarget(id).label}</button>{/each}
    {/if}
  </details>{/each}
</section>
