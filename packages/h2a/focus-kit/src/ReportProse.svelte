<script>
  import { splitMarkdownTableCells as cells } from '../../../focus/src/render/markdown-table.ts';
  // Bounded Markdown tables/headings; every cell remains Svelte-escaped text.
  // Other prose is retained verbatim, including unsupported Markdown syntax.
  let { markdown } = $props();
  const blocks = $derived.by(() => {
    const lines = markdown.split(/\r?\n/), result = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '') && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c))) {
        const columns = cells(lines[i]), rows = []; i++;
        while (lines[i + 1]?.includes('|')) rows.push(cells(lines[++i]));
        result.push({ kind: 'table', columns, rows });
      } else if (/^#{1,6}\s+/.test(lines[i])) {
        result.push({ kind: 'heading', text: lines[i].replace(/^#+\s+/, '') });
      } else if (lines[i].trim()) {
        result.push({ kind: 'text', text: lines[i] });
      }
    }
    return result;
  });
</script>

{#each blocks as block}
  {#if block.kind === 'table'}
    <div class="evidence-table"><table><thead><tr>{#each block.columns as column}<th>{column}</th>{/each}</tr></thead>
      <tbody>{#each block.rows as row}<tr>{#each row as cell}<td>{cell}</td>{/each}</tr>{/each}</tbody>
    </table></div>
  {:else if block.kind === 'heading'}<h2>{block.text}</h2>
  {:else}<p class="prose">{block.text}</p>{/if}
{/each}
