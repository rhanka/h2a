import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["namespace-publication.test.ts"],
    setupFiles: ["./namespace-vm-setup.mjs"],
    environment: "node",
  },
});
