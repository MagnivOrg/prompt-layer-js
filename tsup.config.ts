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
  // Bundle ora for the CJS CLI. Keep jiti external so Node selects its
  // conditional CJS entry, which preserves its runtime require paths.
  noExternal: ["ora"],
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
