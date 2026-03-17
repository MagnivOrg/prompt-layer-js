import {
  OTLP_STATUS_CODE_ERROR,
  OTLP_STATUS_CODE_OK,
  OTLP_STATUS_CODE_UNSET,
  baseSpanAttributes,
  baseTraceAttributes,
  spanDataAttributes,
  spanKindFor,
  spanNameFor,
} from "@/integrations/openai-agents/mapping";
import { buildOtlpJsonPayload } from "@/integrations/openai-agents/otlp-json";
import { mapSpanId, mapTraceId, syntheticRootSpanId } from "@/integrations/openai-agents/ids";
import {
  isoToUnixNano,
  maxUnixNano,
  minUnixNano,
  nowUnixNano,
} from "@/integrations/openai-agents/time";
import { trimTrailingSlashes } from "@/integrations/openai-agents/url";
import type {
  OtlpSpanRecord,
  OtlpStatusRecord,
} from "@/integrations/openai-agents/types";
import { fetchWithRetry, getCommonHeaders } from "@/utils/utils";
import type {
  Span as AgentsSpan,
  Trace as AgentsTrace,
  TracingProcessor,
} from "@openai/agents";

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

interface UpstreamTraceContext {
  traceId: string;
  parentSpanId: string;
  traceState?: string;
}

type TraceMetadataRecord = Record<string, unknown>;

interface TraceState {
  rootSpan: OtlpSpanRecord;
  spans: Map<string, OtlpSpanRecord>;
}

export interface PromptLayerOpenAIAgentsProcessorOptions {
  apiKey: string;
  baseURL: string;
  includeRawPayloads?: boolean;
}

export class PromptLayerOpenAIAgentsProcessor implements TracingProcessor {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly includeRawPayloads: boolean;
  private readonly traceStates = new Map<string, TraceState>();
  private readonly completedTraceQueue = new Map<
    string,
    ReturnType<typeof buildOtlpJsonPayload>
  >();
  private readonly pendingExports = new Map<string, Promise<void>>();

  constructor({
    apiKey,
    baseURL,
    includeRawPayloads = true,
  }: PromptLayerOpenAIAgentsProcessorOptions) {
    this.apiKey = apiKey;
    this.baseURL = trimTrailingSlashes(baseURL);
    this.includeRawPayloads = includeRawPayloads;
  }

  start(): void {}

  async onTraceStart(trace: AgentsTrace): Promise<void> {
    if (this.traceStates.has(trace.traceId)) {
      return;
    }

    const upstreamContext = this.resolveUpstreamTraceContext(trace.metadata);
    const traceId = upstreamContext?.traceId ?? mapTraceId(trace.traceId);
    this.traceStates.set(trace.traceId, {
      rootSpan: {
        traceId,
        spanId: syntheticRootSpanId(trace.traceId),
        name: trace.name || "OpenAI Agents Trace",
        kind: 1,
        startTimeUnixNano: nowUnixNano(),
        parentSpanId: upstreamContext?.parentSpanId,
        traceState: upstreamContext?.traceState,
        attributes: baseTraceAttributes(trace, this.includeRawPayloads),
        status: { code: OTLP_STATUS_CODE_UNSET },
        events: [],
      },
      spans: new Map(),
    });
  }

  async onTraceEnd(trace: AgentsTrace): Promise<void> {
    const state = this.traceStates.get(trace.traceId);
    if (!state) {
      return;
    }

    const childSpans = Array.from(state.spans.values()).sort((left, right) => {
      return BigInt(left.startTimeUnixNano) < BigInt(right.startTimeUnixNano)
        ? -1
        : 1;
    });
    const childStarts = childSpans.map((span) => span.startTimeUnixNano);
    const childEnds = childSpans.map(
      (span) => span.endTimeUnixNano ?? span.startTimeUnixNano
    );
    const rootEnd = maxUnixNano(nowUnixNano(), ...childEnds);

    state.rootSpan.startTimeUnixNano = minUnixNano(
      state.rootSpan.startTimeUnixNano,
      ...childStarts
    );
    state.rootSpan.endTimeUnixNano = rootEnd;

    const payload = buildOtlpJsonPayload([state.rootSpan, ...childSpans]);
    this.traceStates.delete(trace.traceId);
    this.completedTraceQueue.set(trace.traceId, payload);
    this.startExportForTrace(trace.traceId);
  }

