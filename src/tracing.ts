import PromptLayerSpanExporter from "@/span-exporter";
import * as opentelemetry from "@opentelemetry/api";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { resolveActiveTracer } from "@/tracing-context";

export const getTracer = (name: string = "promptlayer-tracer") => {
  return resolveActiveTracer(opentelemetry.trace.getTracer(name));
};

export const setupTracing = (
  enableTracing: boolean,
  apiKey: string,
  baseURL: string
): NodeTracerProvider => {
  const exporter = new PromptLayerSpanExporter(enableTracing, apiKey, baseURL);
  const processor = new SimpleSpanProcessor(exporter);
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  return provider;
};
