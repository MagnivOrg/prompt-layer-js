/**
 * Trace OpenAI Chat Completions and Responses calls and export them to
 * PromptLayer.
 *
 * Run with:
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true \
 * node --import promptlayer/register \
 * examples/tracing/trace_openai.mjs
 */
import OpenAI from "openai";
import {
  forceFlushTracing,
  shutdownTracing,
} from "promptlayer";

const model = process.env.OPENAI_MODEL;
if (!model) {
  throw new Error("OPENAI_MODEL is required");
}

const client = new OpenAI();

try {
  const chatCompletion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content:
          "Explain distributed tracing in one sentence.",
      },
    ],
  });
  console.log(
    "Chat Completions:",
    chatCompletion.choices[0]?.message.content
  );

  const response = await client.responses.create({
    model,
    input: "Explain distributed tracing in one sentence.",
  });
  console.log("Responses:", response.output_text);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
