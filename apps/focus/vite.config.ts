import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Dedupe svelte + the DS packages so a single instance is bundled (avoids duplicate Svelte runtime /
  // duplicate DS theme context) — mirrors sentropic-ui.
  resolve: {
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  // Focus is shipped inside @sentropic/h2a. Bundle UI-only dependencies so the installed CLI needs only
  // its declared @sentropic/track runtime dependency, not the app's private build toolchain.
  ssr: {
    noExternal: ['@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  server: {
    port: 5178,
    host: true
  }
});
