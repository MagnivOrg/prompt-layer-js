import { afterEach, describe, expect, it, vi } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { getCommonHeaders } from "@/utils/utils";
import { resolveOtlpTracesEndpoint, setupTracing } from "@/tracing";

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
  let provider: NodeTracerProvider | null = null;

  afterEach(async () => {
    if (originalEndpoint === undefined) {
      delete process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT;
    } else {
      process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT = originalEndpoint;
    }
    if (provider) {
      await provider.shutdown();
      provider = null;
    }
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
});
