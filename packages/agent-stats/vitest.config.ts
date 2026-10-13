import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['../h2a-runtime/vitest.native-isolation.mjs'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
