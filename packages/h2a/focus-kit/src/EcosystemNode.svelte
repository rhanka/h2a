<script>
  import { Handle, Position } from '@xyflow/svelte';
  import { Card } from '@sentropic/design-system-svelte';
  let { data } = $props();
</script>

<Handle type="target" position={Position.Top} />
<Card class="ecosystem-node">
  <strong>{data.label}</strong>
  {#if data.detail}<p>{data.detail}</p>{/if}
</Card>
<Handle type="source" position={Position.Bottom} />
