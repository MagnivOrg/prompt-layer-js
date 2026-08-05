export const DOCS_URL = "https://docs.promptlayer.com";
export const DOCS_MCP_URL = "https://docs.promptlayer.com/mcp";
export const LLMS_TXT_URL = "https://docs.promptlayer.com/llms.txt";
export const JS_SDK_DOCS_URL = "https://docs.promptlayer.com/sdks/javascript";
export const SDK_EVALS_SKILLS_ZIP_URL =
  "https://share.promptlayer.com/api/sessions/sdk-evals/skills?format=zip";

export const SKILL_NAME = "promptlayer";
export const DOCS_MCP_SERVER_NAME = "promptlayer-docs";

export const SKILL_SOURCE_URLS = [
  `${DOCS_URL}/.well-known/skills/${SKILL_NAME}/SKILL.md`,
  `${DOCS_URL}/skill.md`,
] as const;

export const JS_SDK_SKILL_APPENDIX = `

## JavaScript SDK guidance (from \`promptlayer setup\`)

When implementing the PromptLayer JavaScript SDK in this project:

- Prefer the published docs and type declarations over reverse-engineering bundled package internals.
- JavaScript SDK guide: ${JS_SDK_DOCS_URL}
- Curated docs index: ${LLMS_TXT_URL}
- Prefer \`client.run()\`, \`client.templates\`, and other public APIs instead of scanning \`node_modules/promptlayer/dist\`.
- Use the PromptLayer Docs MCP server (\`${DOCS_MCP_SERVER_NAME}\`) to look up current documentation before guessing APIs.
`;
