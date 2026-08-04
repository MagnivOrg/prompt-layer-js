export interface SdkFeatureDoc {
  name: string;
  api: string;
  docUrl: string;
}

const DOCS_BASE = "https://docs.promptlayer.com";

export const SDK_FEATURE_DOCS: SdkFeatureDoc[] = [
  {
    name: "Prompt templates",
    api: "client.templates",
    docUrl: `${DOCS_BASE}/features/prompt-registry/overview`,
  },
  {
    name: "Run prompt",
    api: "client.run()",
    docUrl: `${DOCS_BASE}/sdks/javascript#using-the-run-method-recommended`,
  },
  {
    name: "Run workflow",
    api: "client.runWorkflow()",
    docUrl: `${DOCS_BASE}/sdks/javascript#running-workflows`,
  },
  {
    name: "Manual request logging",
    api: "client.logRequest()",
    docUrl: `${DOCS_BASE}/features/observability/request-logs/custom-logging`,
  },
  {
    name: "Request tracking",
    api: "client.track",
    docUrl: `${DOCS_BASE}/features/observability/request-logs/metadata`,
  },
  {
    name: "Groups",
    api: "client.group",
    docUrl: `${DOCS_BASE}/features/observability/request-logs/request-ids`,
  },
  {
    name: "Manual tracing",
    api: "client.wrapWithSpan(), client.traceTool",
    docUrl: `${DOCS_BASE}/features/observability/traces/manual-tracing`,
  },
  {
    name: "Skill collections",
    api: "client.skills",
    docUrl: `${DOCS_BASE}/features/skill-collections/overview`,
  },
  {
    name: "Tables",
    api: "client.tables",
    docUrl: `${DOCS_BASE}/features/tables/overview`,
  },
  {
    name: "SDK evals",
    api: "client.evals, evaluate()",
    docUrl: `${DOCS_BASE}/sdks/evals/overview`,
  },
  {
    name: "Eval CLI",
    api: "promptlayer eval run",
    docUrl: `${DOCS_BASE}/sdks/evals/cli-and-ci`,
  },
  {
    name: "Provider proxies",
    api: "client.OpenAI, client.Anthropic",
    docUrl: `${DOCS_BASE}/sdks/javascript`,
  },
  {
    name: "Template caching",
    api: "cacheTtlSeconds, client.invalidate()",
    docUrl: `${DOCS_BASE}/sdks/javascript#sdk-cache`,
  },
  {
    name: "Error handling",
    api: "throwOnError",
    docUrl: `${DOCS_BASE}/sdks/javascript#error-handling`,
  },
  {
    name: "Provider auto-instrumentation",
    api: "enableTracing, configureTracing()",
    docUrl: `${DOCS_BASE}/features/observability/traces/auto-instrumentation/overview`,
  },
  {
    name: "ESM register preload",
    api: "promptlayer/register",
    docUrl: `${DOCS_BASE}/features/observability/traces/auto-instrumentation/overview`,
  },
  {
    name: "OpenAI Agents integration",
    api: "promptlayer/openai-agents",
    docUrl: `${DOCS_BASE}/features/observability/traces/integrations#openai-agents-sdk`,
  },
  {
    name: "Claude Agents integration",
    api: "promptlayer/claude-agents",
    docUrl: `${DOCS_BASE}/features/observability/traces/integrations#claude-code`,
  },
];
