import * as opentelemetry from '@opentelemetry/api';
import { getTracer } from '@/tracing';

export const wrapWithSpan = (functionName: string, func: Function) => {
  return async function (...args: any[]) {
    const tracer = getTracer();

    return tracer.startActiveSpan(functionName, async (span) => {
      try {
        const result = await func(...args);
        span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  };
};
