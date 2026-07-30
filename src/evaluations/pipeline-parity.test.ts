import { describe, expect, it, vi } from "vitest";
import { PromptLayerValidationError } from "@/errors";
import { extractLastAssistantMessage } from "./trace-output";
import { assertNotStreamResult, flushTraces } from "./tracing";
import { assertPassingScore } from "./validation";
import { scorerValueFailed } from "./scores";
import {
  buildRowValues,
  casesFromRows,
  columnsByTitle,
  customFieldTitles,
  normalizeEvalCases,
} from "./utils";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

describe("extractLastAssistantMessage", () => {
  it("returns the chronologically last OpenAI chat assistant message", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      children: [
        {
          name: "llm-1",
          start: "2024-01-01T00:00:01Z",
          request_log: {
            request_response: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "first reply",
                  },
                },
              ],
            },
          },
          children: [],
        },
        {
          name: "llm-2",
          start: "2024-01-01T00:00:02Z",
          request_log: {
            request_response: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "final reply",
                  },
                },
              ],
            },
          },
          children: [],
        },
      ],
    };
    expect(extractLastAssistantMessage(trace)).toBe("final reply");
  });

  it("normalizes OpenAI tool_calls on assistant messages", () => {
    const toolCalls = [
      {
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: '{"q": "x"}' },
      },
    ];
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      children: [
        {
          name: "llm",
          start: "2024-01-01T00:00:01Z",
          request_log: {
            request_response: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "looking that up",
                    tool_calls: toolCalls,
                  },
                },
              ],
            },
          },
          children: [],
        },
      ],
    };
    expect(extractLastAssistantMessage(trace)).toEqual({
      content: "looking that up",
      tool_calls: toolCalls,
    });
  });

  it("parses JSON assistant text", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        request_response: {
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"answer": 42, "ok": true}',
              },
            },
          ],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toEqual({
      answer: 42,
      ok: true,
    });
  });

  it("extracts Anthropic message blocks", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        request_response: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "hello from anthropic" }],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toBe("hello from anthropic");
  });

  it("normalizes Anthropic tool_use blocks", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        request_response: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "calling tool" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "lookup",
              input: { q: "x" },
            },
          ],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toEqual({
      content: "calling tool",
      tool_calls: [
        {
          id: "toolu_1",
          type: "function",
          function: { name: "lookup", arguments: '{"q":"x"}' },
        },
      ],
    });
  });

  it("extracts OpenAI Responses API message output", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        request_response: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "from responses" }],
            },
          ],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toBe("from responses");
  });

  it("normalizes OpenAI Responses function_call items", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        request_response: {
          output: [
            {
              type: "function_call",
              call_id: "call_abc",
              name: "get_weather",
              arguments: '{"city":"NYC"}',
            },
          ],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toEqual({
      content: null,
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"city":"NYC"}',
          },
        },
      ],
    });
  });

  it("falls back to function_kwargs.messages assistant content", () => {
    const trace = {
      name: "root",
      start: "2024-01-01T00:00:00Z",
      request_log: {
        function_kwargs: {
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "from kwargs" },
          ],
        },
      },
      children: [],
    };
    expect(extractLastAssistantMessage(trace)).toBe("from kwargs");
  });
});

describe("stream rejection", () => {
  it("rejects sync generators from eval runners", () => {
    function* syncGen() {
      yield "chunk";
    }
    expect(() => assertNotStreamResult(syncGen())).toThrow(
      PromptLayerValidationError
    );
    expect(() => assertNotStreamResult(syncGen())).toThrow(/returned a stream/);
  });

  it("allows plain values", () => {
    expect(assertNotStreamResult("ok")).toBe("ok");
  });
});

describe("flushTraces", () => {
  it("treats forceFlush false as failure and warns by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = {
      forceFlush: vi.fn().mockResolvedValue(false),
    } as unknown as NodeTracerProvider;

    await expect(flushTraces(provider)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Failed to flush eval traces/);

    await expect(flushTraces(provider, true)).rejects.toThrow(
      /did not flush before the deadline/
    );
    warn.mockRestore();
  });

  it("rethrows when throwOnError is true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = {
      forceFlush: vi.fn().mockRejectedValue(new Error("flush failed")),
    } as unknown as NodeTracerProvider;

    await expect(flushTraces(provider)).resolves.toBeUndefined();
    await expect(flushTraces(provider, true)).rejects.toThrow("flush failed");
    warn.mockRestore();
  });
});

