/**
 * Trace an AWS Bedrock Runtime Converse request.
 *
 * Requires PROMPTLAYER_API_KEY and AWS credentials. AWS_REGION defaults to
 * us-east-1, and AWS_BEDROCK_MODEL defaults to
 * global.anthropic.claude-sonnet-5.
 *
 * Message content is captured by default. Set
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false to exclude it.
 * Run with:
 * node --import promptlayer/register \
 * examples/tracing/trace_bedrock.mjs
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  forceFlushTracing,
  shutdownTracing,
} from "promptlayer";
import { runTracingChecks } from "./_example-runner.mjs";

const client = new BedrockRuntimeClient({
  region:
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    "us-east-1",
});
const model =
  process.env.AWS_BEDROCK_MODEL ??
  "global.anthropic.claude-sonnet-5";

try {
  await runTracingChecks([
    {
      name: "AWS Bedrock Runtime Converse",
      run: async () => {
        const response = await client.send(
          new ConverseCommand({
            modelId: model,
            messages: [
              {
                role: "user",
                content: [
                  {
                    text: "Explain distributed tracing in one sentence.",
                  },
                ],
              },
            ],
            inferenceConfig: { maxTokens: 128 },
          })
        );
        return (
          response.output?.message?.content
            ?.map((block) => block.text ?? "")
            .join("") || "no text"
        );
      },
    },
  ]);
} finally {
  client.destroy();
  await forceFlushTracing();
  await shutdownTracing();
}
