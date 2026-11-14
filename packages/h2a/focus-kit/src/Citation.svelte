<script module>
  import { SvelteMap } from 'svelte/reactivity';
  export const citationCallers = new SvelteMap();
</script>
<script>
  import { bibliography } from '../../../focus/src/render/evidence.ts';
  let { dossier, id } = $props();
  let entry = $derived(bibliography(dossier).find(e => e.citation.id === id));
</script>
<a class="citation-link" href={`#${entry.anchorId}`} aria-label={`Source ${entry.number}`}
  onclick={event => citationCallers.set(entry.anchorId, event.currentTarget)}>[{entry.number}]</a>
