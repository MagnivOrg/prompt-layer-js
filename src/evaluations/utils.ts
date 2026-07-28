import {
  AddTraceImport,
  CreateColumn,
  EvalCaseResult,
  EvalScorerColumn,
  ResourceId,
  Column,
  ColumnDependency,
} from "@/types";
import { extractRows } from "@/tables/helpers";

export const BASE_TEXT_COLUMNS = ["Input", "Expected", "Output"] as const;
export const EXPECTED_TRACE_COLUMN = "Expected Trace";
export const TRACE_TEXT_COLUMNS = ["Trace"] as const;
export const TRACE_RESERVED_COLUMN_TITLES = [
  "Trace",
  "Trace.price",
  "Trace.latency",
  "Trace link",
  "total_trace_time",
  "total_price",
] as const;

export const COLUMN_TITLE_ALIASES: Record<string, string> = {
  input: "Input",
  expected: "Expected",
  output: "Output",
  expected_trace: EXPECTED_TRACE_COLUMN,
  trace: "Trace",
};

export const RESERVED_EVAL_COLUMN_TITLES = new Set<string>([
  ...BASE_TEXT_COLUMNS,
  ...TRACE_RESERVED_COLUMN_TITLES,
  EXPECTED_TRACE_COLUMN,
  ...Object.keys(COLUMN_TITLE_ALIASES),
]);

export const isReservedEvalColumnTitle = (title: string): boolean =>
  RESERVED_EVAL_COLUMN_TITLES.has(title);

const LEGACY_COLUMN_TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_TITLE_ALIASES).map(([alias, canonical]) => [
    canonical,
    alias,
  ])
);

export const resolveColumnTitle = (title: string): string =>
  COLUMN_TITLE_ALIASES[title] ?? title;

export const findColumnByTitle = (
  columnsByTitleMap: Record<string, Column>,
  title: string
): Column | undefined => {
  if (!title) return undefined;
  const direct = columnsByTitleMap[title];
  if (direct) return direct;
  const canonical = COLUMN_TITLE_ALIASES[title];
  if (canonical && columnsByTitleMap[canonical]) {
    return columnsByTitleMap[canonical];
  }
  const legacy = LEGACY_COLUMN_TITLES[title];
  if (legacy && columnsByTitleMap[legacy]) return columnsByTitleMap[legacy];
  return undefined;
};

export { LEGACY_COLUMN_TITLES };

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_CELL_WAIT_TIMEOUT_MS = 300_000;
/** LLM scorecard steps (esp. multi-row) routinely need longer than cell wait. */
export const DEFAULT_SCORE_WAIT_TIMEOUT_MS = 600_000;

export const serializeCellValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
};

export const parseCellValue = (
  cell: Record<string, unknown> | null | undefined
): unknown => {
  if (!cell) return null;
  let value = cell.value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in (value as Record<string, unknown>) &&
    Object.keys(value as object).length === 1
  ) {
    value = (value as Record<string, unknown>).value;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (value !== null && value !== undefined) return value;
  const display = cell.display_value;
  if (typeof display === "string") {
    try {
      return JSON.parse(display);
    } catch {
      return display;
    }
  }
  return display ?? null;
};

export const columnsByTitle = (
  columns: Column[]
): Record<string, Column> => {
  const map: Record<string, Column> = {};
  for (const column of columns) {
    if (column.title) map[column.title] = column;
  }
  return map;
};

export const findLastRow = (
  rowsPayload: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  const rows = extractRows(rowsPayload).filter(
    (row) => row.row_index !== null && row.row_index !== undefined
  );
  if (!rows.length) return null;
  return rows.reduce((best, row) =>
    Number(row.row_index) > Number(best.row_index) ? row : best
  );
};

export const extractRowIndices = (
  rowResponse: Record<string, unknown> | null | undefined
): number[] => {
  if (!rowResponse) return [];
  if (rowResponse.row_index !== null && rowResponse.row_index !== undefined) {
    return [Number(rowResponse.row_index)];
  }
  const rows =
    (rowResponse.rows as Record<string, unknown>[]) ||
    (rowResponse.data as Record<string, unknown>[]) ||
    [];
  const indices = rows
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        row.row_index !== null &&
        row.row_index !== undefined
    )
    .map((row) => Number(row.row_index));
  if (indices.length) return indices;
  const added = rowResponse.added_rows || rowResponse.row_indices;
  if (Array.isArray(added) && added.length) {
    return added.map((value) => Number(value));
  }
  return [];
};