describe("assertPassingScore / failed cells", () => {
  it("fails on FAILED scorer cells even without a threshold", () => {
    expect(() =>
      assertPassingScore({ aggregate_score: 1 }, undefined, {
        result: {
          name: "demo",
          tableId: "t",
          sheetId: "s",
          failedRowIndices: [],
          scoreCards: [],
          totalRows: 1,
          results: [
            {
              input: "x",
              expected: null,
              output: "y",
              scores: { quality: { status: "FAILED", error: "boom" } },
              traceId: null,
              spanId: null,
              rowIndex: 3,
            },
          ],
        },
      })
    ).toThrow(/scorecard evaluators failed to execute/);
  });

  it("matches Python failed-value semantics", () => {
    expect(scorerValueFailed(false)).toBe(true);
    expect(scorerValueFailed(0)).toBe(true);
    expect(scorerValueFailed({ status: "FAILED" })).toBe(true);
    expect(scorerValueFailed({ comparison_result: false })).toBe(true);
    expect(scorerValueFailed({ comparison_result: true })).toBe(false);
    expect(scorerValueFailed({ value: false })).toBe(true);
  });
});

describe("expectedTrace round-trip", () => {
  it("persists and reloads exact dataset column titles through row helpers", () => {
    const columns = [
      { id: "i", title: "input", type: "TEXT" as const },
      { id: "e", title: "expected", type: "TEXT" as const },
      { id: "et", title: "expectedTrace", type: "TEXT" as const },
      { id: "o", title: "Output", type: "TEXT" as const },
    ];
    const byTitle = columnsByTitle(columns);
    const expectedTrace = {
      accepted_scenarios: [{ required_tools: ["search"] }],
    };
    const values = buildRowValues(byTitle, {
      inputValue: "q",
      expectedValue: "a",
      expectedTraceValue: expectedTrace,
      outputValue: "out",
    });
    expect(values.et).toBe(JSON.stringify(expectedTrace));

    const cases = casesFromRows(
      {
        data: [
          {
            row_index: 0,
            cells: {
              i: { value: "q" },
              e: { value: "a" },
              et: { value: JSON.stringify(expectedTrace) },
            },
          },
        ],
      },
      columns
    );
    expect(cases).toEqual([
      { input: "q", expected: "a", expectedTrace },
    ]);
  });

  it("reads and writes legacy titled columns and expected_trace rows", () => {
    const columns = [
      { id: "i", title: "Input", type: "TEXT" as const },
      { id: "e", title: "Expected", type: "TEXT" as const },
      { id: "et", title: "Expected Trace", type: "TEXT" as const },
    ];
    const values = buildRowValues(columnsByTitle(columns), {
      inputValue: "q",
      expectedValue: "a",
      expectedTraceValue: ["search"],
      outputValue: undefined,
    });
    expect(values).toEqual({
      i: "q",
      e: "a",
      et: JSON.stringify(["search"]),
    });
    expect(
      casesFromRows(
        { data: [{ row_index: 0, input: "q", expected_trace: ["search"] }] },
        []
      )
    ).toEqual([{ input: "q", expectedTrace: ["search"] }]);
  });
});

describe("arbitrary eval dataset fields", () => {
  it("keeps a stable first-seen union and cannot collide with a user fields key", () => {
    const cases = normalizeEvalCases([
      { input: "one", fields: "literal", Topic: "math" },
      { input: "two", Locale: "fr", Topic: "science" },
    ]);

    expect(customFieldTitles(cases)).toEqual(["fields", "Topic", "Locale"]);
    expect(cases[0].customFields).toEqual({
      fields: "literal",
      Topic: "math",
    });
  });

  it("writes sparse custom fields as blank exact-title TEXT cells", () => {
    const byTitle = columnsByTitle([
      { id: "i", title: "input", type: "TEXT" },
      { id: "o", title: "Output", type: "TEXT" },
      { id: "topic", title: "Topic Name", type: "TEXT" },
      { id: "locale", title: "locale-code", type: "TEXT" },
    ]);

    expect(
      buildRowValues(byTitle, {
        inputValue: "q",
        expectedValue: undefined,
        expectedTraceValue: undefined,
        outputValue: "a",
        customFields: { "Topic Name": "science" },
        customFieldTitles: ["Topic Name", "locale-code"],
      })
    ).toMatchObject({ topic: "science", locale: "" });
  });

  it("loads only non-reserved, non-generated TEXT fields from table rows", () => {
    const cases = casesFromRows(
      {
        data: [
          {
            row_index: 0,
            cells: {
              i: { value: "q" },
              custom: { value: "gold" },
              generated: { value: "skip-output" },
              computed: { value: "skip-computed" },
              trace: { value: "skip-trace" },
            },
          },
        ],
      },
      [
        { id: "i", title: "input", type: "TEXT" },
        { id: "custom", title: "Human Label", type: "TEXT" },
        {
          id: "generated",
          title: "Generated",
          type: "TEXT",
          is_output_column: true,
        },
        { id: "computed", title: "Computed", type: "JSON_PATH" },
        { id: "trace", title: "Trace", type: "TEXT" },
      ]
    );

    expect(cases).toEqual([{ input: "q", "Human Label": "gold" }]);
  });
});
