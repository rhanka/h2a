<script>
  import { tick, onMount } from 'svelte';
  import { decodeEvidence, evidenceText, evidenceLines } from '../../../focus/src/validation/evidence-bytes.ts';
  import { searchSource } from './evidence-search.js';
  let { source, locator, visit, onback } = $props();
  let lines = $derived(source.mediaType.startsWith('image/') ? [] : evidenceLines(evidenceText(decodeEvidence(source.data))));
  let start = $state(0), jump = $state(1);
  let query = $state(''), matches = $state([]), searching = $state(false), serial = 0, matchIndex = $state(0);
  let scroller = $state(null), target = $state(null), heading, navigation = 0;
  onMount(() => heading.focus());
  const windowSize = 80, lineHeight = 24;
  async function go(line, focus = true) {
    const token = ++navigation;
    const n = Math.min(lines.length, Math.max(1, Number(line) || 1));
    start = Math.max(0, n - 9); jump = n;
    await tick(); if (token !== navigation) return;
    scroller.scrollTop = (n - 1) * lineHeight;
    await tick(); if (focus && token === navigation) {
      scroller.querySelector(`[data-line="${n}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      target?.focus({ preventScroll: true });
    }
  }
  // Reopening the same citation is a new navigation even if its locator is unchanged.
  $effect(() => { if (visit > 0 && lines.length) go(locator?.start ?? 1); });
  $effect(() => {
    const needle = query, input = lines, token = ++serial, location = navigation;
    matches = []; searching = true; matchIndex = 0;
    searchSource(input, needle, () => serial === token, found => {
      matches = found; searching = false;
      if (found.length && location === navigation) go(found[0], false);
    });
    return () => { serial++; };
  });
  function download() {
    const url = URL.createObjectURL(new Blob([decodeEvidence(source.data)], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = `evidence-${source.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section aria-label="Source consultée" class="source-viewer">
  <h3 tabindex="-1" bind:this={heading}>{source.title}</h3>
  <p>{source.mediaType} · {source.size} octets · {JSON.stringify(source.origin)}</p>
  <details><summary>Empreinte des octets</summary><code>{source.sha256}</code></details>
  <div class="evidence-actions">
    <button onclick={onback}>Retour au contexte</button>
    <button onclick={download}>Télécharger les octets originaux</button>
  </div>
  {#if source.mediaType.startsWith('image/')}
    <figure><img src={`data:${source.mediaType};base64,${source.data}`} alt={source.alt} width={source.width} height={source.height} /><figcaption>{locator?.caption ?? source.alt}</figcaption></figure>
  {:else}
    <label>Rechercher dans toute la source <input type="search" bind:value={query} /></label>
    <p aria-live="polite" data-search-status>{searching ? 'Recherche en cours…' : `${matches.length} résultat(s)`}</p>
    <button disabled={!matches.length} onclick={() => { matchIndex = (matchIndex + 1) % matches.length; go(matches[matchIndex]); }}>Résultat suivant</button>
    <label>Aller à la ligne <input type="number" min="1" max={lines.length} bind:value={jump} /></label>
    <button onclick={() => go(jump)}>Atteindre</button>
    <p>{lines.length} lignes · plage citée : {locator?.start ?? '—'}–{locator?.end ?? '—'}</p>
    <div class="source-scroll" bind:this={scroller} onscroll={() => { start = Math.max(0, Math.floor(scroller.scrollTop / lineHeight) - 8); }}>
      <div role="list" aria-label="Lignes de la source" tabindex="-1" bind:this={target}>
        <div aria-hidden="true" style={`height:${start * lineHeight}px`}></div>
        {#each lines.slice(start, start + windowSize) as line, offset}
          <div role="listitem" class="source-line" class:cited={start + offset + 1 >= locator?.start && start + offset + 1 <= locator?.end}
            data-line={start + offset + 1}><span class="line-number">{start + offset + 1}</span> {line || ' '}</div>
        {/each}
        <div aria-hidden="true" style={`height:${Math.max(0, lines.length - start - windowSize) * lineHeight}px`}></div>
      </div>
    </div>
  {/if}
</section>
