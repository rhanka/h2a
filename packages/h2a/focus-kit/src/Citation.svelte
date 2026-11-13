<script>
  let { dossier, id } = $props();
  let number = $derived(dossier.citations.findIndex(c => c.id === id) + 1);
</script>
<a class="citation-link" href={`#focus-source-${number}`} aria-label={`Source ${number}`}>[{number}]</a>
