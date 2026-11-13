<script>
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import SourceViewer from './SourceViewer.svelte';
  import Citation from './Citation.svelte';
  import { evidenceVolume, bibliography } from '../../../focus/src/render/evidence.ts';
  import { decodeEvidence } from '../../../focus/src/validation/evidence-bytes.ts';
  let { dossier } = $props();
  let active = $state(null), locator = $state(null), visit = $state(0), opener, scroll;
  const expanded = new SvelteSet();
  const volume = $derived(evidenceVolume(dossier));
  function download(event, source) {
    event.preventDefault();
    const url = URL.createObjectURL(new Blob([decodeEvidence(source.data)], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = `evidence-${source.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openSource(id, range = null) {
    opener = document.activeElement; scroll = window.scrollY;
    locator = range ?? dossier.citations.find(c => c.sourceId === id)?.locator ?? null;
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
  <p>{volume.sources} sources · {volume.bytes} octets · consultation estimée : {volume.consultationMinutes} minute(s), à six octets par mot, hors budget {dossier.kind === 'report' ? 'de lecture principal' : 'de décision'}.</p>
  <section aria-label="Sources" class="bibliography">
    <h2>Sources</h2>
    <ol>{#each bibliography(dossier) as entry}<li id={`focus-source-${entry.number}`} tabindex="-1">
      {entry.citation.label} · {entry.source.title} · <span class="source-location">{entry.location}</span> ·
      <a href={`#focus-source-${entry.number}`} onclick={event => download(event, entry.source)}>Télécharger</a>
    </li>{/each}</ol>
  </section>
  <details open><summary>Catalogue des sources</summary><ul>{#each dossier.sources as source}<li><button onclick={() => openSource(source.id)}>Consulter {source.title}</button> · {source.size} octets</li>{/each}</ul></details>
  {#each dossier.evidenceGroups as group}<article><p>{group.summary}</p>
    {#each group.citationRefs as id}<Citation {dossier} {id} />{/each}
    {#each group.sourceRefs as id}<button onclick={() => openSource(id)}>Source : {dossier.sources.find(s => s.id === id).title}</button>{/each}
  </article>{/each}
  {#each dossier.annexes as annex}<details ontoggle={e => { if (e.currentTarget.open) expanded.add(annex.id); else expanded.delete(annex.id); }}><summary><span>{annex.title}</span> — {annex.summary}</summary>
    {#if expanded.has(annex.id)}
    {#each annex.blocks as block}
      {#if block.kind === 'text'}<p>{block.text}</p>
      {:else if block.kind === 'code'}<pre><code>{block.text}</code></pre>
      {:else if block.kind === 'table'}<div class="evidence-table"><table><thead><tr>{#each block.columns as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each block.rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody></table></div>
      {:else if block.kind === 'references'}{#each block.citationRefs as id}<Citation {dossier} {id} />{/each}{/if}
    {/each}
    {#each annex.backRefs as id}<button onclick={() => returnTo(id)}>Retour : {referenceTarget(id).label}</button>{/each}
    {/if}
  </details>{/each}
  {#if active}{#key active.id}<SourceViewer source={active} {locator} {visit} onback={back} />{/key}{/if}
</section>
