import { svelte } from '@sveltejs/vite-plugin-svelte';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Vitest 4 bundles its own Vite major; the plugin types differ from the app Vite 8 types.
  plugins: [svelte({ preprocess: vitePreprocess({ style: false }) }) as never, svelteTesting() as never],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    dedupe: ['svelte', '@sentropic/design-system-svelte', '@sentropic/design-system-themes']
  },
  test: {
    environment: 'jsdom',
    include: ['src/lib/review/*.test.ts']
  }
});
