/**
 * Trace every OpenAI API supported by the upstream OpenTelemetry
 * instrumentation: Chat Completions, Embeddings, and Responses.
 * Streaming variants are included where supported.
 *
 * Requires PROMPTLAYER_API_KEY and OPENAI_API_KEY. OPENAI_MODEL
 * defaults to gpt-4.1-mini and OPENAI_EMBEDDING_MODEL defaults to
 * text-embedding-3-small.
 *
 * Azure OpenAI runs are enabled when AZURE_OPENAI_API_KEY,
 * AZURE_OPENAI_ENDPOINT, and OPENAI_API_VERSION are set.
 * AZURE_OPENAI_MODEL and AZURE_OPENAI_EMBEDDING_MODEL override the
 * direct OpenAI model defaults for Azure deployment names.
 *
 * Message content is captured by default. Set
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false to exclude it.
 * Run with:
 * node --import promptlayer/register \
 * examples/tracing/trace_openai.mjs
 */
import OpenAI, { AzureOpenAI } from "openai";
import {
  forceFlushTracing,
  shutdownTracing,
} from "promptlayer";
import {
  DEFAULT_TRACE_MODELS,
  missingEnvironment,
  modelFromEnvironment,
  requireEnvironment,
  runTracingChecks,
} from "./_example-runner.mjs";

const prompt = "Explain distributed tracing in one sentence.";
const model = modelFromEnvironment(
  "OPENAI_MODEL",
  DEFAULT_TRACE_MODELS.openAI
);
const embeddingModel = modelFromEnvironment(
  "OPENAI_EMBEDDING_MODEL",
  DEFAULT_TRACE_MODELS.openAIEmbedding
);
requireEnvironment("OPENAI_API_KEY");

const openAIClient = new OpenAI();

const azureUnavailable = missingEnvironment([
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "OPENAI_API_VERSION",
]);
const azureModel = modelFromEnvironment(
  "AZURE_OPENAI_MODEL",
  model
);
const azureEmbeddingModel = modelFromEnvironment(
  "AZURE_OPENAI_EMBEDDING_MODEL",
  embeddingModel
);
const azureClient = azureUnavailable
  ? undefined
  : new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.OPENAI_API_VERSION,
    });

const openAIChecks = ({
  client,
  label,
  textModel,
  vectorModel,
  unavailable,
  embeddingUnavailable = unavailable,
}) => [
  {
    name: `${label} Chat Completions`,
    skip: unavailable,
    run: async () => {
      const result = await client.chat.completions.create({
        model: textModel,
        messages: [{ role: "user", content: prompt }],
      });
      return result.choices[0]?.message.content ?? "no text";
    },
  },
  {
    name: `${label} Chat Completions stream`,
    skip: unavailable,
    run: async () => {
      const stream = await client.chat.completions.create({
        model: textModel,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });
      let text = "";
      for await (const chunk of stream) {
        text += chunk.choices[0]?.delta.content ?? "";
      }
      return text || "no text";
    },
  },
  {
    name: `${label} Embeddings`,
    skip: embeddingUnavailable,
    run: async () => {
      const result = await client.embeddings.create({
        model: vectorModel,
        input: prompt,
      });
      return `${result.data[0]?.embedding.length ?? 0} dimensions`;
    },
  },
  {
    name: `${label} Responses`,
    skip: unavailable,
    run: async () => {
      const result = await client.responses.create({
        model: textModel,
        input: prompt,
      });
      return result.output_text || "no text";
    },
  },
  {
    name: `${label} Responses stream`,
    skip: unavailable,
    run: async () => {
      const stream = await client.responses.create({
        model: textModel,
        input: prompt,
        stream: true,
      });
      let text = "";
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          text += event.delta;
        }
      }
      return text || "no text";
    },
  },
];

try {
  await runTracingChecks([
    ...openAIChecks({
      client: openAIClient,
      label: "OpenAI",
      textModel: model,
      vectorModel: embeddingModel,
    }),
    ...openAIChecks({
      client: azureClient,
      label: "Azure OpenAI",
      textModel: azureModel,
      vectorModel: azureEmbeddingModel,
      unavailable: azureUnavailable,
    }),
  ]);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
