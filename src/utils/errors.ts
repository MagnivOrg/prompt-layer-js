// Node/undici error codes for a transport-level connection reset or close.
const CONNECTION_RESET_CODES = new Set([
  "ECONNRESET",
  "UND_ERR_SOCKET",
  "ETIMEDOUT",
  "EPIPE",
]);

const CONNECTION_RESET_MESSAGES = [
  "socket hang up",
  "other side closed",
  "terminated",
  "econnreset",
  "und_err_socket",
  "premature close",
  "network socket disconnected",
];

/**
 * Returns true when the error is a transport-level connection reset. Checks the
 * error's `code`, a wrapped `cause.code` (how undici surfaces socket errors),
 * then falls back to known error messages.
 */
export function isConnectionResetError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as { code?: unknown; cause?: unknown; message?: unknown };

  if (typeof err.code === "string" && CONNECTION_RESET_CODES.has(err.code)) {
    return true;
  }

  const cause = err.cause as { code?: unknown } | undefined;
  if (
    cause &&
    typeof cause.code === "string" &&
    CONNECTION_RESET_CODES.has(cause.code)
  ) {
    return true;
  }

  const message =
    typeof err.message === "string" ? err.message.toLowerCase() : "";
  return CONNECTION_RESET_MESSAGES.some((needle) => message.includes(needle));
}

export enum ErrorType {
  PROVIDER_RATE_LIMIT = "PROVIDER_RATE_LIMIT",
  PROVIDER_QUOTA_LIMIT = "PROVIDER_QUOTA_LIMIT",
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",
  PROVIDER_AUTH_ERROR = "PROVIDER_AUTH_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

function getStatusCode(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as any).status === "number"
  ) {
    return (error as any).status;
  }
  return undefined;
}

function getClassName(error: unknown): string {
  if (error && typeof error === "object" && error.constructor) {
    return error.constructor.name;
  }
  return "";
}

export function categorizeError(error: unknown): ErrorType {
  const statusCode = getStatusCode(error);
  const className = getClassName(error);
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (statusCode === 429 || /ratelimit/i.test(className)) {
    return ErrorType.PROVIDER_RATE_LIMIT;
  }

  if (/timeout/i.test(className)) {
    return ErrorType.PROVIDER_TIMEOUT;
  }

  if (statusCode === 401 || /authentication/i.test(className)) {
    return ErrorType.PROVIDER_AUTH_ERROR;
  }

  if (message.includes("quota")) {
    return ErrorType.PROVIDER_QUOTA_LIMIT;
  }

  if (message.includes("timeout") || message.includes("timed out")) {
    return ErrorType.PROVIDER_TIMEOUT;
  }

  if (statusCode !== undefined) {
    return ErrorType.PROVIDER_ERROR;
  }

  return ErrorType.UNKNOWN_ERROR;
}
