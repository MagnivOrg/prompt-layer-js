import { afterEach, describe, expect, it, vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { getCommonHeaders } from "@/utils/utils";
import {
  configureTracing,
  resolveCaptureContent,
  resolveOtlpTracesEndpoint,
  setupTracing,
  shutdownTracing,
} from "@/tracing";

const instrumentationMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
}));

vi.mock("@opentelemetry/instrumentation", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@opentelemetry/instrumentation")
    >();
  return {
    ...actual,
    registerInstrumentations: vi.fn(
      () => instrumentationMocks.cleanup
    ),
  };
});

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  return {
    OTLPTraceExporter: vi.fn().mockImplementation(function (
      this: { url: string; headers: Record<string, string> },
      options: { url: string; headers: Record<string, string> }
    ) {
      this.url = options.url;
      this.headers = options.headers;
      this.export = vi.fn((_spans, resultCallback) => {
        resultCallback({ code: 0 });
      });
      this.shutdown = vi.fn(async () => undefined);
      this.forceFlush = vi.fn(async () => undefined);
    }),
  };
});

describe("setupTracing OTLP export", () => {
  const originalEndpoint = process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT;
  const originalCapture =
    process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  let provider: NodeTracerProvider | null = null;

  afterEach(async () => {
    await shutdownTracing();
    if (originalEndpoint === undefined) {
      delete process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT;
    } else {
      process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT = originalEndpoint;
    }
    if (originalCapture === undefined) {
      delete process.env
        .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
    } else {
      process.env
        .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT =
        originalCapture;
    }
    provider = null;
    vi.clearAllMocks();
  });

  it("resolves the public /v1/traces endpoint from baseURL", () => {
    delete process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT;
    expect(resolveOtlpTracesEndpoint("https://api.promptlayer.com/")).toBe(
      "https://api.promptlayer.com/v1/traces"
    );
  });

  it("prefers PROMPTLAYER_OTLP_TRACES_ENDPOINT when set", () => {
    process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT =
      "https://collector.example.com/custom-traces";
    expect(resolveOtlpTracesEndpoint("https://api.promptlayer.com")).toBe(
      "https://collector.example.com/custom-traces"
    );
  });

  it("accepts span_and_event content capture parity", () => {
    process.env
      .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT =
      "span_and_event";

    expect(resolveCaptureContent()).toBe(true);
    expect(resolveCaptureContent(false)).toBe(false);
  });

  it("configures OTLPTraceExporter with PromptLayer auth headers", () => {
    delete process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT;
    provider = setupTracing(true, "pl_test", "https://api.promptlayer.com");

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: "https://api.promptlayer.com/v1/traces",
      headers: {
        "X-API-KEY": "pl_test",
        ...getCommonHeaders(),
      },
    });
    expect(provider).toBeInstanceOf(NodeTracerProvider);
  });

  it("reuses one provider and one set of instrumentation registrations", () => {
    const first = setupTracing(
      true,
      "pl_test",
      "https://api.promptlayer.com"
    );
    const second = setupTracing(
      true,
      "pl_test",
      "https://api.promptlayer.com"
    );
    provider = first;

    expect(second).toBe(first);
    expect(OTLPTraceExporter).toHaveBeenCalledTimes(1);
    expect(registerInstrumentations).toHaveBeenCalledTimes(3);
  });

  it("registers upstream instrumentations and provider context adapters", () => {
    provider = setupTracing(
      true,
      "pl_test",
      "https://api.promptlayer.com"
    );

    expect(
      vi
        .mocked(registerInstrumentations)
        .mock.calls.flatMap(
          ([registration]) =>
            registration.instrumentations?.map(
              (instrumentation) =>
                instrumentation.instrumentationName
            ) ?? []
        )
    ).toEqual([
      "@opentelemetry/instrumentation-openai",
      "promptlayer/instrumentation-anthropic-context",
      "promptlayer/instrumentation-google-context",
    ]);
  });

  it("does not shut down a caller-owned tracer provider", async () => {
    const callerProvider = new NodeTracerProvider();
    const forceFlush = vi.spyOn(callerProvider, "forceFlush");
    const shutdown = vi.spyOn(callerProvider, "shutdown");

    const tracing = configureTracing({
      providers: [],
      tracerProvider: callerProvider,
    });
    await tracing.shutdown();

    expect(forceFlush).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
    await callerProvider.shutdown();
  });
});
