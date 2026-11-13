<script>
  import { bibliography } from '../../../focus/src/render/evidence.ts';
  let { dossier, id } = $props();
  let entry = $derived(bibliography(dossier).find(e => e.citation.id === id));
</script>
<a class="citation-link" href={`#${entry.anchorId}`} aria-label={`Source ${entry.number}`}>[{entry.number}]</a>
