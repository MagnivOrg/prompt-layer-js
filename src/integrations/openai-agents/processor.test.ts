import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/utils", async () => {
  const actual = await vi.importActual<typeof import("@/utils/utils")>(
    "@/utils/utils"
  );

  return {
    ...actual,
    fetchWithRetry: vi.fn(),
    getCommonHeaders: vi.fn(() => ({
      "User-Agent": "promptlayer-js/test",
      "X-SDK-Version": "test-version",
    })),
  };
});

import { mapSpanId } from "@/integrations/openai-agents/ids";
import { PromptLayerOpenAIAgentsProcessor } from "@/integrations/openai-agents/processor";
import { fetchWithRetry } from "@/utils/utils";

const fetchWithRetryMock = vi.mocked(fetchWithRetry);

const keyValuesToObject = (keyValues: Array<{ key: string; value: any }>) => {
  return Object.fromEntries(
    keyValues.map((entry) => [
      entry.key,
      entry.value.stringValue ??
        entry.value.boolValue ??
        entry.value.intValue ??
        entry.value.doubleValue,
    ])
  );
};

describe("PromptLayerOpenAIAgentsProcessor", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports a finished generation trace as OTLP JSON", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_0af7651916cd43dd8448eb211c80319c",
      name: "Support workflow",
      groupId: "group_123",
      metadata: {
        customer_id: "cust_123",
        nested: { ignored: true },
      },
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_generation_123",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: trace.metadata,
      spanData: {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
        usage: { input_tokens: 3, output_tokens: 5 },
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      "https://api.promptlayer.dev/v1/traces",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-KEY": "pl_test",
          "X-PromptLayer-Integration": "openai-agents-js",
          "X-SDK-Version": "test-version",
        }),
      })
    );

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;

    expect(spans).toHaveLength(2);

    const generationSpan = spans.find((item: any) => item.name === "Generation");
    expect(generationSpan).toBeDefined();

    const attrs = keyValuesToObject(generationSpan.attributes);
    expect(attrs["gen_ai.provider.name"]).toBe("openai.responses");
    expect(attrs["gen_ai.request.model"]).toBe("gpt-4.1");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe("3");
    expect(attrs["gen_ai.usage.output_tokens"]).toBe("5");
    expect(attrs["promptlayer.telemetry.source"]).toBe("openai-agents-js");
  });

  it("records error status and exception events", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_0af7651916cd43dd8448eb211c80319c",
      name: "Errored workflow",
      groupId: null,
      metadata: {},
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_function_123",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: {
        message: "rate limit exceeded",
      },
      traceMetadata: {},
      spanData: {
        type: "function",
        name: "weather",
        input: "{\"city\":\"Tokyo\"}",
        output: "",
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const functionSpan = payload.resourceSpans[0].scopeSpans[0].spans.find(
      (item: any) => item.name === "Function: weather"
    );

    expect(functionSpan.status).toEqual({
      code: 2,
      message: "rate limit exceeded",
    });
    expect(functionSpan.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "exception",
        }),
      ])
    );
  });

  it("exports response spans with canonical response attributes", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_0af7651916cd43dd8448eb211c80319c",
      name: "Response workflow",
      groupId: null,
      metadata: {},
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_response_123",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: {},
      spanData: {
        type: "response",
        response_id: "resp_123",
        _input: [
          { role: "user", content: "Hello" },
          {
            type: "function_call",
            call_id: "call_weather",
            name: "weather_lookup",
            arguments: "{\"city\":\"Barcelona\"}",
          },
          {
            type: "tool_call_output_item",
            rawItem: {
              type: "function_call_result",
              callId: "call_weather",
            },
            output: {
              type: "text",
              text: "{\"temp_c\":20,\"condition\":\"Sunny\"}",
            },
          },
        ],
        _response: {
          object: "response",
          id: "resp_123",
          model: "gpt-4.1",
          usage: { input_tokens: 3, output_tokens: 5 },
          output: [{ role: "assistant", content: [{ type: "output_text", text: "Hi" }] }],
        },
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const responseSpan = payload.resourceSpans[0].scopeSpans[0].spans.find(
      (item: any) => item.name === "Response"
    );
    const attrs = keyValuesToObject(responseSpan.attributes);

    expect(attrs["gen_ai.provider.name"]).toBe("openai.responses");
    expect(attrs["gen_ai.request.model"]).toBe("gpt-4.1");
    expect(attrs["gen_ai.response.model"]).toBe("gpt-4.1");
    expect(attrs["gen_ai.response.id"]).toBe("resp_123");
    expect(attrs["gen_ai.prompt.0.content"]).toBe("Hello");
    expect(attrs["gen_ai.prompt.1.tool_calls"]).toBe(
      "[{\"arguments\":{\"city\":\"Barcelona\"},\"id\":\"call_weather\",\"name\":\"weather_lookup\",\"type\":\"tool_call\"}]"
    );
    expect(attrs["gen_ai.prompt.2.role"]).toBe("tool");
    expect(attrs["gen_ai.prompt.2.tool_call_id"]).toBe("call_weather");
    expect(attrs["gen_ai.prompt.2.content"]).toBe(
      "{\"temp_c\":20,\"condition\":\"Sunny\"}"
    );
    expect(attrs["gen_ai.completion.0.content"]).toBe("Hi");
    expect(attrs["openai_agents.response.object"]).toBe("response");
  });

  it("preserves nested parent-child relationships in exported spans", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_0af7651916cd43dd8448eb211c80319c",
      name: "Nested workflow",
      groupId: null,
      metadata: {},
    } as any;
    const parentSpan = {
      traceId: trace.traceId,
      spanId: "span_parent_function",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:18.123456789Z",
      error: null,
      traceMetadata: {},
      spanData: {
        type: "function",
        name: "weather",
        input: "{\"city\":\"Tokyo\"}",
        output: "72 and sunny",
      },
    } as any;
    const childSpan = {
      traceId: trace.traceId,
      spanId: "span_child_custom",
      parentId: parentSpan.spanId,
      startedAt: "2026-03-17T14:15:17.123456789Z",
      endedAt: "2026-03-17T14:15:17.223456789Z",
      error: null,
      traceMetadata: {},
      spanData: {
        type: "custom",
        name: "child-work",
        data: { ok: true },
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(parentSpan);
    await processor.onSpanStart(childSpan);
    await processor.onSpanEnd(childSpan);
    await processor.onSpanEnd(parentSpan);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const exportedChild = payload.resourceSpans[0].scopeSpans[0].spans.find(
      (item: any) => item.name === "child-work"
    );

    expect(exportedChild.parentSpanId).toBe(mapSpanId(parentSpan.spanId));
  });

  it("uses traceparent metadata to parent the synthetic root", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Traceparent workflow",
      groupId: null,
      metadata: {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        tracestate: "vendor=value",
        tenant: "acme",
      },
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_generation_traceparent",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: trace.metadata,
      spanData: {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    const rootSpan = spans.find((item: any) => item.name === "Traceparent workflow");
    const generationSpan = spans.find((item: any) => item.name === "Generation");

    expect(rootSpan.traceId).toBe("11111111111111111111111111111111");
    expect(generationSpan.traceId).toBe("11111111111111111111111111111111");
    expect(rootSpan.parentSpanId).toBe("2222222222222222");
    expect(rootSpan.traceState).toBe("vendor=value");
    expect(generationSpan.traceState).toBe("vendor=value");

    const rootAttrs = keyValuesToObject(rootSpan.attributes);
    expect(rootAttrs["openai_agents.trace_id_original"]).toBe(
      "trace_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
  });

  it("recovers serialized trace metadata when the root trace callback is absent", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const span = {
      traceId: "trace_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      spanId: "span_generation_orphan",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: {
        workflow_name: "Recovered workflow",
        group_id: "group_456",
        metadata: {
          tenant: "acme",
        },
      },
      spanData: {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
      },
    } as any;
    const trace = {
      traceId: span.traceId,
      name: "Ignored root name",
      groupId: null,
      metadata: {},
    } as any;

    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const rootSpan = payload.resourceSpans[0].scopeSpans[0].spans.find(
      (item: any) => item.name === "Recovered workflow"
    );
    const rootAttrs = keyValuesToObject(rootSpan.attributes);

    expect(rootSpan).toBeDefined();
    expect(rootAttrs["openai_agents.group_id"]).toBe("group_456");
    expect(rootAttrs["openai_agents.metadata.tenant"]).toBe("acme");
  });

  it("keeps the agents trace id when traceparent metadata is absent", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_cccccccccccccccccccccccccccccccc",
      name: "No traceparent workflow",
      groupId: null,
      metadata: {
        tenant: "acme",
      },
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_generation_no_traceparent",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: trace.metadata,
      spanData: {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
      },
    } as any;

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);
    await processor.onTraceEnd(trace);

    const [, request] = fetchWithRetryMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    const rootSpan = payload.resourceSpans[0].scopeSpans[0].spans.find(
      (item: any) => item.name === "No traceparent workflow"
    );

    expect(rootSpan.traceId).toBe("cccccccccccccccccccccccccccccccc");
    expect(rootSpan.parentSpanId).toBeUndefined();
    expect(rootSpan.traceState).toBeUndefined();
  });

  it("does not throw on export failure and retries on forceFlush", async () => {
    const processor = new PromptLayerOpenAIAgentsProcessor({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });
    const trace = {
      traceId: "trace_0af7651916cd43dd8448eb211c80319c",
      name: "Retry workflow",
      groupId: null,
      metadata: {},
    } as any;
    const span = {
      traceId: trace.traceId,
      spanId: "span_generation_retry",
      parentId: null,
      startedAt: "2026-03-17T14:15:16.123456789Z",
      endedAt: "2026-03-17T14:15:17.123456789Z",
      error: null,
      traceMetadata: {},
      spanData: {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
        usage: { input_tokens: 3, output_tokens: 5 },
      },
    } as any;

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    fetchWithRetryMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

    await processor.onTraceStart(trace);
    await processor.onSpanStart(span);
    await processor.onSpanEnd(span);

    await expect(processor.onTraceEnd(trace)).resolves.toBeUndefined();
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);

    await processor.forceFlush();

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
