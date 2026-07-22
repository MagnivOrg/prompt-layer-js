/**
 * Helpers for PromptLayer.run() span attributes.
 * Mirrors Python promptlayer.promptlayer (_format_run_output, _is_stream_result).
 */

const formatValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Prefer prompt_blueprint string over full result / raw_response (Python `_format_run_output`). */
export const formatRunOutput = (result: unknown): string => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return formatValue(result);
  }
  const record = result as Record<string, unknown>;
  if (record.prompt_blueprint != null) {
    return formatValue(record.prompt_blueprint);
  }
  if (record.raw_response != null) {
    return formatValue(record.raw_response);
  }
  return formatValue(result);
};

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
