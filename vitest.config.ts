import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Next.js uses this marker to prevent server modules from entering client bundles.
// It has no runtime behavior; map it to an empty module in Vitest so server-only
// modules can be exercised in Node-based unit/integration tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
});
