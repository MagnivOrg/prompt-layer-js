import { SDK_VERSION } from "@/utils/utils";
import type {
  AttributeValue,
  OtlpJsonPayload,
  OtlpSpanRecord,
} from "@/integrations/openai-agents/types";

const toAnyValue = (value: AttributeValue): Record<string, unknown> => {
  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { intValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (value === null) {
    return { stringValue: "null" };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toAnyValue(item)),
      },
    };
  }

  return {
    kvlistValue: {
      values: Object.entries(value).map(([key, nestedValue]) => ({
        key,
        value: toAnyValue(nestedValue),
      })),
    },
  };
};

const toKeyValues = (attributes: Record<string, AttributeValue>) => {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }));
};

export interface BuildOtlpJsonPayloadOptions {
  serviceName?: string;
  scopeName?: string;
  scopeVersion?: string;
}

export const buildOtlpJsonPayload = (
  spans: OtlpSpanRecord[],
  {
    serviceName = "promptlayer-openai-agents-js",
    scopeName = "promptlayer.integrations.openai_agents",
    scopeVersion = SDK_VERSION,
  }: BuildOtlpJsonPayloadOptions = {}
): OtlpJsonPayload => {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toKeyValues({
            "service.name": serviceName,
          }),
        },
        scopeSpans: [
          {
            scope: {
              name: scopeName,
              version: scopeVersion,
            },
            spans: spans.map((span) => {
              const payload: Record<string, unknown> = {
                traceId: span.traceId,
                spanId: span.spanId,
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano ?? span.startTimeUnixNano,
                attributes: toKeyValues(span.attributes),
                events: (span.events ?? []).map((event) => ({
                  name: event.name,
                  timeUnixNano: event.timeUnixNano,
                  attributes: toKeyValues(event.attributes ?? {}),
                })),
                links: [],
              };

              if (span.parentSpanId) {
                payload.parentSpanId = span.parentSpanId;
              }

              if (span.traceState) {
                payload.traceState = span.traceState;
              }

              if (span.status) {
                payload.status = {
                  code: span.status.code,
                  ...(span.status.message ? { message: span.status.message } : {}),
                };
              }

              return payload;
            }),
          },
        ],
      },
    ],
  };
};
