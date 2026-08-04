# PromptLayer JavaScript SDK feature documentation

When working on this repository, read the official PromptLayer documentation for the SDK feature you are changing before editing code or tests.

- **Prompt templates** (`client.templates`): https://docs.promptlayer.com/features/prompt-registry/overview
- **Run prompt** (`client.run()`): https://docs.promptlayer.com/sdks/javascript#using-the-run-method-recommended
- **Run workflow** (`client.runWorkflow()`): https://docs.promptlayer.com/sdks/javascript#running-workflows
- **Manual request logging** (`client.logRequest()`): https://docs.promptlayer.com/features/observability/request-logs/custom-logging
- **Request tracking** (`client.track`): https://docs.promptlayer.com/features/observability/request-logs/metadata
- **Groups** (`client.group`): https://docs.promptlayer.com/features/observability/request-logs/request-ids
- **Manual tracing** (`client.wrapWithSpan(), client.traceTool`): https://docs.promptlayer.com/features/observability/traces/manual-tracing
- **Skill collections** (`client.skills`): https://docs.promptlayer.com/features/skill-collections/overview
- **Tables** (`client.tables`): https://docs.promptlayer.com/features/tables/overview
- **SDK evals** (`client.evals, evaluate()`): https://docs.promptlayer.com/sdks/evals/overview
- **Eval CLI** (`promptlayer eval run`): https://docs.promptlayer.com/sdks/evals/cli-and-ci
- **Provider proxies** (`client.OpenAI, client.Anthropic`): https://docs.promptlayer.com/sdks/javascript
- **Template caching** (`cacheTtlSeconds, client.invalidate()`): https://docs.promptlayer.com/sdks/javascript#sdk-cache
- **Error handling** (`throwOnError`): https://docs.promptlayer.com/sdks/javascript#error-handling
- **Provider auto-instrumentation** (`enableTracing, configureTracing()`): https://docs.promptlayer.com/features/observability/traces/auto-instrumentation/overview
- **ESM register preload** (`promptlayer/register`): https://docs.promptlayer.com/features/observability/traces/auto-instrumentation/overview
- **OpenAI Agents integration** (`promptlayer/openai-agents`): https://docs.promptlayer.com/features/observability/traces/integrations#openai-agents-sdk
- **Claude Agents integration** (`promptlayer/claude-agents`): https://docs.promptlayer.com/features/observability/traces/integrations#claude-code
