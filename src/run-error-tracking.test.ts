import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import "@/test-fixtures/setup-promptlayer-run-mocks";
import { PromptLayer } from "@/index";
import { trackRequest, openaiRequest } from "@/utils/utils";
import { RateLimitError } from "openai";

describe("run() error tracking", () => {
  let client: PromptLayer;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PromptLayer({ apiKey: "test-api-key" });
  });

  it("tracks error with UNKNOWN_ERROR type and re-throws when LLM call fails", async () => {
    const llmError = new Error("model overloaded");
    (openaiRequest as Mock).mockRejectedValueOnce(llmError);

    await expect(
      client.run({ promptName: "test-prompt" })
    ).rejects.toThrow("model overloaded");

    expect(trackRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_response: {},
        status: "ERROR",
        error_type: "UNKNOWN_ERROR",
        error_message: "model overloaded",
      }),
      true
    );
  });

  it("tracks PROVIDER_RATE_LIMIT when LLM throws RateLimitError", async () => {
    const rateLimitError = new RateLimitError(
      429,
      undefined,
      "Too Many Requests",
      undefined
    );
    (openaiRequest as Mock).mockRejectedValueOnce(rateLimitError);

    await expect(
      client.run({ promptName: "test-prompt" })
    ).rejects.toThrow("Too Many Requests");

    expect(trackRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_response: {},
        status: "ERROR",
        error_type: "PROVIDER_RATE_LIMIT",
        error_message: expect.stringContaining("Too Many Requests"),
      }),
      true
    );
  });

  it("calls trackRequest without error fields on success", async () => {
    const successResponse = { choices: [{ message: { content: "hello" } }] };
    (openaiRequest as Mock).mockResolvedValueOnce(successResponse);

    await client.run({ promptName: "test-prompt" });

    expect(trackRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_response: successResponse,
      }),
      true
    );

    const callArgs = (trackRequest as Mock).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("error_type");
    expect(callArgs).not.toHaveProperty("error_message");
    expect(callArgs).not.toHaveProperty("status");
  });
});