  async onSpanStart(span: AgentsSpan<any>): Promise<void> {
    const state = this.ensureTraceStateForSpan(span);
    const existing = state.spans.get(span.spanId);
    const record = existing ?? this.createSpanRecord(span, state.rootSpan.spanId);

    record.traceId = state.rootSpan.traceId;
    record.traceState = state.rootSpan.traceState;
    record.name = spanNameFor(span);
    record.kind = spanKindFor(span);
    record.startTimeUnixNano = isoToUnixNano(span.startedAt) ?? record.startTimeUnixNano;
    record.parentSpanId = span.parentId
      ? mapSpanId(span.parentId)
      : state.rootSpan.spanId;
    record.attributes = {
      ...record.attributes,
      ...baseSpanAttributes(span),
    };

    state.spans.set(span.spanId, record);
  }

  async onSpanEnd(span: AgentsSpan<any>): Promise<void> {
    const state = this.ensureTraceStateForSpan(span);
    const record =
      state.spans.get(span.spanId) ??
      this.createSpanRecord(span, state.rootSpan.spanId);

    record.attributes = {
      ...record.attributes,
      ...spanDataAttributes(span.spanData, this.includeRawPayloads),
    };
    record.endTimeUnixNano =
      isoToUnixNano(span.endedAt) ?? record.endTimeUnixNano ?? nowUnixNano();
    record.status = this.statusForSpan(span);

    if (span.error) {
      record.events = [
        ...(record.events ?? []),
        {
          name: "exception",
          timeUnixNano: record.endTimeUnixNano,
          attributes: {
            "exception.type": "OpenAIAgentsError",
            "exception.message": span.error.message,
            "openai_agents.error_json": JSON.stringify(span.error),
          },
        },
      ];
    }

    state.spans.set(span.spanId, record);
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }

  async forceFlush(): Promise<void> {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const traceId of this.completedTraceQueue.keys()) {
        this.startExportForTrace(traceId);
      }

      if (this.pendingExports.size === 0) {
        return;
      }

      await Promise.all(Array.from(this.pendingExports.values()));

