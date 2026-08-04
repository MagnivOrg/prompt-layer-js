import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SDK_FEATURE_DOCS } from "@/agents/sdk-features";
import { renderFeatureDocsPrompt } from "@/agents/render-feature-docs";

const FEATURE_DOCS_PATH = path.resolve(process.cwd(), ".agents/feature-docs.md");

describe(".agents/feature-docs.md", () => {
  it("exists at the repository root", () => {
    expect(() => readFileSync(FEATURE_DOCS_PATH, "utf8")).not.toThrow();
  });

  it("matches the rendered feature documentation prompt", () => {
    const committed = readFileSync(FEATURE_DOCS_PATH, "utf8");
    expect(committed).toBe(renderFeatureDocsPrompt());
  });

  it("links every SDK feature to docs.promptlayer.com", () => {
    const committed = readFileSync(FEATURE_DOCS_PATH, "utf8");

    for (const feature of SDK_FEATURE_DOCS) {
      expect(committed).toContain(feature.docUrl);
      expect(feature.docUrl.startsWith("https://docs.promptlayer.com")).toBe(
        true
      );
    }
  });

  it("documents each SDK feature API surface", () => {
    const committed = readFileSync(FEATURE_DOCS_PATH, "utf8");

    for (const feature of SDK_FEATURE_DOCS) {
      expect(committed).toContain(feature.api);
      expect(committed).toContain(feature.name);
    }
  });
});
