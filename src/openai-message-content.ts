import {
  isSpanContextValid,
  TraceFlags,
  type Attributes,
  type SpanContext,
} from "@opentelemetry/api";
import type {
  Logger,
  LoggerOptions,
  LoggerProvider as ApiLoggerProvider,
  LogRecord,
} from "@opentelemetry/api-logs";
import {
  LoggerProvider,
  type LogRecordProcessor,
  type SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

const OPENAI_SCOPE = "@opentelemetry/instrumentation-openai";
const INPUT_MESSAGES = "gen_ai.input.messages";
const OUTPUT_MESSAGES = "gen_ai.output.messages";

const EVENT_ROLES: Record<string, string> = {
  "gen_ai.assistant.message": "assistant",
  "gen_ai.system.message": "system",
  "gen_ai.tool.message": "tool",
  "gen_ai.user.message": "user",
};

type CapturedMessages = {
  input: unknown[];
  output: unknown[];
};

const isRecord = (
  value: unknown
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const spanKey = (context: SpanContext): string =>
  `${context.traceId}:${context.spanId}`;

const messageList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * OpenAI's upstream instrumentation emits message bodies through OTel Logs.
 * Retain them until the matching PromptLayer span export without changing
 * the span object observed by any other exporter.
 */
export class OpenAIMessageContentBridge
  implements LogRecordProcessor
{
  private captureContent = false;
  private readonly messages = new Map<string, CapturedMessages>();

  setCaptureContent(enabled: boolean): void {
    this.captureContent = enabled;
    if (!enabled) {
      this.messages.clear();
    }
  }

  onEmit(logRecord: SdkLogRecord): void {
    const context = logRecord.spanContext;
    if (
      !this.captureContent ||
      logRecord.instrumentationScope.name !== OPENAI_SCOPE ||
      !context ||
      !isSpanContextValid(context) ||
      (context.traceFlags & TraceFlags.SAMPLED) === 0
    ) {
      return;
    }

    const key = spanKey(context);
    const captured = this.messages.get(key) ?? {
      input: [],
      output: [],
    };
    this.messages.set(key, captured);

    captured.input.push(
      ...messageList(logRecord.attributes[INPUT_MESSAGES])
    );
    captured.output.push(
      ...messageList(logRecord.attributes[OUTPUT_MESSAGES])
    );

    const eventName =
      logRecord.eventName ??
      String(logRecord.attributes["event.name"] ?? "");
    const body = isRecord(logRecord.body)
      ? logRecord.body
      : undefined;
    const role = EVENT_ROLES[eventName];
    if (role && body) {
      const message: Record<string, unknown> = {
        role,
        ...body,
      };
      if (role === "tool" && body.id !== undefined) {
        message.tool_call_id = body.id;
        delete message.id;
      }
      if (
        message.content !== undefined ||
        message.tool_calls !== undefined
      ) {
        captured.input.push(message);
      }
    } else if (eventName === "gen_ai.choice" && body) {
      const choice: Record<string, unknown> = isRecord(body.message)
        ? { role: "assistant", ...body.message }
        : { role: "assistant" };
      if (body.finish_reason !== undefined) {
        choice.finish_reason = body.finish_reason;
      }
      if (
        choice.content !== undefined ||
        choice.tool_calls !== undefined
      ) {
        captured.output.push(choice);
      }
    }
  }

  takeSpanAttributes(span: ReadableSpan): Attributes {
    if (span.instrumentationScope.name !== OPENAI_SCOPE) {
      return {};
    }
    const key = spanKey(span.spanContext());
    const captured = this.messages.get(key);
    this.messages.delete(key);
    if (!captured) return {};

    const attributes: Attributes = {};
    if (captured.input.length > 0) {
      attributes[INPUT_MESSAGES] = JSON.stringify(captured.input);
    }
    if (captured.output.length > 0) {
      attributes[OUTPUT_MESSAGES] = JSON.stringify(
        captured.output
      );
    }
    return attributes;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.messages.clear();
    return Promise.resolve();
  }
}

export const createOpenAILoggerProviders = (
  bridge: OpenAIMessageContentBridge,
  delegate: ApiLoggerProvider
): {
  loggerProvider: ApiLoggerProvider;
  promptLayerLoggerProvider: LoggerProvider;
} => {
  const promptLayerLoggerProvider = new LoggerProvider({
    processors: [bridge],
  });

  // Preserve an application's logger provider while collecting the same
  // native OpenAI records for PromptLayer's trace export.
  return {
    promptLayerLoggerProvider,
    loggerProvider: {
      getLogger(
        name: string,
        version?: string,
        options?: LoggerOptions
      ): Logger {
        const promptLayerLogger =
          promptLayerLoggerProvider.getLogger(
            name,
            version,
            options
          );
        const delegateLogger = delegate.getLogger(
          name,
          version,
          options
        );
        return {
          emit(record: LogRecord): void {
            promptLayerLogger.emit(record);
            delegateLogger.emit(record);
          },
          enabled(options): boolean {
            return (
              promptLayerLogger.enabled(options) ||
              delegateLogger.enabled(options)
            );
          },
        };
      },
    },
  };
};
