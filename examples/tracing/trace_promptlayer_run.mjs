/**
 * Trace one PromptLayer.run call backed by OpenAI.
 *
 * Run with:
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true \
 * node --import promptlayer/register \
 * examples/tracing/trace_promptlayer_run.mjs
 *
 * Expected in PromptLayer:
 * - one PromptLayer Run span
 * - one child OpenAI LLM span
 * - one request log, identified by the printed request ID
 */
import {
  PromptLayer,
  forceFlushTracing,
  shutdownTracing,
} from "promptlayer";

const promptName = process.env.PROMPTLAYER_RUN_PROMPT_NAME;
if (!promptName) {
  throw new Error("PROMPTLAYER_RUN_PROMPT_NAME is required");
}

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

try {
  const result = await client.run({
    promptName,
    inputVariables,
  });
  console.log("PromptLayer.run request ID:", result.request_id);
  console.log("PromptLayer.run result:", result);
} finally {
  await forceFlushTracing();
  await shutdownTracing();
}
