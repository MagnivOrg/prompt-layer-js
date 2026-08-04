/**
 * Trace PromptLayer.run through the configured provider and every
 * auto-instrumented provider override: OpenAI, Anthropic, and Google.
 * Both non-streaming and streaming override calls are included.
 *
 * The prompt must be compatible with all three providers.
 * Requires PROMPTLAYER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * GOOGLE_API_KEY (or GEMINI_API_KEY), and
 * PROMPTLAYER_RUN_PROMPT_NAME. Provider model environment variables
 * use the same defaults and overrides as the direct tracing examples.
 *
 * Run with:
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true \
 * node --import promptlayer/register \
 * examples/tracing/trace_promptlayer_run.mjs
 *
 * Expected in PromptLayer:
 * - seven PromptLayer Run spans
 * - one child provider span under each run
 * - seven request logs, identified by the printed request IDs
 *
 * Every check runs even if an earlier provider fails.
 */
import {
  PromptLayer,
  forceFlushTracing,
  shutdownTracing,
} from "promptlayer";
import {
  DEFAULT_TRACE_MODELS,
  modelFromEnvironment,
  requireEnvironment,
  runTracingChecks,
} from "./_example-runner.mjs";

const promptName = requireEnvironment(
  "PROMPTLAYER_RUN_PROMPT_NAME"
);
const openAIModel = modelFromEnvironment(
  "OPENAI_MODEL",
  DEFAULT_TRACE_MODELS.openAI
);
const anthropicModel = modelFromEnvironment(
  "ANTHROPIC_MODEL",
  DEFAULT_TRACE_MODELS.anthropic
);
const googleModel = modelFromEnvironment(
  "GOOGLE_GENAI_MODEL",
  DEFAULT_TRACE_MODELS.google
);
requireEnvironment("OPENAI_API_KEY");
requireEnvironment("ANTHROPIC_API_KEY");
requireEnvironment("GOOGLE_API_KEY", ["GEMINI_API_KEY"]);

const inputVariables = JSON.parse(
  process.env.PROMPTLAYER_RUN_INPUTS ?? "{}"
);
if (
  typeof inputVariables !== "object" ||
  inputVariables === null ||
  Array.isArray(inputVariables)
) {
  throw new Error(
    "PROMPTLAYER_RUN_INPUTS must contain a JSON object"
  );
}

const client = new PromptLayer({ enableTracing: true });
const getPromptTemplate = client.templates.get.bind(
  client.templates
);
client.templates.get = async (name, params) => {
  const blueprint = await getPromptTemplate(name, params);
  if (
    params?.provider !== "anthropic" ||
    !blueprint?.llm_kwargs
  ) {
    return blueprint;
  }

  // Anthropic models accept temperature or top_p, but not both.
  const { top_p: _topP, ...llmKwargs } = blueprint.llm_kwargs;
  return {
    ...blueprint,
    llm_kwargs: llmKwargs,
  };
};

const runPrompt = async (overrides = {}) => {
  const result = await client.run({
    promptName,
    inputVariables,
    ...overrides,
  });
  return `request ID ${result.request_id}`;
};

const streamPrompt = async (overrides) => {
  const stream = await client.run({
    promptName,
    inputVariables,
    stream: true,
    ...overrides,
  });
  let finalChunk;
  for await (const chunk of stream) {
    finalChunk = chunk;
  }
  return `request ID ${finalChunk?.request_id ?? "not returned"}`;
};

const providerRuns = [
  {
    name: "PromptLayer.run configured provider",
    run: () => runPrompt(),
  },
  {
    name: "PromptLayer.run OpenAI override",
    run: () =>
      runPrompt({
        provider: "openai",
        model: openAIModel,
      }),
  },
  {
    name: "PromptLayer.run OpenAI override stream",
    run: () =>
      streamPrompt({
        provider: "openai",
        model: openAIModel,
      }),
  },
  {
    name: "PromptLayer.run Anthropic override",
    run: () =>
      runPrompt({
        provider: "anthropic",
        model: anthropicModel,
        modelParameterOverrides: {
          max_tokens: 128,
        },
      }),
  },
  {
    name: "PromptLayer.run Anthropic override stream",
    run: () =>
      streamPrompt({
        provider: "anthropic",
        model: anthropicModel,
        modelParameterOverrides: {
          max_tokens: 128,
        },
      }),
  },
  {
    name: "PromptLayer.run Google override",
    run: () =>
      runPrompt({
        provider: "google",
        model: googleModel,
      }),
  },
  {
    name: "PromptLayer.run Google override stream",
    run: () =>
      streamPrompt({
        provider: "google",
        model: googleModel,
      }),
  },
];

try {
  await runTracingChecks(providerRuns);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
