import * as opentelemetry from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

export const getTracer = (name: string = 'promptlayer-tracer') => {
    return opentelemetry.trace.getTracer(name);
}

export const setupTracing = () => {
    const provider = new NodeTracerProvider();
    const consoleExporter = new ConsoleSpanExporter();
    const processor = new SimpleSpanProcessor(consoleExporter);
    provider.addSpanProcessor(processor);
    provider.register();
}
