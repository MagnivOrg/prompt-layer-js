import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
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
