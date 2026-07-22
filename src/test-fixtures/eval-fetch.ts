import { getUrlString, jsonResponse } from "@/test-helpers";

export const completedRow = (
  rowIndex: number,
  cells: Record<string, Record<string, unknown>>
) => ({
  row_index: rowIndex,
  cells: Object.fromEntries(
    Object.entries(cells).map(([columnId, cell]) => [
      columnId,
      { status: "COMPLETED", ...cell },
    ])
  ),
});

export type EvalFetchRoute = (
  url: string,
  method: string,
  init?: RequestInit
) => Response | Promise<Response | undefined> | undefined;

type CreateEvalFetchRouterOptions = {
  tableId?: string;
  sheetId?: string;
  tableTitle?: string;
  sheetTitle?: string;
  columns?: Array<{ id: string; title: string; type: string }>;
  rowCount?: number;
  scorecardSteps?: Array<{ id: string; title: string; primitive_type: string }>;
  aggregateScore?: number;
  stepScore?: number;
  stepVerdict?: string;
  stepRawValue?: unknown;
  stepError?: unknown;
  /** Extra routes; return a Response to handle, undefined to fall through. */
  overrides?: EvalFetchRoute;
};

const defaultColumns = [
  { id: "c-input", title: "Input", type: "TEXT" },
  { id: "c-expected", title: "Expected", type: "TEXT" },
  { id: "c-output", title: "Output", type: "TEXT" },
];

/** Shared Table + scorecard HTTP router for eval integration tests. */
export const createEvalFetchRouter = (
  options: CreateEvalFetchRouterOptions = {}
): ((input: string | URL, init?: RequestInit) => Promise<Response>) => {
  const tableId = options.tableId ?? "t1";
  const sheetId = options.sheetId ?? "s1";
  const tableTitle = options.tableTitle ?? "my-eval";
  const sheetTitle = options.sheetTitle ?? "Experiment #1";
  const columns = options.columns ?? defaultColumns;
  const rowCount = options.rowCount ?? 1;
  const aggregateScore = options.aggregateScore ?? 1;
  const stepScore = options.stepScore ?? 1;
  const stepVerdict = options.stepVerdict ?? "pass";
  const stepRawValue = options.stepRawValue ?? stepScore;
  let resolvedSteps = options.scorecardSteps;

  return async (input: string | URL, init?: RequestInit) => {
    const url = getUrlString(input);
    const method = (init?.method || "GET").toUpperCase();
    const override = await options.overrides?.(url, method, init);
    if (override) return override;

    if (url.endsWith("/api/public/v2/tables") && method === "GET") {
      return jsonResponse(
        { success: true, data: [{ id: tableId, title: tableTitle }] },
        200
      );
    }
    if (url.endsWith(`/api/public/v2/tables/${tableId}`) && method === "GET") {
      return jsonResponse(
        {
          success: true,
          table: { id: tableId, title: tableTitle, workspace_id: 1 },
        },
        200
      );
    }
    if (url.endsWith("/api/public/v2/tables") && method === "POST") {
      return jsonResponse(
        {
          success: true,
          table: { id: tableId, title: tableTitle, workspace_id: 1 },
        },
        201
      );
    }
    if (url.endsWith(`/tables/${tableId}/sheets`) && method === "GET") {
      return jsonResponse({ success: true, data: [] }, 200);
    }
    if (url.endsWith(`/tables/${tableId}/sheets`) && method === "POST") {
      return jsonResponse(
        { success: true, sheet: { id: sheetId, title: sheetTitle } },
        201
      );
    }
    if (url.endsWith(`/sheets/${sheetId}/columns`) && method === "GET") {
      return jsonResponse({ success: true, data: columns }, 200);
    }
    if (url.includes(`/sheets/${sheetId}/rows`) && method === "GET") {
      return jsonResponse({ success: true, data: [] }, 200);
    }
    if (url.includes(`/sheets/${sheetId}/rows`) && method === "POST") {
      const rows = Array.from({ length: rowCount }, (_, index) =>
        completedRow(index, {
          "c-input": { id: `in-${index}`, value: index },
          "c-expected": { id: `ex-${index}`, value: index },
          "c-output": { id: `out-${index}`, value: index },
        })
      );
      return jsonResponse(
        {
          success: true,
          rows,
          row_indices: rows.map((row) => row.row_index),
        },
        201
      );
    }
    if (url.endsWith(`/sheets/${sheetId}/scorecard`) && method === "PATCH") {
      const body = JSON.parse(String(init?.body || "{}"));
      resolvedSteps = (body.steps || []).map(
        (step: Record<string, unknown>, index: number) => ({
          id: `step_${index}`,
          title: String(step.title),
          primitive_type: String(step.primitive_type),
        })
      );
      return jsonResponse(
        {
          success: true,
          scorecard: {
            id: "sc_1",
            name: body.name,
            status: "ready",
            steps: resolvedSteps,
          },
        },
        200
      );
    }
    if (
      url.endsWith(`/sheets/${sheetId}/scorecard/recalculate`) &&
      method === "POST"
    ) {
      return jsonResponse(
        {
          success: true,
          calculation_id: "calc_1",
          status: "queued",
          version: 1,
        },
        202
      );
    }
    if (url.endsWith(`/sheets/${sheetId}/scorecard`) && method === "GET") {
      const steps =
        resolvedSteps ??
        options.scorecardSteps ?? [{ id: "step_0", title: "exact", primitive_type: "CODE_EXECUTION" }];
      return jsonResponse(
        {
          success: true,
          scorecard: {
            id: "sc_1",
            status: "completed",
            steps,
          },
          latest_calculation: {
            id: "calc_1",
            status: "completed",
            aggregate_score: aggregateScore,
          },
          progress: {
            scored_rows: rowCount,
            total_rows: rowCount,
            partial_score: aggregateScore,
          },
        },
        200
      );
    }
    if (url.includes(`/sheets/${sheetId}/scorecard/rows/`) && method === "GET") {
      const rowIndex = Number(url.split("/rows/")[1]?.split("?")[0]);
      const stepId =
        (resolvedSteps ?? options.scorecardSteps)?.[0]?.id ?? "step_0";
      const stepResult: Record<string, unknown> = {
        score: stepScore,
        verdict: stepVerdict,
        raw_value: stepRawValue,
      };
      if (options.stepError !== undefined) stepResult.error = options.stepError;
      return jsonResponse(
        {
          success: true,
          row_index: rowIndex,
          calculation_id: "calc_1",
          aggregate_score: aggregateScore,
          aggregate_verdict: stepVerdict === "error" ? "fail" : "pass",
          step_results: {
            [stepId]: stepResult,
          },
        },
        200
      );
    }
    return jsonResponse({ success: true }, 200);
  };
};
