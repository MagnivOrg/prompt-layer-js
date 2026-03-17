import { describe, expect, it } from "vitest";

import {
  mapSpanId,
  mapTraceId,
  syntheticRootSpanId,
} from "@/integrations/openai-agents/ids";
import {
  normalizeMessages,
  normalizeResponseItems,
  OTLP_STATUS_CODE_ERROR,
  OTLP_STATUS_CODE_OK,
  spanDataAttributes,
} from "@/integrations/openai-agents/mapping";
import { buildOtlpJsonPayload } from "@/integrations/openai-agents/otlp-json";
import { isoToUnixNano } from "@/integrations/openai-agents/time";

describe("openai agents ids", () => {
  it("strips a valid trace_ prefix", () => {
    expect(
      mapTraceId("trace_0AF7651916CD43DD8448EB211C80319C")
    ).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("hashes nonstandard trace ids", () => {
    expect(mapTraceId("trace_not_standard")).toHaveLength(32);
    expect(mapTraceId("trace_not_standard")).toBe(
      mapTraceId("trace_not_standard")
    );
  });

  it("hashes span ids to 16 hex chars", () => {
    expect(mapSpanId("span_123")).toHaveLength(16);
    expect(mapSpanId("span_123")).toBe(mapSpanId("span_123"));
  });

  it("derives a deterministic synthetic root id", () => {
    expect(syntheticRootSpanId("trace_123")).toHaveLength(16);
    expect(syntheticRootSpanId("trace_123")).toBe(
      syntheticRootSpanId("trace_123")
    );
  });
});

describe("openai agents time conversion", () => {
  it("converts ISO timestamps with nanoseconds", () => {
    expect(isoToUnixNano("2026-03-17T14:15:16.123456789Z")).toBe(
      "1773756916123456789"
    );
  });

  it("converts timestamps with timezone offsets", () => {
    expect(isoToUnixNano("2026-03-17T09:15:16.987-05:00")).toBe(
      "1773756916987000000"
    );
  });
});

describe("openai agents mapping", () => {
  it("normalizes message tool calls", () => {
    expect(
      normalizeMessages([
        {
          role: "assistant",
          content: "Calling weather",
          tool_calls: [
            {
              id: "call_1",
              function: {
                name: "weather",
                arguments: "{\"city\":\"Tokyo\"}",
              },
            },
          ],
        },
      ])
    ).toEqual([
      {
        role: "assistant",
        content: "Calling weather",
        tool_calls: [
          {
            id: "call_1",
            type: "tool_call",
            name: "weather",
            arguments: { city: "Tokyo" },
          },
        ],
      },
    ]);
  });

  it("normalizes tool calls and tool results in response input history", () => {
    expect(
      normalizeResponseItems([
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
          output: "{\"temp_c\":20,\"condition\":\"Sunny\"}",
        },
        {
          type: "tool_call_output_item",
          rawItem: {
            type: "function_call_result",
            callId: "call_weather_json",
          },
          output: { tempC: 20, condition: "Sunny" },
        },
        {
          type: "function_call_result",
          callId: "call_translate",
          output: {
            type: "text",
            text: "- Hello: Hola\n- Thank you: Gràcies",
          },
        },
      ])
    ).toEqual([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_weather",
            type: "tool_call",
            name: "weather_lookup",
            arguments: { city: "Barcelona" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_weather",
        content: "{\"temp_c\":20,\"condition\":\"Sunny\"}",
      },
      {
        role: "tool",
        tool_call_id: "call_weather_json",
        content: "{\"condition\":\"Sunny\",\"tempC\":20}",
      },
      {
        role: "tool",
        tool_call_id: "call_translate",
        content: "- Hello: Hola\n- Thank you: Gràcies",
      },
    ]);
  });

  it("maps generation data to canonical attrs", () => {
    const attrs = spanDataAttributes(
      {
        type: "generation",
        model: "gpt-4.1",
        input: [{ role: "user", content: "Hello" }],
        output: [{ role: "assistant", content: "Hi" }],
        usage: { input_tokens: 3, output_tokens: 5 },
        model_config: { temperature: 0.2 },
      },
      true
    );

    expect(attrs["gen_ai.provider.name"]).toBe("openai.responses");
    expect(attrs["gen_ai.request.model"]).toBe("gpt-4.1");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(3);
    expect(attrs["gen_ai.usage.output_tokens"]).toBe(5);
    expect(attrs["gen_ai.prompt.0.role"]).toBe("user");
    expect(attrs["gen_ai.completion.0.content"]).toBe("Hi");
    expect(attrs["openai_agents.model_config_json"]).toBe(
      "{\"temperature\":0.2}"
    );
  });

  it("keeps function spans namespaced", () => {
    const attrs = spanDataAttributes(
      {
        type: "function",
        name: "weather",
        input: "{\"city\":\"Tokyo\"}",
        output: "72 and sunny",
        mcp_data: "{\"server\":\"mcp\"}",
      },
      true
    );

    expect(attrs.node_type).toBe("CODE_EXECUTION");
    expect(attrs.tool_name).toBe("weather");
    expect(attrs["openai_agents.function.name"]).toBe("weather");
    expect(attrs["gen_ai.provider.name"]).toBeUndefined();
  });

  it("preserves unsupported span types as raw json", () => {
    const attrs = spanDataAttributes(
      {
        type: "speech_group",
        input: "hello",
      } as any,
      true
    );

    expect(attrs["openai_agents.raw_json"]).toBe(
      "{\"input\":\"hello\",\"type\":\"speech_group\"}"
    );
  });
});

describe("openai agents otlp json", () => {
  it("serializes OTLP spans in backend-compatible JSON", () => {
    const payload = buildOtlpJsonPayload([
      {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "00f067aa0ba902b7",
        name: "Generation",
        kind: 3,
        startTimeUnixNano: "1630000000000000000",
        endTimeUnixNano: "1630000001000000000",
        attributes: {
          "gen_ai.request.model": "gpt-4.1",
          "gen_ai.usage.input_tokens": 3,
          "gen_ai.usage.output_tokens": 5,
        },
        status: {
          code: OTLP_STATUS_CODE_OK,
        },
        events: [
          {
            name: "exception",
            timeUnixNano: "1630000001000000000",
            attributes: {
              "exception.type": "OpenAIAgentsError",
            },
          },
        ],
      },
    ]);

    const span = payload.resourceSpans[0].scopeSpans[0].spans[0] as any;
    expect(span.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(span.status.code).toBe(OTLP_STATUS_CODE_OK);
    expect(span.events[0].name).toBe("exception");
    expect(span.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "gen_ai.request.model" }),
      ])
    );
  });
});