export const cellIsBlank = (cell: unknown): boolean => {
  if (!cell || typeof cell !== "object") return true;
  const record = cell as Record<string, unknown>;
  const display = record.display_value;
  if (typeof display === "string" && display.trim()) return false;
  let value = record.value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "value" in (value as object)
  ) {
    value = (value as Record<string, unknown>).value;
  }
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return Object.keys(value as object).length === 0;
  }
  return false;
};

export const rowIsBlankScaffold = (row: Record<string, unknown>): boolean => {
  const cells = row.cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return true;
  const values = Object.values(cells as Record<string, unknown>);
  if (!values.length) return true;
  return values.every(cellIsBlank);
};

export const blankRowIndices = (
  rowsPayload: Record<string, unknown> | null | undefined
): number[] =>
  extractRows(rowsPayload)
    .filter(
      (row) =>
        row.row_index !== null &&
        row.row_index !== undefined &&
        rowIsBlankScaffold(row)
    )
    .map((row) => Number(row.row_index));

export const findScaffoldColumn = (
  existing: Column[]
): Column | null => {
  const scaffold = columnsByTitle(existing)["Column A"];
  if (!scaffold) return null;
  if (scaffold.type != null && scaffold.type !== "TEXT") return null;
  if (scaffold.id == null) return null;
  return scaffold;
};

export const mergeColumn = (
  columns: Column[],
  column: Column
): Column[] => {
  const columnId = column.id;
  const merged = columns.map((c) => (c.id === columnId ? column : c));
  if (!merged.some((c) => c.id === columnId)) merged.push(column);
  return merged;
};

export const stripSdkOnlyConfig = (
  config: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!config) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "_sdkDiagnosis" || key === "_sdk_diagnosis") continue;
    next[key] = value;
  }
  return next;
};

export const buildScorerColumnBody = (
  scorer: EvalScorerColumn,
  dependencies: ColumnDependency[]
): CreateColumn => {
  // Strip SDK-only keys (e.g. `_sdkDiagnosis`); do not send is_output_column.
  const body: CreateColumn = {
    title: scorer.title,
    type: scorer.type,
  };
  const config = stripSdkOnlyConfig(scorer.config);
  if (config !== undefined) body.config = config;
  if (dependencies.length) body.dependencies = dependencies;
  return body;
};

const API_HOST_TO_DASHBOARD_HOST: Record<string, string> = {
  "api.promptlayer.com": "dashboard.promptlayer.com",
  "api.eu.promptlayer.com": "dashboard.eu.promptlayer.com",
  "api.dev.gcp.promptlayer.com": "dashboard.dev.gcp.promptlayer.com",
};

export const resolveDashboardBaseUrl = (apiBaseUrl: string): string => {
  const override =
    typeof process !== "undefined"
      ? process.env.PROMPTLAYER_DASHBOARD_URL
      : undefined;
  if (override && override.trim()) return override.trim().replace(/\/$/, "");

  try {
    const parsed = new URL(
      (apiBaseUrl || "").trim() || "https://api.promptlayer.com"
    );
    const host = parsed.hostname.toLowerCase();
    if (host in API_HOST_TO_DASHBOARD_HOST) {
      return `${parsed.protocol}//${API_HOST_TO_DASHBOARD_HOST[host]}`;
    }
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:3000";
    }
    if (host.startsWith("api.")) {
      return `${parsed.protocol}//dashboard.${host.slice(4)}`;
    }
  } catch {
    // fall through
  }
  return "https://dashboard.promptlayer.com";
};

