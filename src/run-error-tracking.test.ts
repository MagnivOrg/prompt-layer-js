import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock modules before importing the subject
vi.mock("@/utils/utils", () => ({
  trackRequest: vi.fn().mockResolvedValue({ request_id: 1, prompt_blueprint: {} }),
  configureProviderSettings: vi.fn().mockReturnValue({
    provider_type: "openai",
    kwargs: { model: "gpt-4" },
  }),
  getProviderConfig: vi.fn().mockReturnValue({
    function_name: "openai.chat.completions.create",
    stream_function: null,
  }),
  openaiRequest: vi.fn().mockResolvedValue({ choices: [{ message: { content: "hi" } }] }),
  anthropicRequest: vi.fn(),
  azureOpenAIRequest: vi.fn(),
  googleRequest: vi.fn(),
  mistralRequest: vi.fn(),
  vertexaiRequest: vi.fn(),
  amazonBedrockRequest: vi.fn(),
  anthropicBedrockRequest: vi.fn(),
  readEnv: vi.fn().mockReturnValue("test-api-key"),
  runWorkflowRequest: vi.fn(),
  utilLogRequest: vi.fn(),
}));

vi.mock("@/templates", () => {
  return {
    TemplateManager: class {
      get = vi.fn().mockResolvedValue({
        id: 1,
        version: 1,
        prompt_template: { type: "chat", messages: [] },
        metadata: { model: { provider: "openai", name: "gpt-4", parameters: {} } },
        llm_kwargs: { model: "gpt-4" },
        custom_provider: null,
      });
    },
  };
});

vi.mock("@/tracing", () => {
  const fakeSpan = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ spanId: "test-span-id" }),
  };
  return {
    getTracer: () => ({
      startActiveSpan: (_name: string, fn: (span: any) => any) => fn(fakeSpan),
    }),
    setupTracing: vi.fn(),
  };
});

vi.mock("@/groups", () => ({
  GroupManager: class {},
}));

vi.mock("@/track", () => ({
  TrackManager: class {},
}));

vi.mock("@/span-wrapper", () => ({
  wrapWithSpan: vi.fn(),
}));

vi.mock("@/utils/streaming", () => ({
  streamResponse: vi.fn().mockReturnValue({ async *[Symbol.asyncIterator]() {} }),
}));

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
      429, undefined, "Too Many Requests", undefined
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