      if (this.completedTraceQueue.size === 0) {
        return;
      }
    }
  }

  private traceLikeFromSpan(
    span: AgentsSpan<any>
  ): Pick<AgentsTrace, "traceId" | "name" | "groupId" | "metadata"> {
    const rawMetadata = this.asRecord(span.traceMetadata);
    const nestedMetadata = this.asRecord(rawMetadata?.metadata);

    return {
      traceId: span.traceId,
      name:
        this.readString(rawMetadata?.workflow_name) ??
        this.readString(rawMetadata?.workflowName) ??
        "OpenAI Agents Trace",
      groupId:
        this.readString(rawMetadata?.group_id) ??
        this.readString(rawMetadata?.groupId) ??
        null,
      metadata: nestedMetadata ?? rawMetadata ?? {},
    };
  }

  private ensureTraceStateForSpan(span: AgentsSpan<any>): TraceState {
    const existing = this.traceStates.get(span.traceId);
    if (existing) {
      return existing;
    }

    const traceLike = this.traceLikeFromSpan(span);

    const upstreamContext = this.resolveUpstreamTraceContext(traceLike.metadata);
    const traceId = upstreamContext?.traceId ?? mapTraceId(span.traceId);
    const state: TraceState = {
      rootSpan: {
        traceId,
        spanId: syntheticRootSpanId(span.traceId),
        name: traceLike.name,
        kind: 1,
        startTimeUnixNano: isoToUnixNano(span.startedAt) ?? nowUnixNano(),
        parentSpanId: upstreamContext?.parentSpanId,
        traceState: upstreamContext?.traceState,
        attributes: baseTraceAttributes(traceLike, this.includeRawPayloads),
        status: { code: OTLP_STATUS_CODE_UNSET },
        events: [],
      },
      spans: new Map(),
    };

    this.traceStates.set(span.traceId, state);
    return state;
  }

  private createSpanRecord(
    span: AgentsSpan<any>,
    rootSpanId: string
  ): OtlpSpanRecord {
    return {
      traceId:
        this.traceStates.get(span.traceId)?.rootSpan.traceId ?? mapTraceId(span.traceId),
      spanId: mapSpanId(span.spanId),
      parentSpanId: span.parentId ? mapSpanId(span.parentId) : rootSpanId,
      name: spanNameFor(span),
      kind: spanKindFor(span),
      startTimeUnixNano: isoToUnixNano(span.startedAt) ?? nowUnixNano(),
      traceState: this.traceStates.get(span.traceId)?.rootSpan.traceState,
      attributes: {
        ...baseSpanAttributes(span),
      },
      status: { code: OTLP_STATUS_CODE_UNSET },
      events: [],
    };
  }

  private statusForSpan(span: AgentsSpan<any>): OtlpStatusRecord {
    if (span.error) {
      return {
        code: OTLP_STATUS_CODE_ERROR,
        message: span.error.message,
      };
    }

    return {
      code: OTLP_STATUS_CODE_OK,
    };
  }

  private async exportPayload(payload: ReturnType<typeof buildOtlpJsonPayload>) {
    const response = await fetchWithRetry(`${this.baseURL}/v1/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
        "X-PromptLayer-Integration": "openai-agents-js",
        ...getCommonHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to export OpenAI Agents traces: ${response.status} ${response.statusText}`
      );
    }
  }

  private startExportForTrace(traceId: string): void {
    if (this.pendingExports.has(traceId)) {
      return;
    }

    const payload = this.completedTraceQueue.get(traceId);
    if (!payload) {
      return;
    }

    const exportPromise = this.exportPayload(payload)
      .then(() => {
        this.completedTraceQueue.delete(traceId);
      })
      .catch((error) => {
        console.error(
          `Failed to export OpenAI Agents trace '${traceId}'.`,
          error
        );
      })
      .finally(() => {
        this.pendingExports.delete(traceId);
      });

    this.pendingExports.set(traceId, exportPromise);
  }

  private resolveUpstreamTraceContext(
    metadata: AgentsTrace["metadata"] | AgentsSpan<any>["traceMetadata"]
  ): UpstreamTraceContext | null {
    const metadataRecord = this.asRecord(metadata);
    if (!metadataRecord) {
      return null;
    }

    const traceparent = metadataRecord.traceparent;
    if (typeof traceparent !== "string" || !traceparent.trim()) {
      return null;
    }

    const match = traceparent.trim().match(TRACEPARENT_RE);
    if (!match) {
      return null;
    }

    const [, version, traceId, parentSpanId] = match;
    const normalizedVersion = version.toLowerCase();
    const normalizedTraceId = traceId.toLowerCase();
    const normalizedParentSpanId = parentSpanId.toLowerCase();
    if (
      normalizedVersion === "ff" ||
      normalizedTraceId === ZERO_TRACE_ID ||
      normalizedParentSpanId === ZERO_SPAN_ID
    ) {
      return null;
    }

    const traceState =
      typeof metadataRecord.tracestate === "string" && metadataRecord.tracestate.trim()
        ? metadataRecord.tracestate.trim()
        : undefined;

    return {
      traceId: normalizedTraceId,
      parentSpanId: normalizedParentSpanId,
      traceState,
    };
  }

  private asRecord(value: unknown): TraceMetadataRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as TraceMetadataRecord;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }
}
