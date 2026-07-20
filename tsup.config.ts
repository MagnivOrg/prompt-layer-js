import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    "claude-agents": "src/claude-agents.ts",
    "openai-agents": "src/openai-agents.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  legacyOutput: true,
  // ora/jiti are ESM-only; bundle so CJS entries work before Node's require(esm).
  noExternal: ["ora", "jiti"],
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
