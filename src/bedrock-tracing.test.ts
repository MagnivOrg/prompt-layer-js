import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AWS_SDK_INSTRUMENTATION_SCOPE,
  configureTracing,
  createPromptLayerSpanProcessor,
  type TracingHandle,
  withPromptLayerProviderRequestContext,
} from "@/tracing";

describe("AWS Bedrock Converse tracing", () => {
  let provider: NodeTracerProvider;
  let tracing: TracingHandle;

  afterEach(async () => {
    await tracing?.shutdown();
    await provider?.shutdown();
    vi.restoreAllMocks();
  });

  it("captures Converse request and response content", async () => {
    const exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [
        createPromptLayerSpanProcessor({ exporter }),
      ],
    });
    provider.register();
    tracing = configureTracing({
      captureContent: true,
      providers: ["bedrock"],
      tracerProvider: provider,
    });

    // The AWS SDK must load after its instrumentation is registered.
    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = require("@aws-sdk/client-bedrock-runtime");
    const { HttpResponse } = require("@smithy/protocol-http");
    const requestHandler = {
      handle: vi.fn(async () => ({
        response: new HttpResponse({
          statusCode: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "bedrock-test-request",
          },
          body: Readable.from([
            JSON.stringify({
              output: {
                message: {
                  role: "assistant",
                  content: [{ text: "Hello." }],
                },
              },
              stopReason: "end_turn",
              usage: {
                inputTokens: 2,
                outputTokens: 1,
                totalTokens: 3,
              },
              metrics: { latencyMs: 1 },
            }),
          ]),
        }),
      })),
    };
    const client = new BedrockRuntimeClient({
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
      region: "us-east-1",
      requestHandler,
    });

    try {
      const result =
        await withPromptLayerProviderRequestContext(
          {
            promptAttributes: {
              "promptlayer.prompt.name": "support-answer",
            },
            requestLogSpanId: "1234567890abcdef",
          },
          () =>
            client.send(
              new ConverseCommand({
                modelId: "global.anthropic.claude-sonnet-5",
                messages: [
                  {
                    role: "user",
                    content: [{ text: "Say hello." }],
                  },
                ],
                inferenceConfig: { maxTokens: 32 },
              })
            )
        );
      await tracing.forceFlush();

      expect(result.output.message.content[0].text).toBe("Hello.");
      const spans = exporter
        .getFinishedSpans()
        .filter(
          (span) =>
            span.instrumentationScope.name ===
            AWS_SDK_INSTRUMENTATION_SCOPE
        );
      expect(spans).toHaveLength(1);
      expect(spans[0].attributes).toMatchObject({
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "aws.bedrock",
        "gen_ai.usage.input_tokens": 2,
        "gen_ai.usage.output_tokens": 1,
        node_type: "LLM_CALL",
        "promptlayer.api.type": "converse",
        "promptlayer.prompt.name": "support-answer",
        "promptlayer.provider.type": "amazon.bedrock",
        "promptlayer.request_log.managed": true,
      });
      expect(
        JSON.parse(
          String(spans[0].attributes["gen_ai.input.messages"])
        )
      ).toEqual([
        {
          role: "user",
          parts: [{ type: "text", content: "Say hello." }],
        },
      ]);
      expect(
        JSON.parse(
          String(spans[0].attributes["gen_ai.output.messages"])
        )
      ).toEqual([
        {
          role: "assistant",
          parts: [{ type: "text", content: "Hello." }],
          finish_reason: "end_turn",
        },
      ]);
    } finally {
      client.destroy();
    }
  });
});
