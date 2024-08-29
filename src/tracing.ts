import * as opentelemetry from '@opentelemetry/api';
import {SimpleSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import PromptLayerSpanExporter from '@/span-exporter';

export const getTracer = (name: string = 'promptlayer-tracer') => {
  return opentelemetry.trace.getTracer(name);
}

export const setupTracing = (enableTracing: boolean, apiKey?: string) => {
  const provider = new NodeTracerProvider();
  const exporter = new PromptLayerSpanExporter(enableTracing, apiKey);
  const processor = new SimpleSpanProcessor(exporter);
  provider.addSpanProcessor(processor);
  provider.register();
}
