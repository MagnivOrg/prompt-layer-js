import * as opentelemetry from '@opentelemetry/api';
import { getTracer } from '@/tracing';

export const wrapWithSpan = (functionName: string, func: Function, attributes?: Record<string, any>) => {
  return function (...args: any[]) {
    const tracer = getTracer();

    const wrapperFunction = (span: opentelemetry.Span) => {
      try {
        if (attributes) {
          Object.entries(attributes).forEach(([key, value]) => {
            span.setAttribute(key, value);
          });
        }

        span.setAttribute('function_input', JSON.stringify(args));
        const result = func(...args);

        if (result instanceof Promise) {
          return result.then((resolvedResult) => {
            span.setAttribute('function_output', JSON.stringify(resolvedResult));
            span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
            return resolvedResult;
          }).catch((error) => {
            handleError(span, error, args);
            throw error;
          }).finally(() => span.end());
        } else {
          span.setAttribute('function_output', JSON.stringify(result));
          span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
          span.end();
          return result;
        }
      } catch (error) {
        handleError(span, error, args);
        throw error;
      }
    };

    return tracer.startActiveSpan(functionName, wrapperFunction);
  };
};

const handleError = (span: opentelemetry.Span, error: any, args: any[]) => {
  span.setAttribute('function_input', JSON.stringify(args));
  span.setStatus({
    code: opentelemetry.SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  span.end();
}
