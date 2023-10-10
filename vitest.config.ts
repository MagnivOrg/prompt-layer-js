import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "@": "./src",
    },
    setupFiles: ["./src/mocks/server.ts"],
  },
});
