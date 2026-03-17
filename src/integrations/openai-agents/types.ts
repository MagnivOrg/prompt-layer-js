export type AttributePrimitive = string | number | boolean;
export type AttributeValue =
  | AttributePrimitive
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

export interface OtlpEventRecord {
  name: string;
  timeUnixNano: string;
  attributes?: Record<string, AttributeValue>;
}

export interface OtlpStatusRecord {
  code: number;
  message?: string;
}

export interface OtlpSpanRecord {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  parentSpanId?: string;
  traceState?: string;
  attributes: Record<string, AttributeValue>;
  events?: OtlpEventRecord[];
  status?: OtlpStatusRecord;
}

export interface OtlpJsonPayload {
  resourceSpans: Array<{
    resource: {
      attributes: Array<{
        key: string;
        value: Record<string, unknown>;
      }>;
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version?: string;
      };
      spans: Array<Record<string, unknown>>;
    }>;
  }>;
}
