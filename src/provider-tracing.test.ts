import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  PromptLayer,
  configureTracing,
  createPromptLayerSpanProcessor,
  type TracingHandle,
} from "@/index";
import {
  ANTHROPIC_INSTRUMENTATION_SCOPE,
  GOOGLE_GENAI_INSTRUMENTATION_SCOPE,
} from "@/tracing";
import { createProviderAwareTracerProvider } from "@/instrumentation/provider-context";
import type { GetPromptTemplateResponse } from "@/types";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "request-id": "req_test",
      "x-request-id": "req_test",
    },
  });

const sseResponse = (events: unknown[]): Response =>
  new Response(
    events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    }
  );

const anthropicSseResponse = (
  events: Array<{ type: string }>
): Response =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    }
  );

const requestURL = (input: string | URL | Request): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const anthropicResponse = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: [
    {
      type: "text",
      text: "Tracing connects related operations.",
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 5,
    output_tokens: 4,
  },
};

const anthropicStreamEvents = [
  {
    type: "message_start",
    message: {
      id: "msg_stream",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "text_delta",
      text: "Tracing connects related operations.",
    },
  },
  {
    type: "content_block_stop",
    index: 0,
  },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 4 },
  },
  { type: "message_stop" },
];

const googleResponse = {
  responseId: "gemini_test",
  modelVersion: "gemini-2.5-flash",
  candidates: [
    {
      index: 0,
      finishReason: "STOP",
      content: {
        role: "model",
        parts: [
          {
            text: "Tracing connects related operations.",
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 5,
    candidatesTokenCount: 4,
    totalTokenCount: 9,
  },
};

const anthropicBlueprint: GetPromptTemplateResponse = {
  custom_provider: {
    api_key: "anthropic-test",
    base_url: "https://anthropic-managed.test",
    client: "anthropic",
    id: 7,
    name: "test-anthropic",
    workspace_id: 9,
  },
  id: 42,
  llm_kwargs: {
    max_tokens: 32,
    messages: [
      {
        role: "user",
        content: "Explain distributed tracing in one sentence.",
      },
    ],
    model: "claude-sonnet-4-20250514",
  },
  metadata: {
    model: {
      name: "claude-sonnet-4-20250514",
      parameters: {},
      provider: "anthropic",
    },
  },
  prompt_name: "anthropic-support-answer",
  prompt_template: {
    messages: [],
    type: "chat",
  },
  tags: [],
  version: 3,
};

const googleBlueprint: GetPromptTemplateResponse = {
  custom_provider: {
    api_key: "google-test",
    client: "google",
    id: 8,
    name: "test-google",
    workspace_id: 9,
  },
  id: 43,
  llm_kwargs: {
    history: [
      {
        role: "user",
        parts: [
          {
            text: "Explain distributed tracing in one sentence.",
          },
        ],
      },
    ],
    model: "gemini-2.5-flash",
  },
  metadata: {
    model: {
      name: "gemini-2.5-flash",
      parameters: {},
      provider: "google",
    },
  },
  prompt_name: "google-support-answer",
  prompt_template: {
    messages: [],
    type: "chat",
  },
  tags: [],
  version: 3,
};

describe("native Anthropic and Google GenAI SDK tracing", () => {
  const originalGoogleAPIKey = process.env.GOOGLE_API_KEY;
  let provider: NodeTracerProvider;
  let tracing: TracingHandle;

  afterEach(async () => {
    await tracing?.shutdown();
    await provider?.shutdown();
    if (originalGoogleAPIKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = originalGoogleAPIKey;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("degrades to a non-recording span when tracing cannot start", () => {
    const failingTracerProvider = createProviderAwareTracerProvider({
      getTracer: () => ({
        startActiveSpan: vi.fn(),
        startSpan: () => {
          throw new Error("tracer unavailable");
        },
      }),
    });

    const span = failingTracerProvider
      .getTracer("provider-test")
      .startSpan("provider-call");

    expect(span.isRecording()).toBe(false);
  });

  it("traces direct, streaming, and managed calls without surfacing export failures", async () => {
    process.env.GOOGLE_API_KEY = "google-test";
    const promptLayerSpans: ReadableSpan[] = [];
    const failingPromptLayerExporter: SpanExporter = {
      export: (spans, callback) => {
        promptLayerSpans.push(...spans);
        callback({
          code: 1,
          error: new Error("PromptLayer trace endpoint unavailable"),
        });
      },
      shutdown: async () => undefined,
    };
    const sharedExporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(sharedExporter),
        createPromptLayerSpanProcessor({
          exporter: failingPromptLayerExporter,
        }),
      ],
    });
    provider.register();
    tracing = configureTracing({
      captureContent: true,
      providers: ["anthropic", "google"],
      tracerProvider: provider,
    });

    let anthropicMessageRequestCount = 0;
    const fetchMock = vi.fn(
      async (
        input: string | URL | Request,
        _init?: RequestInit
      ): Promise<Response> => {
        const url = requestURL(input);
        if (url === "https://promptlayer.test/track-request") {
          return jsonResponse({
            prompt_blueprint: { id: 42 },
            request_id: 17,
          });
        }
        if (url.includes(":streamGenerateContent")) {
          return sseResponse([googleResponse]);
        }
        if (url.includes(":generateContent")) {
          return jsonResponse(googleResponse);
        }
        if (
          url.includes("/v1/messages") ||
          url.startsWith("https://bedrock.test/") ||
          url.startsWith("https://vertex.test/")
        ) {
          anthropicMessageRequestCount += 1;
          return [2, 4].includes(anthropicMessageRequestCount)
            ? anthropicSseResponse(anthropicStreamEvents)
            : jsonResponse(anthropicResponse);
        }
        throw new Error(`Unexpected provider request: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    // Provider SDKs must load after their native instrumentations.
    const Anthropic = require("@anthropic-ai/sdk").default;
    const { AnthropicBedrock } = require("@anthropic-ai/bedrock-sdk");
    const { AnthropicVertex } = require("@anthropic-ai/vertex-sdk");
    const { GoogleGenAI } = require("@google/genai");
    const anthropic = new Anthropic({
      apiKey: "anthropic-test",
      baseURL: "https://anthropic-direct.test",
      fetch: fetchMock,
      maxRetries: 0,
    });
    const google = new GoogleGenAI({ apiKey: "google-test" });
    const googleVertex = new GoogleGenAI({
      apiKey: "google-vertex-test",
      vertexai: true,
    });
    const bedrock = new AnthropicBedrock({
      awsRegion: "us-east-1",
      baseURL: "https://bedrock.test",
      fetch: fetchMock,
      maxRetries: 0,
      skipAuth: true,
    });
    const anthropicVertex = new AnthropicVertex({
      baseURL: "https://vertex.test/v1",
      fetch: fetchMock,
      googleAuth: {
        getClient: async () => ({
          getRequestHeaders: async () => ({
            authorization: "Bearer vertex-test",
          }),
          projectId: "test-project",
        }),
      },
      maxRetries: 0,
      projectId: "test-project",
      region: "us-east5",
    });

    await anthropic.messages.create({
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Explain distributed tracing in one sentence.",
        },
      ],
      model: "claude-sonnet-4-20250514",
    });
    const anthropicStream =
      await anthropic.messages.create({
        max_tokens: 32,
        messages: [
          {
            role: "user",
            content:
              "Explain distributed tracing in one sentence.",
          },
        ],
        model: "claude-sonnet-4-20250514",
        stream: true,
      });
    let anthropicChunkCount = 0;
    for await (const _event of anthropicStream) {
      anthropicChunkCount += 1;
    }
    expect(anthropicChunkCount).toBe(anthropicStreamEvents.length);
    await anthropic.beta.messages.create({
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Explain distributed tracing in one sentence.",
        },
      ],
      model: "claude-sonnet-4-20250514",
    });
    const anthropicBetaStream =
      await anthropic.beta.messages.create({
        max_tokens: 32,
        messages: [
          {
            role: "user",
            content:
              "Explain distributed tracing in one sentence.",
          },
        ],
        model: "claude-sonnet-4-20250514",
        stream: true,
      });
    for await (const _event of anthropicBetaStream) {
      // Consume the stream so the instrumentation can close its span.
    }
    const bedrockResponse = await bedrock.messages.create({
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Explain distributed tracing in one sentence.",
        },
      ],
      model: "anthropic.claude-sonnet-4-20250514-v1:0",
    });
    expect(bedrockResponse.id).toBe("msg_test");
    await anthropicVertex.messages.create({
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Explain distributed tracing in one sentence.",
        },
      ],
      model: "claude-sonnet-4@20250514",
    });

    await google.models.generateContent({
      contents: "Explain distributed tracing in one sentence.",
      model: "gemini-2.5-flash",
    });
    const googleStream =
      await google.models.generateContentStream({
        contents: "Explain distributed tracing in one sentence.",
        model: "gemini-2.5-flash",
      });
    for await (const _chunk of googleStream) {
      // Consume the stream so the instrumentation can close its span.
    }
    const googleChat = google.chats.create({
      model: "gemini-2.5-flash",
    });
    await googleChat.sendMessage({
      message: "Explain distributed tracing in one sentence.",
    });
    const googleChatStream = await googleChat.sendMessageStream({
      message: "Explain distributed tracing in one sentence.",
    });
    for await (const _chunk of googleChatStream) {
      // Consume the stream so the instrumentation can close its span.
    }
    await googleVertex.models.generateContent({
      contents: "Explain distributed tracing in one sentence.",
      model: "gemini-2.5-flash",
    });
    const googleVertexChat = googleVertex.chats.create({
      model: "gemini-2.5-flash",
    });
    await googleVertexChat.sendMessage({
      message: "Explain distributed tracing in one sentence.",
    });
    const googleVertexChatStream =
      await googleVertexChat.sendMessageStream({
        message:
          "Explain distributed tracing in one sentence.",
      });
    for await (const _chunk of googleVertexChatStream) {
      // Consume the stream so the instrumentation can close its span.
    }

    const client = new PromptLayer({
      apiKey: "pl-test",
      baseURL: "https://promptlayer.test",
      enableTracing: true,
    });
    client.templates.get = vi
      .fn()
      .mockResolvedValueOnce(anthropicBlueprint)
      .mockResolvedValueOnce(googleBlueprint);

    await client.run({
      promptName: "anthropic-support-answer",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      modelParameterOverrides: {
        max_tokens: 32,
      },
    });
    await client.run({
      promptName: "google-support-answer",
      provider: "google",
      model: "gemini-2.5-flash",
    });
    await tracing.forceFlush();

    expect(client.templates.get).toHaveBeenNthCalledWith(
      1,
      "anthropic-support-answer",
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        model_parameter_overrides: {
          max_tokens: 32,
        },
        provider: "anthropic",
      })
    );
    expect(client.templates.get).toHaveBeenNthCalledWith(
      2,
      "google-support-answer",
      expect.objectContaining({
        model: "gemini-2.5-flash",
        provider: "google",
      })
    );

    const trackRequests = fetchMock.mock.calls.filter(
      ([input]) =>
        requestURL(input) ===
        "https://promptlayer.test/track-request"
    );
    expect(trackRequests).toHaveLength(2);

    const anthropicSpans = promptLayerSpans.filter(
      (span) =>
        span.instrumentationScope.name ===
        ANTHROPIC_INSTRUMENTATION_SCOPE
    );
    const googleSpans = promptLayerSpans.filter(
      (span) =>
        span.instrumentationScope.name ===
        GOOGLE_GENAI_INSTRUMENTATION_SCOPE
    );
    expect(anthropicSpans).toHaveLength(6);
    expect(googleSpans).toHaveLength(8);
    expect(
      anthropicSpans.map(
        (span) => span.attributes["gen_ai.provider.name"]
      )
    ).toEqual(
      expect.arrayContaining([
        "anthropic",
        "gcp.vertex_ai",
      ])
    );
    expect(
      anthropicSpans.map(
        (span) => span.attributes["gen_ai.provider.name"]
      )
    ).not.toContain("aws.bedrock");
    expect(
      googleSpans.map(
        (span) => span.attributes["gen_ai.provider.name"]
      )
    ).toEqual(
      expect.arrayContaining(["gcp.gen_ai", "gcp.vertex_ai"])
    );

    for (const span of [...anthropicSpans, ...googleSpans]) {
      const spanSummary = JSON.stringify({
        attributes: span.attributes,
        name: span.name,
        scope: span.instrumentationScope.name,
      });
      expect(
        span.attributes["gen_ai.input.messages"],
        spanSummary
      ).toContain("Explain distributed tracing");
      expect(
        span.attributes["gen_ai.output.messages"],
        spanSummary
      ).toContain("Tracing connects related operations.");
      expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(5);
      expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(4);
    }

    const managedSpans = [
      ...anthropicSpans,
      ...googleSpans,
    ].filter(
      (span) =>
        span.attributes["promptlayer.request_log.managed"] === true
    );
    expect(managedSpans).toHaveLength(2);
    expect(
      managedSpans.map(
        (span) => span.attributes["promptlayer.prompt.name"]
      )
    ).toEqual(
      expect.arrayContaining([
        "anthropic-support-answer",
        "google-support-answer",
      ])
    );

    const sharedManagedSpans = sharedExporter
      .getFinishedSpans()
      .filter((span) =>
        [
          ANTHROPIC_INSTRUMENTATION_SCOPE,
          GOOGLE_GENAI_INSTRUMENTATION_SCOPE,
        ].includes(span.instrumentationScope.name)
      )
      .filter(
        (span) =>
          span.attributes["promptlayer.request_log.managed"] === true
      );
    expect(sharedManagedSpans).toHaveLength(0);
  });
});