export const buildTableDashboardUrl = (args: {
  apiBaseUrl: string;
  workspaceId: unknown;
  tableId: unknown;
  sheetId?: unknown;
}): string | undefined => {
  if (args.workspaceId == null || args.tableId == null) return undefined;
  const base = resolveDashboardBaseUrl(args.apiBaseUrl);
  // Frontend dashboard route still uses /smart-tables/ (product URL, not SDK naming).
  let url = `${base}/workspace/${args.workspaceId}/smart-tables/${args.tableId}`;
  if (args.sheetId != null) url = `${url}?sheet=${args.sheetId}`;
  return url;
};

export const buildRowValues = (
  columnsByTitleMap: Record<string, Column>,
  args: {
    inputValue: unknown;
    expectedValue: unknown;
    expectedTraceValue: unknown;
    outputValue: unknown;
  }
): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const [title, value] of [
    ["Input", args.inputValue],
    ["Expected", args.expectedValue],
    [EXPECTED_TRACE_COLUMN, args.expectedTraceValue],
    ["Output", args.outputValue],
  ] as const) {
    const column = findColumnByTitle(columnsByTitleMap, title);
    if (!column) continue;
    values[String(column.id)] = serializeCellValue(
      value !== null && value !== undefined ? value : ""
    );
  }
  return values;
};

export const buildTraceImportBody = (args: {
  traceId: string;
  spanId?: string;
  sheetId: ResourceId;
  tableId: ResourceId;
  evalName: string;
}): AddTraceImport => ({
  trace_id: args.traceId,
  span_id: args.spanId,
  sheet_id: args.sheetId,
  smart_table_id: args.tableId,
  metadata: { eval_name: args.evalName },
});

export const buildCaseResult = <TInput, TOutput>(args: {
  inputValue: TInput;
  expectedValue: unknown;
  outputValue: TOutput;
  scores: Record<string, unknown>;
  traceId: string;
  spanId: string;
  rowIndex: number | null;
}): EvalCaseResult<TInput, TOutput> => ({
  input: args.inputValue,
  expected: args.expectedValue,
  output: args.outputValue,
  scores: args.scores,
  traceId: args.traceId || null,
  spanId: args.spanId || null,
  rowIndex: args.rowIndex,
});

export const casesFromRows = <TInput = unknown>(
  rowsPayload: Record<string, unknown> | null | undefined,
  columns: Column[]
): Array<{ input: TInput; expected?: unknown; expectedTrace?: unknown }> => {
  const byTitle = columnsByTitle(columns);
  const inputCol = findColumnByTitle(byTitle, "Input");
  const expectedCol = findColumnByTitle(byTitle, "Expected");
  const expectedTraceCol = findColumnByTitle(byTitle, EXPECTED_TRACE_COLUMN);
  const cases: Array<{
    input: TInput;
    expected?: unknown;
    expectedTrace?: unknown;
  }> = [];
  for (const row of extractRows(rowsPayload)) {
    const cells = (row.cells as Record<string, unknown>) || {};
    let inputValue: unknown = null;
    let expectedValue: unknown = null;
    let expectedTraceValue: unknown = null;
    if (inputCol) {
      inputValue = parseCellValue(
        cells[String(inputCol.id)] as Record<string, unknown>
      );
    }
    if (expectedCol) {
      expectedValue = parseCellValue(
        cells[String(expectedCol.id)] as Record<string, unknown>
      );
    }
    if (expectedTraceCol) {
      expectedTraceValue = parseCellValue(
        cells[String(expectedTraceCol.id)] as Record<string, unknown>
      );
    }
    if (inputValue === null && "input" in row) inputValue = row.input;
    if (expectedValue === null && "expected" in row) {
      expectedValue = row.expected;
    }
    if (expectedTraceValue === null && "expected_trace" in row) {
      expectedTraceValue = row.expected_trace;
    }
    if (inputValue === null || inputValue === undefined) continue;
    const caseItem: {
      input: TInput;
      expected?: unknown;
      expectedTrace?: unknown;
    } = {
      input: inputValue as TInput,
    };
    if (expectedValue !== null && expectedValue !== undefined) {
      caseItem.expected = expectedValue;
    }
    if (expectedTraceValue !== null && expectedTraceValue !== undefined) {
      caseItem.expectedTrace = expectedTraceValue;
    }
    cases.push(caseItem);
  }
  return cases;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
