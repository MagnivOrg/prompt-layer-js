import * as opentelemetry from "@opentelemetry/api";
import { getTracer } from "@/tracing";

export const wrapWithSpan = (
  functionName: string,
  func: Function,
  attributes?: Record<string, any>,
) => {
  return async function (...args: any[]) {
    const tracer = getTracer();

    return tracer.startActiveSpan(functionName, async (span) => {
      try {
        if (attributes) {
          Object.entries(attributes).forEach(([key, value]) => {
            span.setAttribute(key, value);
          });
        }

        span.setAttribute("function_input", JSON.stringify(args));
        const result = await func(...args);
        span.setAttribute("function_output", JSON.stringify(result));
        span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute("function_input", JSON.stringify(args));
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        span.end();
      }
    });
  };
};
