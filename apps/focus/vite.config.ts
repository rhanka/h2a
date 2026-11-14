import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({
    // A real server is required for the /api/actions/launch POST endpoint.
    adapter: adapter(),
    alias: { '$lib': 'src/lib' },
    // The packaging build injects a deterministic source-derived version.
    version: { name: process.env.FOCUS_BUILD_VERSION ?? 'h2a-focus-dev' },
    // The design system ships scoped CSS and injects theme CSS as literal markup.
    // Disable host PostCSS preprocessing of those style blocks.
    preprocess: vitePreprocess({ style: false })
  })],
  // Dedupe svelte + the DS packages so a single instance is bundled (avoids duplicate Svelte runtime /
  // duplicate DS theme context) — mirrors sentropic-ui.
  resolve: {
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  // Focus is shipped inside @sentropic/h2a. Bundle UI-only dependencies so the installed CLI needs only
  // its declared @sentropic/track runtime dependency, not the app's private build toolchain.
  ssr: {
    noExternal: ['@sentropic/design-system-svelte', '@sentropic/design-system-themes', '@sentropic/track']
  },
  server: {
    port: 5178,
    host: true
  }
});
