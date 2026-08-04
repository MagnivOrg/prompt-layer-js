import { SDK_FEATURE_DOCS, type SdkFeatureDoc } from "@/agents/sdk-features";

export function renderFeatureDocsPrompt(
  features: SdkFeatureDoc[] = SDK_FEATURE_DOCS
): string {
  const rows = features
    .map(
      (feature) =>
        `- **${feature.name}** (\`${feature.api}\`): ${feature.docUrl}`
    )
    .join("\n");

  return `# PromptLayer JavaScript SDK feature documentation

When working on this repository, read the official PromptLayer documentation for the SDK feature you are changing before editing code or tests.

${rows}
`;
}
