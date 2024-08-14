import axios from 'axios';
import {Attributes, SpanKind, SpanStatusCode} from '@opentelemetry/api';
import {ReadableSpan, SpanExporter} from '@opentelemetry/sdk-trace-base';
import {ExportResultCode} from '@opentelemetry/core';
import {URL_API_PROMPTLAYER} from '@/utils';

class PromptLayerSpanExporter implements SpanExporter {
  private apiKey: string | undefined;
  private url: string;

  constructor() {
    this.apiKey = process.env.PROMPTLAYER_API_KEY;
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
    // Always return 'StatusCode.UNSET' as per API requirement
    return 'StatusCode.UNSET';
  }

  private hrTimeToMilliseconds(time: [number, number]): number {
    return Math.floor(time[0] * 1000 + time[1] / 1e6);
  }

  export(spans: ReadableSpan[]): Promise<ExportResultCode> {
    const requestData = spans.map(span => ({
      name: span.name,
      context: {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
        trace_state: span.spanContext().traceState?.serialize() || '',
      },
      kind: this.spanKindToString(span.kind),
      parent_id: span.parentSpanId || null,
      start_time: this.hrTimeToMilliseconds(span.startTime),
      end_time: this.hrTimeToMilliseconds(span.endTime),
      status: {
        status_code: this.statusCodeToString(span.status.code),
        description: span.status.message,
      },
      attributes: this.attributesToObject(span.attributes),
      events: span.events.map(event => ({
        name: event.name,
        timestamp: this.hrTimeToMilliseconds(event.time),
        attributes: this.attributesToObject(event.attributes),
      })),
      links: span.links.map(link => ({
        context: link.context,
        attributes: this.attributesToObject(link.attributes),
      })),
      resource: {
        attributes: this.attributesToObject(span.resource.attributes),
        schema_url: '',
      },
    }));

    // TODO: Remove
    console.log({
      spans: requestData,
      workspace_id: 1,
    });

    return axios.post(
      this.url,
      {
        spans: requestData,
        workspace_id: 1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          "X-API-KEY": this.apiKey,
        },
      }
    )
      .then(() => ExportResultCode.SUCCESS)
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