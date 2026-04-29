<div align="center">

# 🍰 PromptLayer

**Version, test, and monitor every prompt and agent with robust evals, tracing, and regression sets.**

<a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/-Node.js 18+-43853D?style=for-the-badge&logo=node.js&logoColor=white"></a>
<a href="https://docs.promptlayer.com"><img alt="Docs" src="https://custom-icon-badges.herokuapp.com/badge/docs-PL-green.svg?logo=cake&style=for-the-badge"></a>
<a href="https://www.loom.com/share/196c42e43acd4a369d75e9a7374a0850"><img alt="Demo with Loom" src="https://img.shields.io/badge/Demo-loom-552586.svg?logo=loom&style=for-the-badge&labelColor=gray"></a>

---

<div align="left">

This library provides convenient access to the PromptLayer API from applications written in JavaScript.

## Installation

```bash
npm install promptlayer
```

Optional peer dependencies [(learn more)](#integration-modules):

```bash
npm install promptlayer @openai/agents
npm install promptlayer @anthropic-ai/claude-agent-sdk
```

## Quick Start

To follow along, you need a [PromptLayer](https://www.promptlayer.com/) API key. Once logged in, go to Settings to generate a key.

Create a client and fetch a prompt template from PromptLayer:

```ts
import { PromptLayer } from "promptlayer";

const pl = new PromptLayer({ apiKey: "pl_xxxxx" });

const prompt = await pl.templates.get("support-reply", {
  input_variables: {
    customer_name: "Ada",
    question: "How do I reset my password?",
  },
});

console.log(prompt?.prompt_template);
```

SDK methods that make network requests return promises.

You can also use the client as a proxy around supported provider SDKs:

```ts
import BaseOpenAI from "openai";
import { PromptLayer } from "promptlayer";

const pl = new PromptLayer({ apiKey: "pl_xxxxx" });
const OpenAI: typeof BaseOpenAI = pl.OpenAI;
const openai = new OpenAI();

const response = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [{ role: "user", content: "Say hello in one short sentence." }],
  // @ts-ignore PromptLayer proxy option
  pl_tags: ["proxy-example"],
});
```

## Configuration

### Client Options

`PromptLayer(...)` accepts these parameters:

- `apiKey: string | undefined`: Your PromptLayer API key. If omitted, the SDK looks for `PROMPTLAYER_API_KEY`.
- `enableTracing: boolean = false`: Enables OpenTelemetry tracing export to PromptLayer.
- `baseURL: string | undefined`: Overrides the PromptLayer API base URL. If omitted, the SDK uses `PROMPTLAYER_BASE_URL` or the default API URL.
- `throwOnError: boolean = true`: Controls whether SDK methods throw errors or return `null` or fallback values for many API errors.
- `cacheTtlSeconds: number = 0`: Enables in-memory prompt-template caching when greater than `0`.

### Environment Variables

The SDK relies on the following environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `PROMPTLAYER_API_KEY` | Yes, unless passed as `apiKey` | API key used to authenticate requests to PromptLayer. |
| `PROMPTLAYER_BASE_URL` | No | Overrides the PromptLayer API base URL. Defaults to `https://api.promptlayer.com`. |
| `PROMPTLAYER_TRACEPARENT` | No | Optional trace context passed through the Claude Agents integration. |

## Client Resources

The main resources surfaced by `PromptLayer` are:

| Resource | Description |
| --- | --- |
| `client.templates` | Prompt template retrieval, listing, publishing, and cache invalidation. |
| `client.run()` and `client.runWorkflow()` | Helpers for running prompts and workflows. |
| `client.logRequest()` | Manual request logging. |
| `client.track` | Request annotation utilities for metadata, prompt linkage, scores, and groups. |
| `client.group` | Group creation for organizing related requests. |
| `client.wrapWithSpan()` | Helper for tracing your own functions and sending those spans to PromptLayer when tracing is enabled. |
| `client.skills` | Skill collection pull, publish, and update operations. |
| `client.OpenAI` and `client.Anthropic` | Provider proxies that wrap those SDKs and log requests to PromptLayer. |

Note: When tracing is enabled, spans are exported to PromptLayer using OpenTelemetry.

## Integration Modules

Optional modules that are imported directly rather than accessed through the client:

| Module | Description |
| --- | --- |
| `promptlayer/openai-agents` | Tracing utilities for the [OpenAI Agents SDK](https://www.npmjs.com/package/@openai/agents) that instrument agent runs and export their traces to PromptLayer. |
| `promptlayer/claude-agents` | Configuration utilities for the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) that load the PromptLayer plugin and required environment settings so Claude agent runs send traces to PromptLayer. |

## Error Handling

The SDK throws JavaScript `Error` instances for validation failures, missing API keys, unsupported providers, and PromptLayer API errors.

| Error case | Description |
| --- | --- |
| Missing API key | `PromptLayer` throws if no API key is passed and `PROMPTLAYER_API_KEY` is not set. |
| Validation failure | Some resource methods validate inputs before making a request, such as score ranges and skill collection providers. |
| PromptLayer API error | Non-success PromptLayer responses throw with the API error message when `throwOnError` is enabled. |
| Provider SDK error | Provider SDK calls made through `client.run()` or a provider proxy surface the underlying provider error. |
| Workflow failure | `client.runWorkflow()` throws when the workflow request fails, times out, or returns no successful output node. |

By default, the client throws these errors. If you initialize `PromptLayer` with `throwOnError: false`, many resource methods return `null`, `false`, an empty result, or the original provider response instead of throwing on PromptLayer API errors.

## Caching

When enabled, the SDK caches fetched prompt templates in memory for faster repeat reads, locally re-renders them with new variables, and falls back to stale cache on temporary API failures.
- Caching is disabled by default and is enabled by setting `cacheTtlSeconds` when creating `PromptLayer`.
- The cache applies to prompt templates fetched through `client.templates.get(...)`.
- Cached entries are stored in memory and keyed by prompt name, version, label, provider, and model.
- Requests that include `metadata_filters` or `model_parameter_overrides` bypass the cache.
- Templates that require server-side rendering behavior, such as placeholder messages or tool-variable expansion, are not cached for local rendering.
- If a cached template is stale and PromptLayer returns a transient error, the SDK can serve the stale cached version as a fallback.
- You can clear cached entries with `client.invalidate(...)` or `client.templates.invalidate(...)`.
