import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  define: {
    __SDK_VERSION__: JSON.stringify("test-version"),
  },
});
