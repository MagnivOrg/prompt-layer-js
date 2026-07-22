import * as opentelemetry from "@opentelemetry/api";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { Tracer } from "@opentelemetry/api";
import { isStreamResult } from "@/run-tracing";
import { serializeCellValue } from "./utils";
import { withActiveEvalTracer } from "@/tracing-context";
import { validationError } from "./errors";

export { isStreamResult };

export const formatTraceId = (spanContext: opentelemetry.SpanContext): string =>
  spanContext.traceId.toLowerCase().padStart(32, "0");

export const formatSpanId = (spanContext: opentelemetry.SpanContext): string =>
  spanContext.spanId.toLowerCase().padStart(16, "0");

export const flushTraces = async (
  tracerProvider: NodeTracerProvider | null | undefined,
  throwOnError = false
): Promise<void> => {
  if (!tracerProvider) return;
  try {
    // Some providers return false when flush times out (Python OTel SDK).
    const flushed = await (tracerProvider.forceFlush() as Promise<
      boolean | void
    >);
    if (flushed === false) {
      throw new Error("Tracer provider did not flush before the deadline.");
    }
  } catch (error) {
    console.warn(
      "Failed to flush eval traces before Table import.",
      error
    );
    if (throwOnError) throw error;
  }
};

export const assertNotStreamResult = <T>(value: T): T => {
  if (isStreamResult(value)) {
    throw validationError(
      "Eval runner returned a stream. Consume the stream and return its final value."
    );
  }
  return value;
};

export type EvalSpanMetadata = {
  tableId?: string | number | null;
  sheetId?: string | number | null;
};

export const runCaseInSpan = async <TInput, TOutput>(
  name: string,
  runner: (input: TInput) => TOutput | Promise<TOutput>,
  inputValue: TInput,
  tracer?: Tracer,
  metadata: EvalSpanMetadata = {}
): Promise<[TOutput, string, string]> => {
  const evalTracer = tracer ?? opentelemetry.trace.getTracer("promptlayer.evals");
  return new Promise((resolve, reject) => {
    evalTracer.startActiveSpan(`Eval: ${name}`, async (span) => {
      let traceId = "";
      let spanId = "";
      try {
        span.setAttribute("node_type", "EVAL");
        span.setAttribute("eval.name", name);
        span.setAttribute(
          "eval.input",
          String(serializeCellValue(inputValue))
        );
        if (metadata.tableId != null) {
          span.setAttribute("table_id", String(metadata.tableId));
        }
        if (metadata.sheetId != null) {
          span.setAttribute("sheet_id", String(metadata.sheetId));
        }
        const spanContext = span.spanContext();
        if (spanContext && opentelemetry.isSpanContextValid(spanContext)) {
          traceId = formatTraceId(spanContext);
          spanId = formatSpanId(spanContext);
        }
        const outputValue = await withActiveEvalTracer(evalTracer, () =>
          Promise.resolve(runner(inputValue))
        );
        assertNotStreamResult(outputValue);
        span.setAttribute(
          "eval.output",
          String(serializeCellValue(outputValue))
        );
        resolve([outputValue, traceId, spanId]);
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      } finally {
        span.end();
      }
    });
  });
};
