import type { Tracer } from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";

const activeEvalTrace = new AsyncLocalStorage<{ tracer: Tracer }>();

export const withActiveEvalTracer = <T>(
  tracer: Tracer,
  callback: () => T
): T => activeEvalTrace.run({ tracer }, callback);

export const resolveActiveTracer = (fallback: Tracer): Tracer =>
  activeEvalTrace.getStore()?.tracer ?? fallback;
