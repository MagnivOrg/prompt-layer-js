/**
 * Helpers for lightweight PromptLayer.run() tracing.
 */

import * as opentelemetry from "@opentelemetry/api";

/** Detect sync/async generators and other stream-like results (Python `_is_stream_result`). */
export const isStreamResult = (value: unknown): boolean => {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object Generator]" || tag === "[object AsyncGenerator]") {
    return true;
  }
  const record = value as Record<PropertyKey, unknown>;
  // Sync generator objects expose next/throw/return + Symbol.iterator.
  if (
    typeof record.next === "function" &&
    typeof record.throw === "function" &&
    typeof record.return === "function" &&
    typeof record[Symbol.iterator] === "function" &&
    typeof record[Symbol.asyncIterator] !== "function"
  ) {
    return true;
  }
  return (
    typeof record[Symbol.asyncIterator] === "function" ||
    typeof record.pipe === "function" ||
    typeof record.getReader === "function"
  );
};

export const runSpanAttributes = (
  promptName: string,
  promptVersion: number | undefined,
  promptReleaseLabel: string | undefined,
  metadata: Record<string, string> | undefined,
  sdkVersion: string
): opentelemetry.Attributes => {
  const attributes: opentelemetry.Attributes = {
    node_type: "CODE_EXECUTION",
    prompt_name: promptName,
    "promptlayer.prompt.name": promptName,
    "promptlayer.telemetry.source": "promptlayer-js",
    "promptlayer.telemetry.source_version": sdkVersion,
  };

  if (promptVersion !== undefined) {
    attributes["promptlayer.prompt.version"] =
      String(promptVersion);
  }
  if (promptReleaseLabel !== undefined) {
    attributes["promptlayer.prompt.label"] =
      promptReleaseLabel;
  }

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!key) continue;
    attributes[`promptlayer.metadata.${key}`] = value;
  }

  return attributes;
};

export const recordSpanError = (
  span: opentelemetry.Span,
  error: unknown
): void => {
  const exception =
    error instanceof Error ? error : new Error(String(error));
  try {
    span.setAttribute("error.type", exception.name || "Error");
    span.recordException(exception);
    span.setStatus({
      code: opentelemetry.SpanStatusCode.ERROR,
      message: exception.message,
    });
  } catch {
    // Telemetry must never change PromptLayer SDK behavior.
  }
};
