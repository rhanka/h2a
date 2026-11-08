<script>
  import { Handle, Position } from '@xyflow/svelte';
  let { data } = $props();
</script>

<Handle type="target" position={Position.Top} />
<div class="ecosystem-svg">{@html data.svg}</div>
<Handle type="source" position={Position.Bottom} />
