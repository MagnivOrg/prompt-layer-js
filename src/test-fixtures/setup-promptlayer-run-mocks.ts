import { vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  fakeSpan: {
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ spanId: "test-span-id" }),
  },
}));

export const fakeSpan = hoisted.fakeSpan;

vi.mock("@/utils/utils", () => ({
  SDK_VERSION: "test-version",
  trackRequest: vi.fn().mockResolvedValue({
    request_id: 1,
    prompt_blueprint: { messages: [{ role: "assistant", content: "ok" }] },
  }),
  configureProviderSettings: vi.fn().mockReturnValue({
    provider_type: "openai",
    kwargs: { model: "gpt-4" },
  }),
  getProviderConfig: vi.fn().mockReturnValue({
    function_name: "openai.chat.completions.create",
    stream_function: null,
  }),
  openaiRequest: vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content: "hi" } }] }),
  openrouterRequest: vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content: "hi" } }] }),
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

vi.mock("@/templates", () => ({
  TemplateManager: class {
    get = vi.fn().mockResolvedValue({
      id: 1,
      version: 1,
      prompt_template: { type: "chat", messages: [] },
      metadata: {
        model: { provider: "openai", name: "gpt-4", parameters: {} },
      },
      llm_kwargs: { model: "gpt-4" },
      custom_provider: null,
    });
  },
}));

vi.mock("@/tracing", () => ({
  getTracer: () => ({
    startActiveSpan: (...args: unknown[]) => {
      const fn = args.at(-1) as (
        span: typeof hoisted.fakeSpan
      ) => unknown;
      return fn(hoisted.fakeSpan);
    },
  }),
  setupTracing: vi.fn(),
  withPromptLayerProviderRequestContext: (
    _value: unknown,
    callback: () => unknown
  ) => callback(),
}));

vi.mock("@/groups", () => ({ GroupManager: class {} }));
vi.mock("@/track", () => ({ TrackManager: class {} }));
vi.mock("@/span-wrapper", () => ({ wrapWithSpan: vi.fn(), traceTool: vi.fn() }));
