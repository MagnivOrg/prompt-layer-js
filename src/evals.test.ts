import {
  PromptLayer,
  codeExecutionColumn,
  column,
  containsScorer,
  trajectoryScorer,
} from "@/index";
import { EvaluationFailedError } from "@/errors";
import { getUrlString } from "@/test-helpers";
import {
  completedRow,
  createEvalFetchRouter,
  type EvalFetchRoute,
} from "@/test-fixtures/eval-fetch";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import * as evalUtils from "@/evaluations/utils";

describe("Eval runner", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(evalUtils, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("exposes evals on the client", () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    expect(client.evals).toBeDefined();
    expect(typeof client.evals.run).toBe("function");
  });

  it("rejects invalid table/folder/sheet combinations", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    await expect(
      client.evals.run({
        name: "bad",
        dataset: [{ input: "a" }],
        runner: () => "x",
        scorers: [containsScorer({ title: "c", source: "Output", value: "x" })],
        tableId: "1",
        folderId: 2,
      })
    ).rejects.toThrow(/folderId cannot be used together with tableId/);

    await expect(
      client.evals.run({
        name: "bad",
        dataset: [{ input: "a" }],
        runner: () => "x",
        scorers: [containsScorer({ title: "c", source: "Output", value: "x" })],
        sheetId: "1",
        experimentName: "exp",
      })
    ).rejects.toThrow(/sheetId is not supported/);
  });

  it("runs a batch eval end-to-end with mocked HTTP", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    fetchMock.mockImplementation(
      createEvalFetchRouter({
        tableTitle: "my-eval",
        overrides: (async (url: string, method: string, init?: RequestInit) => {
          if (url.endsWith("/api/public/v2/tables") && method === "GET") {
            return new Response(JSON.stringify({ success: true, data: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/sheets/s1/rows") && method === "POST") {
            return new Response(
              JSON.stringify({
                success: true,
                rows: [
                  completedRow(0, {
                    "c-input": { id: "cell-in", value: "hello" },
                    "c-expected": { id: "cell-ex", value: "hello" },
                    "c-output": { id: "cell-out", value: "hello" },
                  }),
                ],
                row_indices: [0],
              }),
              {
                status: 201,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          return undefined;
        }) satisfies EvalFetchRoute,
      })
    );

    const result = await client.evals.run({
      name: "my-eval",
      dataset: [{ input: "hello", expected: "hello" }],
      runner: (input) => input,
      scorers: [
        codeExecutionColumn("exact", {
          code: 'result = data.get("Output") === data.get("Expected") ? 1 : 0;',
        }),
      ],
    });

    expect(result.name).toBe("my-eval");
    expect(result.tableId).toBe("t1");
    expect(result.sheetId).toBe("s1");
    expect(result.scoreCards).toEqual([
      { scorer: "exact", passed: 1, total: 1, passRate: 1 },
    ]);
    expect(result).not.toHaveProperty("table");
    expect(result).not.toHaveProperty("sheet");
    expect(result).not.toHaveProperty("score");
    expect(result.totalRows).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].input).toBe("hello");
    expect(result.results[0].output).toBe("hello");
    expect(result.results[0].scores.exact).toBe(1);

    const scorecardPatchIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) =>
        getUrlString(input).endsWith("/sheets/s1/scorecard") &&
        (init?.method || "GET").toUpperCase() === "PATCH"
    );
    expect(scorecardPatchIndex).toBeGreaterThanOrEqual(0);
    const scorecardBody = JSON.parse(
      String(fetchMock.mock.calls[scorecardPatchIndex]?.[1]?.body)
    );
    expect(scorecardBody.steps[0].primitive_type).toBe("CODE_EXECUTION");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getUrlString(input).endsWith("/sheets/s1/score") &&
          (init?.method || "GET").toUpperCase() === "PATCH"
      )
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getUrlString(input).endsWith("/sheets/s1/columns") &&
          (init?.method || "GET").toUpperCase() === "POST" &&
          String(init?.body || "").includes("CODE_EXECUTION")
      )
    ).toBe(false);

    const rowPostIndex = fetchMock.mock.calls.findIndex(
      ([input, init]) =>
        getUrlString(input).includes("/sheets/s1/rows") &&
        (init?.method || "GET").toUpperCase() === "POST"
    );
    expect(rowPostIndex).toBeGreaterThanOrEqual(0);
    expect(scorecardPatchIndex).toBeLessThan(rowPostIndex);
  });

  it("creates and persists sparse custom fields before scorer dependencies", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    const { jsonResponse } = await import("@/test-helpers");
    const columns: Array<{ id: string; title: string; type: string }> = [];
    let rowBody: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(
      createEvalFetchRouter({
        rowCount: 2,
        overrides: (async (url: string, method: string, init?: RequestInit) => {
          if (url.endsWith("/sheets/s1/columns") && method === "GET") {
            return jsonResponse({ success: true, data: columns }, 200);
          }
          if (url.endsWith("/sheets/s1/columns") && method === "POST") {
            const body = JSON.parse(String(init?.body || "{}"));
            const ids: Record<string, string> = {
              Input: "c-input",
              Expected: "c-expected",
              "Topic Name": "c-topic",
              locale: "c-locale",
              Output: "c-output",
            };
            const column = {
              id: ids[body.title],
              title: body.title,
              type: body.type,
            };
            columns.push(column);
            return jsonResponse({ success: true, column }, 201);
          }
          if (url.endsWith("/sheets/s1/scorecard") && method === "PATCH") {
            const body = JSON.parse(String(init?.body || "{}"));
            expect(body.steps[0].source_column_ids).toContain("c-topic");
            expect(body.steps[0].primitive_config.source).toBe("c-topic");
            return undefined;
          }
          if (url.includes("/sheets/s1/rows") && method === "POST") {
            rowBody = JSON.parse(String(init?.body || "{}"));
            return jsonResponse(
              {
                success: true,
                rows: [
                  completedRow(0, {}),
                  completedRow(1, {}),
                ],
                row_indices: [0, 1],
              },
              201
            );
          }
          return undefined;
        }) satisfies EvalFetchRoute,
      })
    );

    await client.evals.run({
      name: "custom-fields",
      dataset: [
        { input: "one", "Topic Name": "science" },
        { input: "two", locale: "fr" },
      ],
      runner: (input) => input,
      scorers: [
        containsScorer({
          title: "topic-score",
          source: "Topic Name",
          value: "science",
        }),
      ],
      tableId: "t1",
    });

    expect(columns.map((item) => item.title)).toEqual([
      "Input",
      "Expected",
      "Topic Name",
      "locale",
      "Output",
    ]);
    expect(rowBody?.values).toEqual([
      expect.objectContaining({ "c-topic": "science", "c-locale": "" }),
      expect.objectContaining({ "c-topic": "", "c-locale": "fr" }),
    ]);
  });

  it("rejects custom fields that collide with reserved columns or aliases", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    for (const field of ["Output", "output", "Trace.price", "expected_trace"]) {
      await expect(
        client.evals.run({
          name: "reserved-field",
          dataset: [{ input: "a", [field]: "bad" }],
          runner: () => "x",
          scorers: [codeExecutionColumn("ok", { code: "result = 1;" })],
        })
      ).rejects.toThrow(/reserved eval column or alias/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates supporting columns, runs operations, then scorecard scoring", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    let createdExtract = false;
    const { jsonResponse } = await import("@/test-helpers");

    fetchMock.mockImplementation(
      createEvalFetchRouter({
        columns: [
          { id: "c-input", title: "Input", type: "TEXT" },
          { id: "c-expected", title: "Expected", type: "TEXT" },
          { id: "c-output", title: "Output", type: "TEXT" },
          ...(createdExtract
            ? [{ id: "c-extract", title: "Extracted data", type: "JSON_PATH" }]
            : []),
        ],
        overrides: (async (url: string, method: string, init?: RequestInit) => {
          if (url.endsWith("/api/public/v2/tables") && method === "GET") {
            return jsonResponse({ success: true, data: [] }, 200);
          }
          if (url.endsWith("/sheets/s1/columns") && method === "GET") {
            return jsonResponse(
              {
                success: true,
                data: [
                  { id: "c-input", title: "Input", type: "TEXT" },
                  { id: "c-expected", title: "Expected", type: "TEXT" },
                  { id: "c-output", title: "Output", type: "TEXT" },
                  ...(createdExtract
                    ? [
                        {
                          id: "c-extract",
                          title: "Extracted data",
                          type: "JSON_PATH",
                        },
                      ]
                    : []),
                ],
              },
              200
            );
          }
          if (url.endsWith("/sheets/s1/columns") && method === "POST") {
            const body = JSON.parse(String(init?.body || "{}"));
            if (body.title === "Extracted data") {
              createdExtract = true;
              return jsonResponse(
                {
                  success: true,
                  column: {
                    id: "c-extract",
                    title: "Extracted data",
                    type: "JSON_PATH",
                  },
                },
                201
              );
            }
          }
          if (url.includes("/sheets/s1/rows") && method === "POST") {
            return jsonResponse(
              {
                success: true,
                rows: [
                  completedRow(0, {
                    "c-input": { id: "cell-in", value: '{"a":1}' },
                    "c-expected": { id: "cell-ex", value: "1" },
                    "c-output": { id: "cell-out", value: '{"a":1}' },
                    "c-extract": { id: "cell-ex2", value: "1" },
                  }),
                ],
                row_indices: [0],
              },
              201
            );
          }
          if (url.endsWith("/sheets/s1/operations") && method === "POST") {
            return jsonResponse(
              {
                success: true,
                operation_id: "op_1",
                status: "completed",
                cell_count: 1,
                completed_count: 1,
                failed_count: 0,
              },
              200
            );
          }
          if (url.includes("/sheets/s1/operations/") && method === "GET") {
            return jsonResponse(
              {
                success: true,
                operation: {
                  operation_id: "op_1",
                  status: "completed",
                  cell_count: 1,
                  completed_count: 1,
                  failed_count: 0,
                  pending_count: 0,
                },
              },
              200
            );
          }
          if (url.endsWith("/sheets/s1/status-counts") && method === "GET") {
            return jsonResponse(
              {
                success: true,
                total_cells: 1,
                status_counts: {
                  STALE: 0,
                  QUEUED: 0,
                  DISPATCHED: 0,
                  RUNNING: 0,
                  COMPLETED: 1,
                  FAILED: 0,
                },
              },
              200
            );
          }
          if (url.endsWith("/sheets/s1/scorecard") && method === "PATCH") {
            const body = JSON.parse(String(init?.body || "{}"));
            expect(body.steps[0].source_column_ids).toContain("c-extract");
            return undefined;
          }
          return undefined;
        }) satisfies EvalFetchRoute,
      })
    );

    const result = await client.evals.run({
      name: "ops-eval",
      dataset: [{ input: { a: 1 }, expected: "1" }],
      runner: (input) => input,
      columns: [
        column("Extracted data", "JSON_PATH", {
          source: "Output",
          json_path: "$.a",
        }),
      ],
      scorers: [
        containsScorer({
          title: "has_value",
          source: "Extracted data",
          value: "1",
        }),
      ],
    });

    expect(result.results[0].scores.has_value).toBe(1);

    const callIndex = (
      predicate: (url: string, method: string, body: string) => boolean
    ) =>
      fetchMock.mock.calls.findIndex(([input, init]) =>
        predicate(
          getUrlString(input),
          (init?.method || "GET").toUpperCase(),
          String(init?.body || "")
        )
      );

    const extractCreateIndex = callIndex(
      (url, method, body) =>
        url.endsWith("/sheets/s1/columns") &&
        method === "POST" &&
        body.includes("Extracted data")
    );
    const scorecardPatchIndex = callIndex(
      (url, method) => url.endsWith("/sheets/s1/scorecard") && method === "PATCH"
    );
    const rowPostIndex = callIndex(
      (url, method) => url.includes("/sheets/s1/rows") && method === "POST"
    );
    const operationsIndex = callIndex(
      (url, method) =>
        url.endsWith("/sheets/s1/operations") && method === "POST"
    );
    const recalculateIndex = callIndex(
      (url, method) =>
        url.endsWith("/sheets/s1/scorecard/recalculate") && method === "POST"
    );

    expect(extractCreateIndex).toBeGreaterThanOrEqual(0);
    expect(scorecardPatchIndex).toBeGreaterThan(extractCreateIndex);
    expect(rowPostIndex).toBeGreaterThan(scorecardPatchIndex);
    expect(operationsIndex).toBeGreaterThan(rowPostIndex);
    expect(recalculateIndex).toBeGreaterThan(operationsIndex);
  });

  it("rejects reserved or conflicting supporting column titles", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    expect(() =>
      column("output", "JSON_PATH", { source: "Input", json_path: "$" })
    ).toThrow(/reserved/);

    await expect(
      client.evals.run({
        name: "bad",
        dataset: [{ input: "a" }],
        runner: () => "x",
        columns: [
          {
            title: "Output",
            type: "JSON_PATH",
            config: { source: "Input", json_path: "$" },
          },
        ],
        scorers: [containsScorer({ title: "c", source: "Output", value: "x" })],
      })
    ).rejects.toThrow(/reserved/);

    await expect(
      client.evals.run({
        name: "bad",
        dataset: [{ input: "a" }],
        runner: () => "x",
        columns: [
          column("shared", "JSON_PATH", { source: "Output", json_path: "$" }),
        ],
        scorers: [
          containsScorer({ title: "shared", source: "Output", value: "x" }),
        ],
      })
    ).rejects.toThrow(/conflicts with a supporting column/);
  });

  it("preserves result order with maxConcurrency > 1", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    const order: number[] = [];
    fetchMock.mockImplementation(
      createEvalFetchRouter({
        tableTitle: "conc",
        rowCount: 3,
      })
    );

    const result = await client.evals.run({
      name: "conc",
      dataset: [{ input: 0 }, { input: 1 }, { input: 2 }],
      runner: async (input) => {
        const n = Number(input);
        await new Promise((r) => setTimeout(r, (2 - n) * 20));
        order.push(n);
        return n;
      },
      scorers: [codeExecutionColumn("ok", { code: "result = 1;" })],
      maxConcurrency: 3,
      tableId: "t1",
    });

    expect(result.results.map((r) => r.input)).toEqual([0, 1, 2]);
    expect(result.results.map((r) => r.output)).toEqual([0, 1, 2]);
    expect(order).toEqual([2, 1, 0]);
  });

  it("imports traces and resolves output from the Trace column", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    const { jsonResponse } = await import("@/test-helpers");
    let createdTrace = false;

    fetchMock.mockImplementation(
      createEvalFetchRouter({
        columns: [
          { id: "c-input", title: "Input", type: "TEXT" },
          { id: "c-expected", title: "Expected", type: "TEXT" },
          { id: "c-output", title: "Output", type: "TEXT" },
          { id: "c-context", title: "Case Context", type: "TEXT" },
          { id: "c-trace", title: "Trace", type: "TRACE" },
        ],
        overrides: (async (url: string, method: string, init?: RequestInit) => {
          if (url.endsWith("/sheets/s1/columns") && method === "GET") {
            return jsonResponse(
              {
                success: true,
                data: [
                  { id: "c-input", title: "Input", type: "TEXT" },
                  { id: "c-expected", title: "Expected", type: "TEXT" },
                  { id: "c-output", title: "Output", type: "TEXT" },
                  { id: "c-context", title: "Case Context", type: "TEXT" },
                  ...(createdTrace
                    ? [{ id: "c-trace", title: "Trace", type: "TRACE" }]
                    : []),
                ],
              },
              200
            );
          }
          if (url.endsWith("/sheets/s1/columns") && method === "POST") {
            const body = JSON.parse(String(init?.body || "{}"));
            createdTrace = true;
            return jsonResponse(
              {
                success: true,
                column: {
                  id: "c-trace",
                  title: body.title,
                  type: "TEXT",
                },
              },
              201
            );
          }
          if (url.includes("/dataset-versions/add-trace") && method === "POST") {
            return jsonResponse(
              {
                success: true,
                row_index: 0,
                row: completedRow(0, {
                  "c-input": { id: "cell-in", value: "hi" },
                  "c-expected": { id: "cell-ex", value: null },
                  "c-output": { id: "cell-out", value: "runner-output" },
                  "c-context": { id: "cell-context", value: null },
                  "c-trace": {
                    id: "cell-trace",
                    value: {
                      name: "root",
                      start: "2024-01-01T00:00:00Z",
                      span_id: "1",
                      request_log: {
                        request_response: {
                          choices: [
                            {
                              message: {
                                role: "assistant",
                                content: "from-trace",
                              },
                            },
                          ],
                        },
                      },
                      children: [
                        {
                          name: "Tool: search",
                          start: "2024-01-01T00:00:01Z",
                          span_id: "2",
                          children: [],
                        },
                      ],
                    },
                  },
                }),
              },
              201
            );
          }
          if (url.includes("/cells/") && method === "PATCH") {
            return jsonResponse({ success: true }, 200);
          }
          return undefined;
        }) satisfies EvalFetchRoute,
      })
    );

    const result = await client.evals.run({
      name: "trace-eval",
      dataset: [{ input: "hi", "Case Context": "trace-custom" }],
      runner: () => "runner-output",
      scorers: [trajectoryScorer({ acceptedScenarios: [["search"]] })],
    });

    expect(result.results[0].output).toBe("from-trace");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getUrlString(input).includes("/dataset-versions/add-trace") &&
          (init?.method || "GET").toUpperCase() === "POST"
      )
    ).toBe(true);
    const customPatch = fetchMock.mock.calls.find(
      ([input, init]) =>
        getUrlString(input).includes("/cells/cell-context") &&
        (init?.method || "GET").toUpperCase() === "PATCH"
    );
    expect(JSON.parse(String(customPatch?.[1]?.body))).toMatchObject({
      value: "trace-custom",
      display_value: "trace-custom",
    });
  });

  it("fails when passingScore is not met", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    fetchMock.mockImplementation(
      createEvalFetchRouter({
        aggregateScore: 0.4,
        stepScore: 0,
        stepVerdict: "fail",
        stepRawValue: 0,
      })
    );

    await expect(
      client.evals.run({
        name: "threshold-eval",
        dataset: [{ input: "a" }],
        runner: () => "b",
        scorers: [codeExecutionColumn("ok", { code: "result = 0;" })],
        passingScore: 0.8,
        tableId: "t1",
      })
    ).rejects.toBeInstanceOf(EvaluationFailedError);
  });

  it("fails when a scorecard evaluator errors", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    fetchMock.mockImplementation(
      createEvalFetchRouter({
        aggregateScore: 1,
        stepVerdict: "error",
        stepError: "boom",
        stepRawValue: null,
      })
    );

    await expect(
      client.evals.run({
        name: "error-eval",
        dataset: [{ input: "a" }],
        runner: () => "b",
        scorers: [codeExecutionColumn("ok", { code: "result = 1;" })],
        tableId: "t1",
      })
    ).rejects.toThrow(/scorecard evaluators failed to execute/);
  });

  it("loads cases from a dataset table reference", async () => {
    const client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
    const { jsonResponse } = await import("@/test-helpers");
    let copiedRows: any;

    fetchMock.mockImplementation(
      createEvalFetchRouter({
        columns: [
          { id: "c-input", title: "Input", type: "TEXT" },
          { id: "c-expected", title: "Expected", type: "TEXT" },
          { id: "c-output", title: "Output", type: "TEXT" },
          { id: "c-custom", title: "Source Label", type: "TEXT" },
        ],
        overrides: (async (url: string, method: string, _init?: RequestInit) => {
          if (url.includes("/tables/dataset-table/") || url.includes("/tables/dataset-table?")) {
            if (url.includes("/sheets") && method === "GET" && !url.includes("/columns") && !url.includes("/rows")) {
              return jsonResponse(
                {
                  success: true,
                  data: [{ id: "dataset-sheet", title: "Sheet 1" }],
                },
                200
              );
            }
            if (url.includes("/columns") && method === "GET") {
              return jsonResponse(
                {
                  success: true,
                  data: [
                    { id: "d-input", title: "Input", type: "TEXT" },
                    { id: "d-expected", title: "Expected", type: "TEXT" },
                    { id: "d-custom", title: "Source Label", type: "TEXT" },
                    { id: "d-computed", title: "Computed", type: "JSON_PATH" },
                    {
                      id: "d-generated",
                      title: "Generated Text",
                      type: "TEXT",
                      is_output_column: true,
                    },
                  ],
                },
                200
              );
            }
            if (url.includes("/rows") && method === "GET") {
              return jsonResponse(
                {
                  success: true,
                  data: [
                    completedRow(0, {
                      "d-input": { id: "di", value: "from-table" },
                      "d-expected": { id: "de", value: "from-table" },
                      "d-custom": { id: "dc", value: "copied-exactly" },
                      "d-computed": { id: "dx", value: "ignored" },
                      "d-generated": { id: "dg", value: "ignored" },
                    }),
                  ],
                },
                200
              );
            }
          }
          if (url.includes("/sheets/s1/rows") && method === "POST") {
            copiedRows = JSON.parse(String(_init?.body || "{}"));
            return jsonResponse(
              {
                success: true,
                rows: [
                  completedRow(0, {
                    "c-input": { id: "cell-in", value: "from-table" },
                    "c-expected": { id: "cell-ex", value: "from-table" },
                    "c-output": { id: "cell-out", value: "from-table" },
                    "c-custom": { id: "cell-custom", value: "copied-exactly" },
                  }),
                ],
                row_indices: [0],
              },
              201
            );
          }
          return undefined;
        }) satisfies EvalFetchRoute,
      })
    );

    const result = await client.evals.run({
      name: "dataset-ref",
      dataset: { tableId: "dataset-table" },
      runner: (input) => input,
      scorers: [codeExecutionColumn("ok", { code: "result = 1;" })],
      tableId: "t1",
    });

    expect(result.results[0].input).toBe("from-table");
    expect(result.results[0].output).toBe("from-table");
    expect(copiedRows.values[0]["c-custom"]).toBe("copied-exactly");
    expect(copiedRows.values[0]).not.toHaveProperty("d-computed");
    expect(copiedRows.values[0]).not.toHaveProperty("d-generated");
  });
});
