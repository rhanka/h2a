<script lang="ts">
  import '../app.css';
  import { ThemeProvider } from '@sentropic/design-system-svelte';
  import { entropicTheme } from '@sentropic/design-system-themes';

  let { children } = $props();
</script>

<!-- The whole app is wrapped ONCE in the entropic theme. ThemeProvider injects all `--st-*` tokens via an
     `{@html "<style>…"}` into <head> and scopes them under `[data-st-theme="entropic"]`. No CSS import. -->
<ThemeProvider theme={entropicTheme}>
  {@render children()}
</ThemeProvider>
