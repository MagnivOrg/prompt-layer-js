import { isSpanContextValid, trace, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";

const activeEvalTrace = new AsyncLocalStorage<{ tracer: Tracer }>();

export const withActiveEvalTracer = <T>(
  tracer: Tracer,
  callback: () => T
): T => activeEvalTrace.run({ tracer }, callback);

export const resolveActiveTracer = (fallback: Tracer): Tracer =>
  activeEvalTrace.getStore()?.tracer ?? fallback;

export const currentTraceparent = (): string | undefined => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return undefined;
  }

  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
};
