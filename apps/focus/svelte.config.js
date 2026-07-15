import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // adapter-node: we need a real server at runtime for the /api/actions/launch endpoint
    // (adapter-static/SPA cannot serve +server.ts POST handlers).
    adapter: adapter(),
    // The h2a packaging build injects a deterministic source-derived version. It stays reproducible while
    // still changing across deployments so open browsers can recover from replaced hashed chunks.
    version: { name: process.env.FOCUS_BUILD_VERSION ?? 'h2a-focus-dev' }
  },
  // `style: false` mirrors sentropic-ui: it disables host PostCSS preprocessing of <style> blocks. The
  // consumed `@sentropic/design-system-svelte` ships plain scoped <style> and `ThemeProvider` injects its
  // theme CSS via `{@html "<style>${css}</style>"}`; running a host PostCSS pass over that literal breaks it.
  preprocess: vitePreprocess({ style: false })
};

export default config;
