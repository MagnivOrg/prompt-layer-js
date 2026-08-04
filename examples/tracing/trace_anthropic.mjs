/**
 * Trace every Anthropic API supported by the upstream OpenTelemetry
 * instrumentation: Messages and beta Messages, including streaming
 * variants.
 *
 * Requires PROMPTLAYER_API_KEY and ANTHROPIC_API_KEY. ANTHROPIC_MODEL
 * defaults to claude-sonnet-4-6.
 *
 * Anthropic Vertex runs are enabled with CLOUD_ML_REGION and
 * ANTHROPIC_VERTEX_PROJECT_ID, using Application Default Credentials.
 * ANTHROPIC_VERTEX_MODEL overrides the direct Anthropic model.
 *
 * Message content is captured by default. Set
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false to exclude it.
 * Run with:
 * node --import promptlayer/register \
 * examples/tracing/trace_anthropic.mjs
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
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

const model = modelFromEnvironment(
  "ANTHROPIC_MODEL",
  DEFAULT_TRACE_MODELS.anthropic
);
const vertexModel = modelFromEnvironment(
  "ANTHROPIC_VERTEX_MODEL",
  model
);
requireEnvironment("ANTHROPIC_API_KEY");
const prompt = "Explain distributed tracing in one sentence.";
const messages = [{ role: "user", content: prompt }];

const anthropic = new Anthropic();
const vertexUnavailable = missingEnvironment([
  "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_PROJECT_ID",
]);
const vertex = vertexUnavailable
  ? undefined
  : new AnthropicVertex();

const messageText = (message) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("") || "no text";

const streamedMessageText = async (stream) => {
  let text = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      text += event.delta.text;
    }
  }
  return text || "no text";
};

const messageChecks = ({
  client,
  label,
  modelName,
  unavailable,
}) => [
  {
    name: `${label} Messages`,
    skip: unavailable,
    run: async () => {
      const result = await client.messages.create({
        model: modelName,
        max_tokens: 128,
        messages,
      });
      return messageText(result);
    },
  },
  {
    name: `${label} Messages stream`,
    skip: unavailable,
    run: async () => {
      const stream = await client.messages.create({
        model: modelName,
        max_tokens: 128,
        messages,
        stream: true,
      });
      return streamedMessageText(stream);
    },
  },
  {
    name: `${label} beta Messages`,
    skip: unavailable,
    run: async () => {
      const result = await client.beta.messages.create({
        model: modelName,
        max_tokens: 128,
        messages,
      });
      return messageText(result);
    },
  },
  {
    name: `${label} beta Messages stream`,
    skip: unavailable,
    run: async () => {
      const stream = await client.beta.messages.create({
        model: modelName,
        max_tokens: 128,
        messages,
        stream: true,
      });
      return streamedMessageText(stream);
    },
  },
];

try {
  await runTracingChecks([
    ...messageChecks({
      client: anthropic,
      label: "Anthropic",
      modelName: model,
    }),
    ...messageChecks({
      client: vertex,
      label: "Anthropic Vertex",
      modelName: vertexModel,
      unavailable: vertexUnavailable,
    }),
  ]);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
