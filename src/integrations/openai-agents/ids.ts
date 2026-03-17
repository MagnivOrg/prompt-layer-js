import { createHash } from "crypto";

const TRACE_HEX_RE = /^[0-9a-f]{32}$/i;

const sha256Hex = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

export const mapTraceId = (originalTraceId: string): string => {
  const suffix = originalTraceId.startsWith("trace_")
    ? originalTraceId.slice("trace_".length)
    : originalTraceId;

  if (TRACE_HEX_RE.test(suffix)) {
    return suffix.toLowerCase();
  }

  return sha256Hex(originalTraceId).slice(0, 32);
};

export const mapSpanId = (originalSpanId: string): string => {
  return sha256Hex(originalSpanId).slice(0, 16);
};

export const syntheticRootSpanId = (originalTraceId: string): string => {
  return sha256Hex(`${originalTraceId}:root`).slice(0, 16);
};
