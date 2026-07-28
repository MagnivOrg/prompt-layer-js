import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  PromptLayer,
  configureTracing,
  createPromptLayerSpanProcessor,
  type TracingHandle,
} from "@/index";
import type { GetPromptTemplateResponse } from "@/types";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test",
    },
  });

const chatCompletionResponse = () => ({
  id: "chatcmpl_test",
  object: "chat.completion",
  created: 1,
  model: "gpt-4o-mini",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "Tracing connects related operations.",
      },
    },
  ],
  usage: {
    prompt_tokens: 5,
    completion_tokens: 4,
    total_tokens: 9,
  },
});

const responsesResponse = (id: string) => ({
  id,
  object: "response",
  created_at: 1,
  model: "gpt-4o-mini",
  output: [
    {
      id: `msg_${id}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "Tracing connects related operations.",
          annotations: [],
        },
      ],
    },
  ],
  status: "completed",
  usage: {
    input_tokens: 5,
    output_tokens: 4,
    total_tokens: 9,
  },
});

const requestURL = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

describe("native OpenAI SDK tracing", () => {
  const originalCapture =
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  const originalSemconv =
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
  let loggerProvider: LoggerProvider;
  let provider: NodeTracerProvider;
  let tracing: TracingHandle;

  afterEach(async () => {
    await tracing?.shutdown();
    await provider?.shutdown();
    await loggerProvider?.shutdown();
    if (originalCapture === undefined) {
      delete process.env
        .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
    } else {
      process.env
        .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT =
        originalCapture;
    }
    if (originalSemconv === undefined) {
      delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
    } else {
      process.env.OTEL_SEMCONV_STABILITY_OPT_IN =
        originalSemconv;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("traces direct SDK calls and keeps PromptLayer.run to one request log", async () => {
    process.env
      .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT =
      "span_and_event";
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN =
      "gen_ai_latest_experimental";

    const promptLayerExporter = new InMemorySpanExporter();
    const sharedExporter = new InMemorySpanExporter();
    const sharedLogExporter = new InMemoryLogRecordExporter();
    loggerProvider = new LoggerProvider({
      processors: [
        new SimpleLogRecordProcessor(sharedLogExporter),
      ],
    });
    provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(sharedExporter),
        createPromptLayerSpanProcessor({
          exporter: promptLayerExporter,
        }),
      ],
    });
    provider.register();
    tracing = configureTracing({
      loggerProvider,
      providers: ["openai"],
      tracerProvider: provider,
    });

    // OpenAI must load after its native instrumentation is registered.
    const OpenAI = require("openai").default;
    const directFetch = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const url = requestURL(input);
        if (url === "https://openai.direct/v1/chat/completions") {
          return jsonResponse(chatCompletionResponse());
        }
        if (url === "https://openai.direct/v1/responses") {
          return jsonResponse(responsesResponse("resp_direct"));
        }
        throw new Error(`Unexpected direct request: ${url}`);
      }
    );
    const openai = new OpenAI({
      apiKey: "sk-test",
      baseURL: "https://openai.direct/v1",
      fetch: directFetch as any,
      maxRetries: 0,
    });

    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            "Explain distributed tracing in one sentence.",
        },
      ],
    });
    await openai.responses.create({
      model: "gpt-4o-mini",
      input: "Explain distributed tracing in one sentence.",
    });

    const fetchMock = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        const url = requestURL(input);
        if (url === "https://openai.run/v1/responses") {
          return jsonResponse(responsesResponse("resp_run"));
        }
        if (url === "https://promptlayer.test/track-request") {
          return jsonResponse({
            prompt_blueprint: { id: 42 },
            request_id: 17,
          });
        }
        throw new Error(`Unexpected PromptLayer.run request: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PromptLayer({
      apiKey: "pl-test",
      baseURL: "https://promptlayer.test",
      enableTracing: true,
    });
    const promptBlueprint: GetPromptTemplateResponse = {
      custom_provider: {
        api_key: "sk-test",
        base_url: "https://openai.run/v1",
        client: "openai",
        id: 7,
        name: "test-openai",
        workspace_id: 9,
      },
      id: 42,
      llm_kwargs: {
        input: "Explain distributed tracing in one sentence.",
        model: "gpt-4o-mini",
      },
      metadata: {
        model: {
          api_type: "responses",
          name: "gpt-4o-mini",
          parameters: {},
          provider: "openai",
        },
      },
      prompt_name: "support-answer",
      prompt_template: {
        messages: [],
        type: "chat",
      },
      tags: [],
      version: 3,
    };
    client.templates.get = vi
      .fn()
      .mockResolvedValue(promptBlueprint);

    const result = await client.run({
      promptName: "support-answer",
    });
    await tracing.forceFlush();

    expect(result.request_id).toBe(17);
    const trackRequests = fetchMock.mock.calls.filter(
      ([input]) =>
        requestURL(input) ===
        "https://promptlayer.test/track-request"
    );
    expect(trackRequests).toHaveLength(1);

    const spans = promptLayerExporter.getFinishedSpans();
    const runSpan = spans.find(
      (span) => span.name === "PromptLayer Run"
    );
    const openAISpans = spans.filter(
      (span) =>
        span.instrumentationScope.name ===
        "@opentelemetry/instrumentation-openai"
    );
    expect(runSpan).toBeDefined();
    expect(openAISpans).toHaveLength(3);

    const managedSpan = openAISpans.find(
      (span) =>
        span.attributes["promptlayer.request_log.managed"] ===
        true
    );
    expect(managedSpan).toBeDefined();
    expect(managedSpan?.parentSpanContext?.spanId).toBe(
      runSpan?.spanContext().spanId
    );
    expect(
      managedSpan?.attributes["promptlayer.request_log.span_id"]
    ).toBe(runSpan?.spanContext().spanId);
    expect(
      managedSpan?.attributes["promptlayer.prompt.name"]
    ).toBe("support-answer");
    expect(
      openAISpans.filter(
        (span) =>
          span.attributes["promptlayer.request_log.managed"] ===
          undefined
      )
    ).toHaveLength(2);

    for (const span of openAISpans) {
      expect(
        span.attributes["gen_ai.input.messages"]
      ).toContain("Explain distributed tracing");
      expect(
        span.attributes["gen_ai.output.messages"]
      ).toContain("Tracing connects related operations.");
    }

    const trackRequestBody = JSON.parse(
      String(trackRequests[0][1]?.body)
    );
    expect(trackRequestBody.span_id).toBe(
      runSpan?.spanContext().spanId
    );

    const sharedManagedSpan = sharedExporter
      .getFinishedSpans()
      .find(
        (span) =>
          span.instrumentationScope.name ===
            "@opentelemetry/instrumentation-openai" &&
          span.parentSpanContext?.spanId ===
            runSpan?.spanContext().spanId
      );
    expect(
      sharedManagedSpan?.attributes[
        "promptlayer.request_log.managed"
      ]
    ).toBeUndefined();
    expect(
      sharedManagedSpan?.attributes["promptlayer.prompt.name"]
    ).toBeUndefined();
    expect(
      sharedManagedSpan?.attributes["gen_ai.input.messages"]
    ).toBeUndefined();
    expect(
      sharedManagedSpan?.attributes["gen_ai.output.messages"]
    ).toBeUndefined();

    const sharedMessageContent = JSON.stringify(
      sharedLogExporter.getFinishedLogRecords().map((record) => ({
        attributes: record.attributes,
        body: record.body,
      }))
    );
    expect(sharedMessageContent).toContain(
      "Explain distributed tracing"
    );
    expect(sharedMessageContent).toContain(
      "Tracing connects related operations."
    );
  });
});
