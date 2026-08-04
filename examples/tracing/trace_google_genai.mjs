/**
 * Trace every Google GenAI API supported by the upstream OpenTelemetry
 * instrumentation: model generation and chat, with streaming variants.
 *
 * Requires PROMPTLAYER_API_KEY and GOOGLE_API_KEY (or GEMINI_API_KEY).
 * GOOGLE_GENAI_MODEL defaults to gemini-2.5-flash-lite.
 *
 * Vertex AI runs are enabled when GOOGLE_CLOUD_PROJECT and
 * GOOGLE_CLOUD_LOCATION are set. GOOGLE_VERTEX_MODEL can override the
 * model used for Vertex; otherwise GOOGLE_GENAI_MODEL is reused.
 *
 * Run with:
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true \
 * node --import promptlayer/register \
 * examples/tracing/trace_google_genai.mjs
 */
import { GoogleGenAI } from "@google/genai";
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

const apiKey = requireEnvironment("GOOGLE_API_KEY", [
  "GEMINI_API_KEY",
]);
const model = modelFromEnvironment(
  "GOOGLE_GENAI_MODEL",
  DEFAULT_TRACE_MODELS.google
);
const prompt = "Explain distributed tracing in one sentence.";

const developerClient = new GoogleGenAI({ apiKey });
const vertexUnavailable = missingEnvironment([
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
]);
const vertexClient = vertexUnavailable
  ? undefined
  : new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    });

const googleChecks = ({
  client,
  label,
  modelName,
  unavailable,
}) => [
  {
    name: `${label} models.generateContent`,
    skip: unavailable,
    run: async () => {
      const response = await client.models.generateContent({
        model: modelName,
        contents: prompt,
      });
      return response.text || "no text";
    },
  },
  {
    name: `${label} models.generateContentStream`,
    skip: unavailable,
    run: async () => {
      const stream =
        await client.models.generateContentStream({
          model: modelName,
          contents: prompt,
        });
      let text = "";
      for await (const chunk of stream) {
        text += chunk.text ?? "";
      }
      return text || "no text";
    },
  },
  {
    name: `${label} chat.sendMessage`,
    skip: unavailable,
    run: async () => {
      const chat = client.chats.create({ model: modelName });
      const response = await chat.sendMessage({
        message: prompt,
      });
      return response.text || "no text";
    },
  },
  {
    name: `${label} chat.sendMessageStream`,
    skip: unavailable,
    run: async () => {
      const chat = client.chats.create({ model: modelName });
      const stream = await chat.sendMessageStream({
        message: prompt,
      });
      let text = "";
      for await (const chunk of stream) {
        text += chunk.text ?? "";
      }
      return text || "no text";
    },
  },
];

try {
  await runTracingChecks([
    ...googleChecks({
      client: developerClient,
      label: "Gemini Developer API",
      modelName: model,
    }),
    ...googleChecks({
      client: vertexClient,
      label: "Gemini on Vertex AI",
      modelName: process.env.GOOGLE_VERTEX_MODEL ?? model,
      unavailable: vertexUnavailable,
    }),
  ]);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
