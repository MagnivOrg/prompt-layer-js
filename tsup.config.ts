import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "claude-agents": "src/claude-agents.ts",
    "openai-agents": "src/openai-agents.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  legacyOutput: true,
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
