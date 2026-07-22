import * as opentelemetry from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { resolveActiveTracer } from "@/tracing-context";
import { getCommonHeaders } from "@/utils/utils";

export const getTracer = (name: string = "promptlayer-tracer") => {
  return resolveActiveTracer(opentelemetry.trace.getTracer(name));
};

export const resolveOtlpTracesEndpoint = (baseURL: string): string => {
  const envEndpoint = process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT?.trim();
  if (envEndpoint) {
    return envEndpoint;
  }
  return `${baseURL.replace(/\/$/, "")}/v1/traces`;
};

export const setupTracing = (
  enableTracing: boolean,
  apiKey: string,
  baseURL: string
): NodeTracerProvider => {
  if (!enableTracing) {
    throw new Error("setupTracing requires enableTracing=true");
  }

  const exporter = new OTLPTraceExporter({
    url: resolveOtlpTracesEndpoint(baseURL),
    headers: {
      "X-API-KEY": apiKey,
      ...getCommonHeaders(),
    },
  });
  const processor = new SimpleSpanProcessor(exporter);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "prompt-layer-js",
    }),
    spanProcessors: [processor],
  });
  provider.register();
  return provider;
};
