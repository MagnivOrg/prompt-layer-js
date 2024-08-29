import {Attributes, SpanKind, SpanStatusCode} from '@opentelemetry/api';
import {ReadableSpan, SpanExporter} from '@opentelemetry/sdk-trace-base';
import {ExportResultCode} from '@opentelemetry/core';
import {URL_API_PROMPTLAYER} from '@/utils';

class PromptLayerSpanExporter implements SpanExporter {
  private apiKey: string | undefined;
  private enableTracing: boolean;
  private url: string;

  constructor(enableTracing: boolean, apiKey?: string) {
    this.apiKey = apiKey || process.env.PROMPTLAYER_API_KEY;
    this.enableTracing = enableTracing;
    this.url = `${URL_API_PROMPTLAYER}/spans-bulk`;
  }

  private attributesToObject(attributes: Attributes | undefined): Record<string, any> {
    if (!attributes) return {};
    return Object.fromEntries(Object.entries(attributes));
  }

  private spanKindToString(kind: SpanKind): string {
    const kindMap: Record<SpanKind, string> = {
      [SpanKind.INTERNAL]: 'SpanKind.INTERNAL',
      [SpanKind.SERVER]: 'SpanKind.SERVER',
      [SpanKind.CLIENT]: 'SpanKind.CLIENT',
      [SpanKind.PRODUCER]: 'SpanKind.PRODUCER',
      [SpanKind.CONSUMER]: 'SpanKind.CONSUMER',
    };
    return kindMap[kind] || 'SpanKind.INTERNAL';
  }

  private statusCodeToString(code: SpanStatusCode): string {
    const statusMap: Record<SpanStatusCode, string> = {
      [SpanStatusCode.ERROR]: 'StatusCode.ERROR',
      [SpanStatusCode.OK]: 'StatusCode.OK',
      [SpanStatusCode.UNSET]: 'StatusCode.UNSET',
    };
    return statusMap[code] || 'StatusCode.UNSET';
  }

  private toNanoseconds(time: [number, number]): string {
    return (BigInt(time[0]) * BigInt(1e9) + BigInt(time[1])).toString();
  };

  export(spans: ReadableSpan[]): Promise<ExportResultCode> {
    if (!this.enableTracing) {
      return Promise.resolve(ExportResultCode.SUCCESS);
    }

    const requestData = spans.map(span => ({
      name: span.name,
      context: {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
        trace_state: span.spanContext().traceState?.serialize() || '',
      },
      kind: this.spanKindToString(span.kind),
      parent_id: span.parentSpanId || null,
      start_time: this.toNanoseconds(span.startTime),
      end_time: this.toNanoseconds(span.endTime),
      status: {
        status_code: this.statusCodeToString(span.status.code),
        description: span.status.message,
      },
      attributes: this.attributesToObject(span.attributes),
      events: span.events.map(event => ({
        name: event.name,
        timestamp: this.toNanoseconds(event.time),
        attributes: this.attributesToObject(event.attributes),
      })),
      links: span.links.map(link => ({
        context: link.context,
        attributes: this.attributesToObject(link.attributes),
      })),
      resource: {
        attributes: {
          ...span.resource.attributes,
          "service.name": "prompt-layer-js",
        },
        schema_url: '',
      },
    }));

    return fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey || '',
      },
      body: JSON.stringify({
        spans: requestData,
      }),
    })
      .then(response => {
        if (!response.ok) {
          console.error(`Error exporting spans\nHTTP error! status: ${response.status}`);
          return ExportResultCode.FAILED;
        }
        return ExportResultCode.SUCCESS;
      })
      .catch((error) => {
        console.error('Error exporting spans:', error);
        return ExportResultCode.FAILED;
      });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export default PromptLayerSpanExporter;
