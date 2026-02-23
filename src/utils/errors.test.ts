import { describe, it, expect } from "vitest";
import { categorizeError, ErrorType } from "@/utils/errors";
import {
  RateLimitError,
  AuthenticationError,
  APIConnectionTimeoutError,
  BadRequestError,
  InternalServerError,
} from "openai";

describe("categorizeError", () => {
  // Branch: statusCode === 429 (+ className matches /ratelimit/i)
  it("returns PROVIDER_RATE_LIMIT for OpenAI RateLimitError", () => {
    const err = new RateLimitError(429, undefined, "Rate limit exceeded", undefined);
    expect(categorizeError(err)).toBe(ErrorType.PROVIDER_RATE_LIMIT);
  });

  // Branch: className matches /timeout/i
  it("returns PROVIDER_TIMEOUT for OpenAI APIConnectionTimeoutError", () => {
    const err = new APIConnectionTimeoutError({ message: "Request timed out." });
    expect(categorizeError(err)).toBe(ErrorType.PROVIDER_TIMEOUT);
  });

  // Branch: statusCode === 401 (+ className matches /authentication/i)
  it("returns PROVIDER_AUTH_ERROR for OpenAI AuthenticationError", () => {
    const err = new AuthenticationError(401, undefined, "Invalid API key", undefined);
    expect(categorizeError(err)).toBe(ErrorType.PROVIDER_AUTH_ERROR);
  });

  // Branch: message includes "quota"
  it("returns PROVIDER_QUOTA_LIMIT when message contains quota", () => {
    expect(categorizeError(new Error("You exceeded your quota"))).toBe(
      ErrorType.PROVIDER_QUOTA_LIMIT
    );
  });

  // Branch: message includes "timeout"
  it("returns PROVIDER_TIMEOUT when message contains timeout", () => {
    expect(categorizeError(new Error("Request timeout"))).toBe(
      ErrorType.PROVIDER_TIMEOUT
    );
  });

  // Branch: message includes "timed out"
  it("returns PROVIDER_TIMEOUT when message contains timed out", () => {
    expect(categorizeError(new Error("Connection timed out"))).toBe(
      ErrorType.PROVIDER_TIMEOUT
    );
  });

  // Branch: statusCode defined but no earlier match → PROVIDER_ERROR
  it("returns PROVIDER_ERROR for OpenAI InternalServerError", () => {
    const err = new InternalServerError(500, undefined, "Internal server error", undefined);
    expect(categorizeError(err)).toBe(ErrorType.PROVIDER_ERROR);
  });

  // Branch: fallthrough — no status, no matching class/message
  it("returns UNKNOWN_ERROR for a plain Error", () => {
    expect(categorizeError(new Error("something broke"))).toBe(
      ErrorType.UNKNOWN_ERROR
    );
  });

  // Branch: non-Error thrown → String(error) path, getClassName returns ""
  it("returns UNKNOWN_ERROR for a non-Error value", () => {
    expect(categorizeError("oops")).toBe(ErrorType.UNKNOWN_ERROR);
  });
});
