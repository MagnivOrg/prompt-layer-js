import axios from 'axios';
import {Attributes} from '@opentelemetry/api';
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

  export(spans: ReadableSpan[]): Promise<ExportResultCode> {
    const requestData = spans.map(span => ({
      name: span.name,
      context: {
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
        trace_state: span.spanContext().traceState?.serialize(),
      },
      kind: span.kind,
      parent_id: span.parentSpanId,
      start_time: span.startTime,
      end_time: span.endTime,
      status: {
        status_code: span.status.code,
        description: span.status.message,
      },
      attributes: this.attributesToObject(span.attributes),
      events: span.events.map(event => ({
        name: event.name,
        timestamp: event.time,
        attributes: this.attributesToObject(event.attributes),
      })),
      links: span.links.map(link => ({
        context: link.context,
        attributes: this.attributesToObject(link.attributes),
      })),
      resource: {
        attributes: this.attributesToObject(span.resource.attributes),
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
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      }
    )
      .then(() => ExportResultCode.SUCCESS)
      .catch(() => ExportResultCode.FAILED);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export default PromptLayerSpanExporter;
