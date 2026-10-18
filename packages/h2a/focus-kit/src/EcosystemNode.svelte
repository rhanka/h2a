<script>
  import { Handle, Position } from '@xyflow/svelte';
  import { Card } from '@sentropic/design-system-svelte';
  let { data } = $props();
</script>

<Handle type="target" position={Position.Top} />
<Card class={data.container ? 'ecosystem-container' : 'ecosystem-node'}>
  <strong>{data.label}</strong>
</Card>
<Handle type="source" position={Position.Bottom} />
